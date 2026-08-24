/**
 * หน้าที่: the ONE owner of external-provider authorization lifecycle —
 * `beginAuthorization`, `getAuthorizationStatus`, `completeAuthorization`,
 * `revokeAuthorization`. GitHub is the first provider; nothing below is
 * GitHub-execution (that stays in ../github/ and ../../control/source-execution/)
 * — this file only turns "Owner approves in their browser" into a
 * Keychain-backed `credential_ref` attached to a real `ConnectionRegistration`.
 *
 * Every external call (Device Flow requests, Keychain write, GitHub
 * identity/repository verification) is reached through an injectable
 * `LifecycleDeps` object, defaulting to the real modules — the same
 * testability seam `connections/github/credential-resolution.ts`'s
 * `provider` parameter and `credentials/macos-keychain/provider.ts`'s
 * `commandRunner` option already establish. Production code never
 * overrides the defaults.
 *
 * Input: `BeginAuthorizationInput`, a `connection_id`.
 * Output: `beginAuthorization`, `getAuthorizationStatus`,
 * `completeAuthorization`, `revokeAuthorization`.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts, ./github-device-flow.ts,
 * ./host-runtime.ts (sleepMilliseconds only),
 * ../connection-registry/contract.ts,
 * ../github/credential-resolution.ts, ../github/github-read-api.ts,
 * ../../credentials/registry/api-credential-registry.ts,
 * ../../credentials/macos-keychain/index.ts.
 * สิ่งที่ห้ามแตะ: ห้าม return, log, หรือ persist `access_token`/secret ใดๆ
 * เกินกว่าที่จำเป็นสำหรับ verification ใน call นี้เท่านั้น — ทุกค่าที่บันทึก
 * ต้องเป็น `credential_ref`/metadata เท่านั้น.
 */

import type {
  AuthorizationStatusResult,
  BeginAuthorizationInput,
  BeginAuthorizationResult,
  CompleteAuthorizationResult,
  ProviderAuthorizationRecord,
  RevokeAuthorizationResult,
} from "./types";
import { findAuthorizationRecord, upsertAuthorizationRecord } from "./store";
import { pollForAccessToken, readGithubOauthClientId, requestDeviceCode } from "./github-device-flow";
import { sleepMilliseconds } from "./host-runtime";
import { attachCredential, buildConnectionId, discoverGitRemote, lookupConnection, registerConnection, updateConnectionStatus } from "../connection-registry/contract";
import { resolveGithubCredential } from "../github/credential-resolution";
import { getAuthenticatedUser, getRepository } from "../github/github-read-api";
import { findApiCredential, setApiCredentialStatus } from "../../credentials/registry/api-credential-registry";
import { registerOwnerApiCredential } from "../../credentials/macos-keychain/index";

const GITHUB_ADAPTER = "github";
const GITHUB_CONNECTION_TYPE = "SOURCE_AUTHORITY";
const GITHUB_DEVICE_FLOW_SCOPE = "repo";
/** Maximum time this process will actively poll GitHub before giving up and reporting `expired_token` — bounded well under GitHub's own 900s default device-code lifetime so a caller never hangs indefinitely. */
const MAX_POLL_WAIT_MILLISECONDS = 10 * 60_000;

export interface LifecycleDeps {
  discoverGitRemote: typeof discoverGitRemote;
  readClientId: typeof readGithubOauthClientId;
  requestDeviceCode: typeof requestDeviceCode;
  pollForAccessToken: typeof pollForAccessToken;
  registerConnection: typeof registerConnection;
  lookupConnection: typeof lookupConnection;
  attachCredential: typeof attachCredential;
  updateConnectionStatus: typeof updateConnectionStatus;
  registerOwnerApiCredential: typeof registerOwnerApiCredential;
  findApiCredential: typeof findApiCredential;
  setApiCredentialStatus: typeof setApiCredentialStatus;
  resolveGithubCredential: typeof resolveGithubCredential;
  getAuthenticatedUser: typeof getAuthenticatedUser;
  getRepository: typeof getRepository;
  findAuthorizationRecord: typeof findAuthorizationRecord;
  upsertAuthorizationRecord: typeof upsertAuthorizationRecord;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

const defaultDeps: LifecycleDeps = {
  discoverGitRemote,
  readClientId: readGithubOauthClientId,
  requestDeviceCode,
  pollForAccessToken,
  registerConnection,
  lookupConnection,
  attachCredential,
  updateConnectionStatus,
  registerOwnerApiCredential,
  findApiCredential,
  setApiCredentialStatus,
  resolveGithubCredential,
  getAuthenticatedUser,
  getRepository,
  findAuthorizationRecord,
  upsertAuthorizationRecord,
  sleep: sleepMilliseconds,
  now: () => new Date(),
};

function credentialRefFor(owner: string, repository: string): string {
  return `credential://github/${owner}/${repository}/source-authority`;
}

function keychainNamesFor(owner: string, repository: string): { service: string; account: string } {
  return { service: `dna-os-github-device-flow:${owner}/${repository}`, account: owner };
}

function emptyRecord(connection_id: string, provider: string, nowIso: string): ProviderAuthorizationRecord {
  return {
    connection_id,
    provider,
    account: null,
    state: "NOT_CONNECTED",
    credential_ref: null,
    granted_scope: null,
    device_code: null,
    device_code_expires_at: null,
    poll_interval_seconds: null,
    failure_reason: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function beginAuthorization(input: BeginAuthorizationInput, deps: LifecycleDeps = defaultDeps): Promise<BeginAuthorizationResult> {
  if (input.provider !== GITHUB_ADAPTER) return { ok: false, reason_code: "UNSUPPORTED_PROVIDER", detail: `provider "${input.provider}" is not supported — only "github" today` };

  const discovered = await deps.discoverGitRemote(input.cwd);
  if (!discovered.ok) return { ok: false, reason_code: discovered.reason, detail: discovered.detail };
  const target = { owner: discovered.value.owner, repository: discovered.value.repository, branch: discovered.value.branch };

  const connectionId = buildConnectionId({ adapter: GITHUB_ADAPTER, connection_type: GITHUB_CONNECTION_TYPE, target });
  const existingConnection = deps.lookupConnection({ connection_id: connectionId });
  if (!existingConnection) {
    deps.registerConnection({
      adapter: GITHUB_ADAPTER, connection_type: GITHUB_CONNECTION_TYPE,
      account_id: target.owner, software_id: "dna-os-infrastructure", target,
      credential_ref: { kind: "not_yet_built" }, status: "disconnected",
      executor_capability_id: null, scope: [],
    });
  }

  const nowIso = deps.now().toISOString();
  const existingRecord = deps.findAuthorizationRecord(connectionId);
  const base = existingRecord ?? emptyRecord(connectionId, GITHUB_ADAPTER, nowIso);

  const clientId = deps.readClientId();
  if (!clientId) {
    deps.upsertAuthorizationRecord({ ...base, state: "AUTHORIZATION_REQUIRED", failure_reason: "GITHUB_OAUTH_CLIENT_ID_NOT_CONFIGURED: no GitHub OAuth App (Device Flow enabled) client_id is configured — the Owner must create one at https://github.com/settings/developers and set GITHUB_OAUTH_CLIENT_ID", updated_at: nowIso });
    return { ok: false, reason_code: "GITHUB_OAUTH_CLIENT_ID_NOT_CONFIGURED", detail: "no GitHub OAuth App client_id configured — see GITHUB_OAUTH_CLIENT_ID" };
  }

  const deviceResult = await deps.requestDeviceCode(clientId, GITHUB_DEVICE_FLOW_SCOPE);
  if (!deviceResult.ok) {
    deps.upsertAuthorizationRecord({ ...base, state: "AUTHORIZATION_FAILED", failure_reason: `${deviceResult.reason_code}: ${deviceResult.detail}`, updated_at: nowIso });
    return { ok: false, reason_code: deviceResult.reason_code, detail: deviceResult.detail };
  }

  const expiresAt = new Date(deps.now().getTime() + deviceResult.expires_in * 1000).toISOString();
  deps.upsertAuthorizationRecord({
    ...base, state: "AUTHORIZATION_PENDING",
    device_code: deviceResult.device_code, device_code_expires_at: expiresAt,
    poll_interval_seconds: deviceResult.interval, failure_reason: null, updated_at: nowIso,
  });

  return { ok: true, connection_id: connectionId, user_code: deviceResult.user_code, verification_uri: deviceResult.verification_uri, expires_in: deviceResult.expires_in, interval: deviceResult.interval };
}

export function getAuthorizationStatus(connection_id: string, deps: LifecycleDeps = defaultDeps): AuthorizationStatusResult {
  const record = deps.findAuthorizationRecord(connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND" };
  return { ok: true, record };
}

/**
 * Blocks, polling GitHub at the Device Flow's own `interval` (honoring
 * `slow_down`), until the Owner approves in their browser, the device code
 * expires, or `MAX_POLL_WAIT_MILLISECONDS` passes — whichever is first.
 * Never fabricates a token; every non-success path reports the real
 * GitHub-reported reason.
 */
export async function completeAuthorization(connection_id: string, deps: LifecycleDeps = defaultDeps): Promise<CompleteAuthorizationResult> {
  const record = deps.findAuthorizationRecord(connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND", detail: `no authorization record for ${connection_id}`, record: null };
  if (record.state !== "AUTHORIZATION_PENDING" || !record.device_code) {
    return { ok: false, reason_code: "NO_PENDING_AUTHORIZATION", detail: `record state is "${record.state}", expected AUTHORIZATION_PENDING with a device_code`, record };
  }
  const clientId = deps.readClientId();
  if (!clientId) return { ok: false, reason_code: "GITHUB_OAUTH_CLIENT_ID_NOT_CONFIGURED", detail: "client_id disappeared between beginAuthorization and completeAuthorization", record };

  const connection = deps.lookupConnection({ connection_id });
  if (!connection || !connection.target) return { ok: false, reason_code: "CONNECTION_NOT_REGISTERED", detail: `no ConnectionRegistration with a real target for ${connection_id}`, record };
  const { owner, repository, branch } = connection.target;

  const deadline = Math.min(new Date(record.device_code_expires_at ?? deps.now().toISOString()).getTime(), deps.now().getTime() + MAX_POLL_WAIT_MILLISECONDS);
  let intervalMs = (record.poll_interval_seconds ?? 5) * 1000;
  let accessToken: string | null = null;
  let grantedScope: string | null = null;

  while (deps.now().getTime() < deadline) {
    await deps.sleep(intervalMs);
    const poll = await deps.pollForAccessToken(clientId, record.device_code);
    if (poll.ok) { accessToken = poll.access_token; grantedScope = poll.scope; break; }
    if (poll.reason_code === "authorization_pending") continue;
    if (poll.reason_code === "slow_down") { intervalMs += 5000; continue; }
    const failed: ProviderAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `${poll.reason_code}: ${poll.detail}`, device_code: null, updated_at: deps.now().toISOString() };
    deps.upsertAuthorizationRecord(failed);
    return { ok: false, reason_code: poll.reason_code, detail: poll.detail, record: failed };
  }

  if (!accessToken || !grantedScope) {
    const expired: ProviderAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: "expired_token: the Owner did not approve within the device code's lifetime", device_code: null, updated_at: deps.now().toISOString() };
    deps.upsertAuthorizationRecord(expired);
    return { ok: false, reason_code: "expired_token", detail: "device code expired before the Owner approved", record: expired };
  }

  const credentialRef = credentialRefFor(owner, repository);
  const { service, account } = keychainNamesFor(owner, repository);
  try {
    await deps.registerOwnerApiCredential({ requester_identity: "connections/provider-authorization/lifecycle.ts", credential_ref: credentialRef, provider: GITHUB_ADAPTER, account: owner, scope: [GITHUB_DEVICE_FLOW_SCOPE], service, keychainAccount: account, secret: accessToken });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CREDENTIAL_REF") {
      // The Keychain write (via -U, overwrite-safe) already happened inside registerOwnerApiCredential before this throw — only the metadata registry insert is a duplicate. Re-activate it.
      deps.setApiCredentialStatus(credentialRef, "ACTIVE");
    } else {
      const failed: ProviderAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `KEYCHAIN_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`, device_code: null, updated_at: deps.now().toISOString() };
      deps.upsertAuthorizationRecord(failed);
      return { ok: false, reason_code: "KEYCHAIN_REGISTRATION_FAILED", detail: error instanceof Error ? error.message : String(error), record: failed };
    }
  }
  accessToken = null; // discard the in-memory token now that it lives only in Keychain.

  const resolution = await deps.resolveGithubCredential({ ...connection, credential_ref: { kind: "keychain_ref", ref: credentialRef } });
  if (!resolution.ok) {
    const failed: ProviderAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `CREDENTIAL_RESOLUTION_FAILED: ${resolution.reason}`, device_code: null, updated_at: deps.now().toISOString() };
    deps.upsertAuthorizationRecord(failed);
    return { ok: false, reason_code: "CREDENTIAL_RESOLUTION_FAILED", detail: resolution.reason, record: failed };
  }

  const accountLookup = await deps.getAuthenticatedUser(resolution.token);
  if (accountLookup.kind !== "found") {
    const failed: ProviderAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `ACCOUNT_VERIFICATION_FAILED: ${accountLookup.reason}`, device_code: null, updated_at: deps.now().toISOString() };
    deps.upsertAuthorizationRecord(failed);
    return { ok: false, reason_code: "ACCOUNT_VERIFICATION_FAILED", detail: accountLookup.reason, record: failed };
  }

  const repoLookup = await deps.getRepository(resolution.token, { owner, repo: repository });
  if (repoLookup.kind !== "found") {
    const failed: ProviderAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `REPOSITORY_VERIFICATION_FAILED: ${repoLookup.kind === "failed" ? repoLookup.reason : repoLookup.reason}`, device_code: null, updated_at: deps.now().toISOString() };
    deps.upsertAuthorizationRecord(failed);
    return { ok: false, reason_code: "REPOSITORY_VERIFICATION_FAILED", detail: repoLookup.kind === "failed" ? repoLookup.reason : repoLookup.reason, record: failed };
  }

  deps.attachCredential(connection_id, { kind: "keychain_ref", ref: credentialRef }, "connected");

  const connected: ProviderAuthorizationRecord = {
    ...record, state: "CONNECTED", account: accountLookup.login, credential_ref: credentialRef,
    granted_scope: grantedScope.split(",").map((s) => s.trim()).filter((s) => s.length > 0),
    device_code: null, device_code_expires_at: null, failure_reason: null, updated_at: deps.now().toISOString(),
  };
  deps.upsertAuthorizationRecord(connected);

  return { ok: true, record: connected, account_verification: { login: accountLookup.login }, repository_verification: { owner, repository, branch } };
}

export function revokeAuthorization(connection_id: string, deps: LifecycleDeps = defaultDeps): RevokeAuthorizationResult {
  const record = deps.findAuthorizationRecord(connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND" };
  if (record.credential_ref) deps.setApiCredentialStatus(record.credential_ref, "REVOKED");
  deps.updateConnectionStatus(connection_id, "disconnected");
  const revoked: ProviderAuthorizationRecord = { ...record, state: "REVOKED", device_code: null, updated_at: deps.now().toISOString() };
  deps.upsertAuthorizationRecord(revoked);
  return { ok: true, record: revoked };
}
