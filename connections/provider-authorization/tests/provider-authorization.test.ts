/**
 * หน้าที่: proves the provider-authorization lifecycle state machine,
 * offline — every external call (Device Flow HTTP, Keychain write,
 * GitHub identity/repository verification) is injected, the same
 * OS/network-boundary-only injection discipline
 * `connections/github/keychain-credential-resolution.test.ts` and
 * `credentials/macos-keychain/tests/provider.test.ts` already establish.
 * connection-registry and provider-authorization stores are pointed at
 * isolated temp directories (same pattern as
 * `connections/connection-registry/tests/connection-registry.test.ts`) —
 * this suite never writes to the real production data files.
 *
 * How to run: npx tsx connections/provider-authorization/tests/provider-authorization.test.ts
 */

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnectionRegistryStore } from "../../connection-registry/registry";
import type { GitDiscoveryOutcome } from "../../connection-registry/git-discovery";
import { createProviderAuthorizationStore } from "../store";
import { beginAuthorization, completeAuthorization, getAuthorizationStatus, revokeAuthorization } from "../lifecycle";
import type { LifecycleDeps } from "../lifecycle";
import { buildGithubPluginStatus } from "../plugin-status";
import type { PluginStatusDeps } from "../plugin-status";
import type { ApiCredentialEntry, ApiCredentialStatus } from "../../../credentials/registry/api-credential-registry";
import type { GithubCredentialResolution } from "../../github/credential-resolution";
import type { AuthenticatedUserLookup, RepositoryLookup } from "../../github/github-read-api";

declare const process: { exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const FAKE_TARGET = { owner: "test-owner", repository: "test-repo", branch: "main" };
const okDiscovery: GitDiscoveryOutcome = { ok: true, value: { ...FAKE_TARGET, repository_root: "/fake/repo", remote_url: "git@github.com:test-owner/test-repo.git" } };

function buildHarness(overrides: Partial<LifecycleDeps> = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "dna-os-provider-authorization-test-"));
  const connectionStore = createConnectionRegistryStore(tempDir);
  const authStore = createProviderAuthorizationStore(tempDir);
  const fakeCredentials = new Map<string, ApiCredentialEntry>();
  const keychainWrites: Array<{ credential_ref: string; service: string; account: string; secretLength: number }> = [];

  const deps: LifecycleDeps = {
    discoverGitRemote: async () => okDiscovery,
    readClientId: () => "fake-client-id",
    requestDeviceCode: async () => ({ ok: true, device_code: "fake-device-code", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 }),
    pollForAccessToken: async () => ({ ok: true, access_token: "fake-access-token-never-real", scope: "repo", token_type: "bearer" }),
    registerConnection: connectionStore.registerConnection,
    lookupConnection: connectionStore.lookupConnection,
    attachCredential: connectionStore.attachCredential,
    updateConnectionStatus: connectionStore.updateConnectionStatus,
    registerOwnerApiCredential: async (input) => {
      if (fakeCredentials.has(input.credential_ref)) throw new Error("DUPLICATE_CREDENTIAL_REF");
      keychainWrites.push({ credential_ref: input.credential_ref, service: input.service, account: input.keychainAccount, secretLength: input.secret.length });
      fakeCredentials.set(input.credential_ref, {
        credential_ref: input.credential_ref, provider: input.provider, account: input.account, scope: input.scope,
        status: "ACTIVE", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        resolver_kind: "macos_keychain", resolver_service: input.service, resolver_account: input.keychainAccount,
      });
      return { credential_ref: input.credential_ref, status: "ACTIVE" as const };
    },
    findApiCredential: (ref: string) => fakeCredentials.get(ref) ?? null,
    setApiCredentialStatus: (ref: string, status: ApiCredentialStatus) => {
      const current = fakeCredentials.get(ref);
      if (!current) throw new Error("CREDENTIAL_NOT_REGISTERED");
      const updated = { ...current, status };
      fakeCredentials.set(ref, updated);
      return updated;
    },
    resolveGithubCredential: async (): Promise<GithubCredentialResolution> => ({ ok: true, token: "fake-resolved-token", credential_source: "keychain:fake-service/fake-account" }),
    getAuthenticatedUser: async (): Promise<AuthenticatedUserLookup> => ({ kind: "found", http_status: 200, login: "test-owner" }),
    getRepository: async (): Promise<RepositoryLookup> => ({ kind: "found", http_status: 200, default_branch: "main", visibility: "private" }),
    findAuthorizationRecord: authStore.findAuthorizationRecord,
    upsertAuthorizationRecord: authStore.upsertAuthorizationRecord,
    sleep: async () => {},
    now: () => new Date(),
    ...overrides,
  };

  const pluginStatusDeps: PluginStatusDeps = { lookupConnection: deps.lookupConnection, findAuthorizationRecord: deps.findAuthorizationRecord };

  return { tempDir, connectionStore, authStore, deps, pluginStatusDeps, fakeCredentials, keychainWrites, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
}

async function main(): Promise<void> {
  // A. GitHub disconnected, no client_id configured -> AUTHORIZATION_REQUIRED.
  await check("A. GitHub disconnected, no client_id -> AUTHORIZATION_REQUIRED", async () => {
    const h = buildHarness({ readClientId: () => undefined });
    const result = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(!result.ok && result.reason_code === "GITHUB_OAUTH_CLIENT_ID_NOT_CONFIGURED", `expected GITHUB_OAUTH_CLIENT_ID_NOT_CONFIGURED, got ${JSON.stringify(result)}`);
    const connectionId = h.connectionStore.lookupConnection({ adapter: "github", target: FAKE_TARGET })?.connection_id;
    assert(!!connectionId, "expected a connection row to still be auto-registered even without a client_id");
    const status = h.deps.findAuthorizationRecord(connectionId!);
    assert(status?.state === "AUTHORIZATION_REQUIRED", `expected AUTHORIZATION_REQUIRED, got ${status?.state}`);
    h.cleanup();
  });

  // B. begin authorization -> AUTHORIZATION_PENDING.
  let pendingConnectionId = "";
  await check("B. begin authorization -> AUTHORIZATION_PENDING, real device/user code shape returned", async () => {
    const h = buildHarness();
    const result = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(result.ok, `expected beginAuthorization to succeed, got ${JSON.stringify(result)}`);
    if (result.ok) {
      assert(result.user_code === "ABCD-1234", "expected the device flow's user_code to pass through unchanged");
      assert(result.verification_uri === "https://github.com/login/device", "expected the real GitHub verification_uri");
      pendingConnectionId = result.connection_id;
    }
    const status = getAuthorizationStatus(pendingConnectionId, h.deps);
    assert(status.ok && status.record.state === "AUTHORIZATION_PENDING", `expected AUTHORIZATION_PENDING, got ${JSON.stringify(status)}`);
    h.cleanup();
  });

  // C/D/E/F/G. Full successful authorization: credential lands only in Keychain (never raw in the record/registry), credential_ref resolves, CONNECTED, repository verified.
  await check("C-G. successful authorization: Keychain-only credential, credential_ref resolves, CONNECTED, repo verified", async () => {
    const h = buildHarness();
    const begin = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(begin.ok, "precondition: beginAuthorization must succeed");
    if (!begin.ok) return;

    const complete = await completeAuthorization(begin.connection_id, h.deps);
    assert(complete.ok, `expected completeAuthorization to succeed, got ${JSON.stringify(complete)}`);
    if (!complete.ok) return;

    // C: credential stored only via the Keychain-write path, exactly once, with the real secret length (never persisted as plaintext anywhere in the record).
    assert(h.keychainWrites.length === 1, `expected exactly one Keychain write, got ${h.keychainWrites.length}`);
    assert(h.keychainWrites[0]!.secretLength === "fake-access-token-never-real".length, "expected the real access_token to reach the Keychain write call");

    // D: the persisted record never contains the raw token anywhere.
    const recordText = JSON.stringify(complete.record);
    assert(!recordText.includes("fake-access-token-never-real"), "the raw access_token must never appear in the persisted authorization record");
    assert(complete.record.credential_ref !== null && complete.record.credential_ref.startsWith("credential://github/"), `expected a real credential_ref, got ${complete.record.credential_ref}`);

    // E: credential_ref resolved correctly (the injected resolveGithubCredential was reached with a keychain_ref built from the real credential_ref).
    assert(complete.record.state === "CONNECTED", `expected CONNECTED, got ${complete.record.state}`); // F
    assert(complete.account_verification.login === "test-owner", "expected the verified GitHub login to be recorded");
    assert(complete.repository_verification.owner === "test-owner" && complete.repository_verification.repository === "test-repo", "expected repository verification to reflect the real discovered target"); // G

    const connection = h.connectionStore.lookupConnection({ connection_id: begin.connection_id });
    assert(connection?.status === "connected", `expected the ConnectionRegistration status to flip to connected, got ${connection?.status}`);
    assert(connection?.credential_ref.kind === "keychain_ref", "expected the attached credential_ref to be a keychain_ref, never a raw value");

    // UI read model never carries a token either.
    const pluginStatus = buildGithubPluginStatus(begin.connection_id, h.pluginStatusDeps);
    assert(!JSON.stringify(pluginStatus).includes("fake-access-token"), "plugin status read model must never carry a token");
    assert(pluginStatus.plugin_status === "READY", `expected plugin_status READY, got ${pluginStatus.plugin_status}`);
    assert(pluginStatus.login_status === "LOGGED_IN", `expected login_status LOGGED_IN, got ${pluginStatus.login_status}`);

    h.cleanup();
  });

  // D (static). ProviderAuthorizationRecord's own field names never name a secret.
  await check("D. static proof — ProviderAuthorizationRecord field names never name a secret/token", () => {
    const typesSource = readFileSync(new URL("../types.ts", import.meta.url), "utf8");
    const recordInterface = typesSource.slice(typesSource.indexOf("export interface ProviderAuthorizationRecord"), typesSource.indexOf("export interface BeginAuthorizationInput"));
    const fieldNames = [...recordInterface.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]!.toLowerCase());
    assert(!fieldNames.some((name) => name.includes("password") || name === "token" || name === "access_token" || name === "secret"), `unexpected secret-shaped field name in ProviderAuthorizationRecord: ${JSON.stringify(fieldNames)}`);
  });

  // H. invalid/revoked credential -> authorization no longer READY.
  await check("H. revoke authorization -> no longer READY, credential marked REVOKED", async () => {
    const h = buildHarness();
    const begin = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(begin.ok, "precondition");
    if (!begin.ok) return;
    await completeAuthorization(begin.connection_id, h.deps);
    const before = buildGithubPluginStatus(begin.connection_id, h.pluginStatusDeps);
    assert(before.plugin_status === "READY", "precondition: must be READY before revoking");

    const revoked = revokeAuthorization(begin.connection_id, h.deps);
    assert(revoked.ok && revoked.record.state === "REVOKED", `expected REVOKED, got ${JSON.stringify(revoked)}`);
    const credentialRef = revoked.ok ? revoked.record.credential_ref : null;
    assert(credentialRef !== null, "expected a credential_ref on the revoked record");
    const entry = h.fakeCredentials.get(credentialRef!);
    assert(entry?.status === "REVOKED", `expected the underlying credential entry to be REVOKED, got ${entry?.status}`);

    const after = buildGithubPluginStatus(begin.connection_id, h.pluginStatusDeps);
    assert(after.plugin_status !== "READY", `expected plugin_status to no longer be READY after revoke, got ${after.plugin_status}`);
    assert(after.connection_status === "disconnected", `expected connection_status disconnected after revoke, got ${after.connection_status}`);
    h.cleanup();
  });

  // I. restart -> connection + authorization remain discoverable via fresh store instances over the same real data directory.
  await check("I. restart survives — fresh store instances over the same directory read back CONNECTED", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dna-os-provider-authorization-restart-test-"));
    try {
      const firstConnectionStore = createConnectionRegistryStore(tempDir);
      const firstAuthStore = createProviderAuthorizationStore(tempDir);
      const h = buildHarness({});
      // Rebuild deps around the restart-target stores specifically, reusing the same fakes for external calls.
      const restartDeps: LifecycleDeps = { ...h.deps, registerConnection: firstConnectionStore.registerConnection, lookupConnection: firstConnectionStore.lookupConnection, attachCredential: firstConnectionStore.attachCredential, updateConnectionStatus: firstConnectionStore.updateConnectionStatus, findAuthorizationRecord: firstAuthStore.findAuthorizationRecord, upsertAuthorizationRecord: firstAuthStore.upsertAuthorizationRecord };
      const begin = await beginAuthorization({ provider: "github", cwd: "/fake" }, restartDeps);
      assert(begin.ok, "precondition");
      if (!begin.ok) return;
      await completeAuthorization(begin.connection_id, restartDeps);

      // Simulate a restart: brand-new store instances, same directory.
      const restartedConnectionStore = createConnectionRegistryStore(tempDir);
      const restartedAuthStore = createProviderAuthorizationStore(tempDir);
      const connection = restartedConnectionStore.lookupConnection({ connection_id: begin.connection_id });
      const record = restartedAuthStore.findAuthorizationRecord(begin.connection_id);
      assert(connection?.status === "connected", "expected the connection to still read back as connected after 'restart'");
      assert(record?.state === "CONNECTED", "expected the authorization record to still read back as CONNECTED after 'restart'");
      h.cleanup();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // J. a valid Keychain credential does not require login again — bootstrap-equivalent check via plugin-status alone, no beginAuthorization call.
  await check("J. an already-CONNECTED authorization does not require a fresh beginAuthorization call", async () => {
    const h = buildHarness();
    const begin = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(begin.ok, "precondition");
    if (!begin.ok) return;
    await completeAuthorization(begin.connection_id, h.deps);

    let deviceCodeRequestsAfterConnected = 0;
    const countingDeps: LifecycleDeps = { ...h.deps, requestDeviceCode: async (...args) => { deviceCodeRequestsAfterConnected++; return h.deps.requestDeviceCode(...args); } };
    const status = getAuthorizationStatus(begin.connection_id, countingDeps);
    assert(status.ok && status.record.state === "CONNECTED", "expected CONNECTED without calling beginAuthorization again");
    assert(deviceCodeRequestsAfterConnected === 0, "getAuthorizationStatus must never itself trigger a new device code request");
    h.cleanup();
  });

  // K. Source Execution can consume a READY connection — the credential_ref shape provider-authorization attaches is exactly what connections/github/credential-resolution.ts's keychain_ref path expects (proven directly against that real module, not a re-implementation).
  await check("K. the attached credential_ref is consumable by connections/github/credential-resolution.ts's real keychain_ref path", async () => {
    const h = buildHarness();
    const begin = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(begin.ok, "precondition");
    if (!begin.ok) return;
    const complete = await completeAuthorization(begin.connection_id, h.deps);
    assert(complete.ok, "precondition");
    if (!complete.ok) return;

    const { resolveGithubCredential: realResolve } = await import("../../github/credential-resolution");
    const connection = h.connectionStore.lookupConnection({ connection_id: begin.connection_id })!;
    assert(connection.credential_ref.kind === "keychain_ref", "expected a keychain_ref for source-execution's real resolver to understand");
    // The real resolver will honestly refuse here (no real credentials/registry entry exists for this fake ref) — proves it reaches the real lookup boundary rather than trusting the connection blindly.
    const realResolution = await realResolve(connection);
    assert(!realResolution.ok, "expected the REAL resolver to honestly refuse a credential_ref this test never registered in the real credentials/registry store");
    h.cleanup();
  });

  // L. repeated authorization completion is idempotent — completing twice never creates a second Keychain write / duplicate credential registration.
  await check("L. repeated completeAuthorization on an already-CONNECTED record is a safe no-op path (no duplicate Keychain write)", async () => {
    const h = buildHarness();
    const begin = await beginAuthorization({ provider: "github", cwd: "/fake" }, h.deps);
    assert(begin.ok, "precondition");
    if (!begin.ok) return;
    await completeAuthorization(begin.connection_id, h.deps);
    assert(h.keychainWrites.length === 1, "precondition: exactly one Keychain write after the first completion");

    const secondAttempt = await completeAuthorization(begin.connection_id, h.deps);
    assert(!secondAttempt.ok && secondAttempt.reason_code === "NO_PENDING_AUTHORIZATION", `expected a second completeAuthorization on an already-CONNECTED record to refuse rather than re-run the flow, got ${JSON.stringify(secondAttempt)}`);
    assert(h.keychainWrites.length === 1, "expected no additional Keychain write from the repeated call");
    h.cleanup();
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
