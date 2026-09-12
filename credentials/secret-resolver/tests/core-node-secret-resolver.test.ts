/**
 * Step 4 — portable CORE_NODE secret resolution.
 * Fake values only. Never prints secret material. Never talks to a real
 * Keychain, GitHub, Railway, or Supabase API.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  setRuntimeNodePlatformForTests,
  providerIsExecutionAuthority,
} from "../../../contracts/architecture/runtime-node-and-optional-provider";
import { MacOsKeychainProvider } from "../../macos-keychain/provider";
import type { KeychainCommandRunner } from "../../macos-keychain/types";
import {
  DIRECT_RUNTIME_ENV_SECRETS,
  MAC_LOCAL_AGENT_ONLY_CREDENTIAL_REFS,
  ProcessEnvironmentSecretProvider,
  RAILWAY_CORE_CREDENTIAL_REF,
  RAILWAY_CORE_ENV_VAR,
  SUPABASE_SCHEMA_READ_CREDENTIAL_REF,
  lookupCoreProcessEnvBinding,
  resolveProcessEnvironmentSecret,
} from "../../process-environment";
import {
  optionalProviderSecretStatus,
  publicSecretOutcome,
  railwayAdapterAvailability,
  resolveNodeCredential,
  secretResolutionBackend,
} from "../index";
import { resolveGithubCredential } from "../../../connections/github/credential-resolution";
import { isRegisteredGithubSourceAuthorityTarget } from "../../../connections/github/authoritative-source";
import { railwayGraphql } from "../../../connections/railway/graphql";
import type { ConnectionRegistration } from "../../../contracts/connector/connection";

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  cwd(): string;
};
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const FAKE = "fake-step4-secret-never-production-9f3a";
const FAKE_ENV_MUST_NOT_WIN = "fake-env-must-not-win-on-darwin";
const GITHUB_REF = "credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority";
const UNKNOWN_REF = "credential://unknown-provider/not-mapped/secret";

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

function assertNoSecretInText(text: string, label: string): void {
  assert(!text.includes(FAKE), `${label} leaked FAKE`);
  assert(!text.includes(FAKE_ENV_MUST_NOT_WIN), `${label} leaked FAKE_ENV`);
}

function githubConnection(ref: string): ConnectionRegistration {
  return {
    connection_id: "conn-step4-test",
    account_id: "account-step4-test",
    software_id: "dna-os-infrastructure",
    adapter: "github",
    credential_ref: { kind: "keychain_ref", ref },
    status: "connected",
  };
}

async function main(): Promise<void> {
  const savedPat = process.env.GITHUB_PAT_INFRASTRUCTURE;
  const savedRailway = process.env.RAILWAY_PROJECT_TOKEN;
  const savedSupabase = process.env.SUPABASE_SCHEMA_READ_TOKEN;
  const originalResolve = MacOsKeychainProvider.prototype.resolve;
  let keychainResolveCalls = 0;
  MacOsKeychainProvider.prototype.resolve = function (...args) {
    keychainResolveCalls += 1;
    return originalResolve.apply(this, args);
  };

  try {
    await check("CORE_NODE backend is process_environment on linux", () => {
      setRuntimeNodePlatformForTests("linux");
      assert(secretResolutionBackend("CORE_NODE") === "process_environment", "expected process_environment");
    });

    await check("MAC_LOCAL_AGENT / darwin backend is macos_keychain", () => {
      setRuntimeNodePlatformForTests("darwin");
      assert(secretResolutionBackend("CORE_NODE") === "macos_keychain", "expected keychain on darwin");
      assert(secretResolutionBackend("MAC_LOCAL_AGENT") === "macos_keychain", "expected keychain for agent");
    });

    await check("CORE_NODE resolves an explicitly mapped env secret", async () => {
      setRuntimeNodePlatformForTests("linux");
      keychainResolveCalls = 0;
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE;
      const isolated = new ProcessEnvironmentSecretProvider((name) =>
        name === "GITHUB_PAT_INFRASTRUCTURE" ? FAKE : undefined,
      );
      const mapped = isolated.resolve(GITHUB_REF);
      assert(mapped.ok === true, "isolated map failed");
      if (!mapped.ok) return;
      assert(mapped.credential_source === "env:GITHUB_PAT_INFRASTRUCTURE", mapped.credential_source);
      const viaGithub = await resolveGithubCredential(githubConnection(GITHUB_REF));
      assert(viaGithub.ok === true, "github CORE resolve failed");
      if (!viaGithub.ok) return;
      assert(viaGithub.credential_source === "env:GITHUB_PAT_INFRASTRUCTURE", viaGithub.credential_source);
      assert(keychainResolveCalls === 0, `Keychain invoked ${keychainResolveCalls} times`);
    });

    await check("missing env secret fails closed", () => {
      setRuntimeNodePlatformForTests("linux");
      delete process.env.GITHUB_PAT_INFRASTRUCTURE;
      const missing = resolveProcessEnvironmentSecret(GITHUB_REF);
      assert(missing.ok === false && missing.code === "NOT_CONFIGURED", JSON.stringify(missing.ok ? {} : { code: missing.code }));
    });

    await check("unknown credential_ref fails closed", () => {
      setRuntimeNodePlatformForTests("linux");
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE;
      const unknown = resolveProcessEnvironmentSecret(UNKNOWN_REF);
      assert(unknown.ok === false && unknown.code === "NOT_FOUND", "unknown must NOT_FOUND");
      assert(lookupCoreProcessEnvBinding(UNKNOWN_REF) === null, "unknown leaked into map");
    });

    await check("arbitrary credential_ref cannot select an arbitrary env var", () => {
      setRuntimeNodePlatformForTests("linux");
      const attacker = `credential://github/${FAKE}/pwned`;
      const result = new ProcessEnvironmentSecretProvider((name) => {
        throw new Error(`env enumerated or guessed: ${name}`);
      }).resolve(attacker);
      assert(result.ok === false && result.code === "NOT_FOUND", "attacker ref resolved");
    });

    await check("CORE_NODE never invokes MacOsKeychainProvider.resolve", async () => {
      setRuntimeNodePlatformForTests("linux");
      keychainResolveCalls = 0;
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE;
      await resolveNodeCredential(GITHUB_REF, { current_node: "CORE_NODE" });
      await resolveGithubCredential(githubConnection(GITHUB_REF), new MacOsKeychainProvider({
        platform: "linux",
        commandRunner: async () => {
          throw new Error("commandRunner must not run on CORE_NODE");
        },
      }));
      delete process.env.RAILWAY_PROJECT_TOKEN;
      await railwayGraphql("query { __typename }", {}, new MacOsKeychainProvider({
        platform: "linux",
        commandRunner: async () => {
          throw new Error("railway must not call Keychain on CORE_NODE");
        },
      }));
      assert(keychainResolveCalls === 0, `Keychain resolve called ${keychainResolveCalls} times on CORE`);
    });

    await check("MAC_LOCAL_AGENT still uses Keychain path", async () => {
      setRuntimeNodePlatformForTests("darwin");
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE_ENV_MUST_NOT_WIN;
      const runner: KeychainCommandRunner = async () => ({
        stdout: "dummy-test-token-never-real",
        stderr: "",
        exitCode: 0,
      });
      const provider = new MacOsKeychainProvider({
        commandRunner: runner,
        platform: "darwin",
        auditPath: "/tmp/dna-os-step4-keychain-test-audit.jsonl",
      });
      const result = await resolveGithubCredential(githubConnection(GITHUB_REF), provider);
      assert(result.ok === true, "darwin github resolve failed");
      if (!result.ok) return;
      assert(result.credential_source.startsWith("keychain:"), result.credential_source);
    });

    await check("optional Railway secret missing does not stop Core startup", async () => {
      setRuntimeNodePlatformForTests("linux");
      delete process.env.RAILWAY_PROJECT_TOKEN;
      const status = railwayAdapterAvailability();
      assert(status.core_startup_blocked === false, "Core startup blocked");
      assert(status.available === false, "missing railway marked available");
      assert(status.code === "NOT_CONFIGURED", String(status.code));
      const graphql = await railwayGraphql("query { __typename }", {}, new MacOsKeychainProvider({ platform: "linux" }));
      assert(graphql.auth_required === true, "railway should be unavailable");
      assert(!graphql.summary.includes(FAKE), "summary leaked fake");
      const optional = optionalProviderSecretStatus(RAILWAY_CORE_CREDENTIAL_REF);
      assert(optional.core_startup_blocked === false, "optional helper blocked Core");
    });

    await check("GitHub credential availability does not bypass repository/connection authority", async () => {
      setRuntimeNodePlatformForTests("linux");
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE;
      const resolved = await resolveGithubCredential(githubConnection(GITHUB_REF));
      assert(resolved.ok === true, "token should resolve");
      assert(providerIsExecutionAuthority("github") === false, "github became execution authority");
      assert(
        isRegisteredGithubSourceAuthorityTarget({ owner: "attacker-org", repo: "arbitrary-repo" }) === false,
        "unregistered repo treated as publish target",
      );
      const sourceExec = readFileSync(join(process.cwd(), "control/source-execution/resolver.ts"), "utf8");
      const fn = sourceExec.slice(sourceExec.indexOf("export async function executeSource"));
      const connIdx = fn.indexOf("GITHUB_CONNECTION_NOT_REGISTERED");
      const credIdx = fn.indexOf("const credential = await resolveGithubCredential");
      const writeIdx = fn.indexOf("putFileContents(credential.token");
      assert(connIdx > 0 && credIdx > connIdx, "credential resolved before connection check");
      assert(writeIdx > credIdx, "write before credential");
    });

    await check("secret never appears in serialized error/status/evidence", async () => {
      setRuntimeNodePlatformForTests("linux");
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE;
      const ok = resolveProcessEnvironmentSecret(GITHUB_REF);
      const published = publicSecretOutcome(ok);
      const publishedJson = JSON.stringify(published);
      assertNoSecretInText(publishedJson, "public ok outcome");
      assert(!("secret" in published), "public outcome has secret field");
      delete process.env.GITHUB_PAT_INFRASTRUCTURE;
      const missing = resolveProcessEnvironmentSecret(GITHUB_REF);
      const failJson = JSON.stringify(missing);
      assertNoSecretInText(failJson, "missing env failure");
      const ghFail = await resolveGithubCredential(githubConnection(GITHUB_REF));
      assert(ghFail.ok === false, "expected fail");
      if (!ghFail.ok) assertNoSecretInText(JSON.stringify(ghFail), "github fail");
      process.env.GITHUB_PAT_INFRASTRUCTURE = FAKE;
      const railwayMissing = await railwayGraphql("query { __typename }", {}, new MacOsKeychainProvider({ platform: "linux" }));
      assertNoSecretInText(JSON.stringify(railwayMissing), "railway status");
    });

    await check("direct shared-secret env vars remain portable and unmapped", () => {
      for (const name of DIRECT_RUNTIME_ENV_SECRETS) {
        assert(lookupCoreProcessEnvBinding(`credential://internal/${name}`) === null, `${name} entered credential map`);
      }
      const ownerHttp = readFileSync(join(process.cwd(), "transport/owner-command-http/server.ts"), "utf8");
      const joint = readFileSync(join(process.cwd(), "observability/joint-monitor/server.ts"), "utf8");
      const circuit = readFileSync(join(process.cwd(), "dna-os-circuit/runtime/server.ts"), "utf8");
      assert(ownerHttp.includes("process.env.OWNER_COMMAND_HTTP_SHARED_SECRET"), "owner http lost direct env");
      assert(joint.includes("process.env.JOINT_MONITOR_SHARED_SECRET"), "joint monitor lost direct env");
      assert(circuit.includes("process.env.DNA_OS_CIRCUIT_SHARED_SECRET"), "circuit lost direct env");
      const mapping = readFileSync(join(process.cwd(), "credentials/process-environment/mapping.ts"), "utf8");
      assert(mapping.includes("DIRECT_RUNTIME_ENV_SECRETS"), "distinction undocumented");
      assert(!mapping.includes("OWNER_COMMAND_HTTP_SHARED_SECRET:"), "shared secret mapped as binding env");
    });

    await check("Google Workspace OAuth refs stay Mac-only", () => {
      setRuntimeNodePlatformForTests("linux");
      for (const ref of MAC_LOCAL_AGENT_ONLY_CREDENTIAL_REFS) {
        const resolution = resolveProcessEnvironmentSecret(ref);
        assert(resolution.ok === false && resolution.code === "DENIED", ref);
      }
    });

    await check("Supabase DATA_SERVICE env is optional for Core boot", () => {
      setRuntimeNodePlatformForTests("linux");
      delete process.env.SUPABASE_SCHEMA_READ_TOKEN;
      const missing = resolveProcessEnvironmentSecret(SUPABASE_SCHEMA_READ_CREDENTIAL_REF);
      assert(missing.ok === false && missing.code === "NOT_CONFIGURED", "supabase missing should fail closed at adapter");
      const status = optionalProviderSecretStatus(SUPABASE_SCHEMA_READ_CREDENTIAL_REF);
      assert(status.core_startup_blocked === false, "supabase blocked Core");
    });

    await check("Railway env mapping is explicit RAILWAY_PROJECT_TOKEN only", () => {
      const binding = lookupCoreProcessEnvBinding(RAILWAY_CORE_CREDENTIAL_REF);
      assert(binding !== null && binding.env_var === RAILWAY_CORE_ENV_VAR, "railway map drifted");
      const isolated = new ProcessEnvironmentSecretProvider((name) => {
        if (name === "RAILWAY_TOKEN") return FAKE;
        return undefined;
      });
      const wrongName = isolated.resolve(RAILWAY_CORE_CREDENTIAL_REF);
      assert(wrongName.ok === false && wrongName.code === "NOT_CONFIGURED", "RAILWAY_TOKEN must not be an implicit alias");
    });

    await check("no real credentials accessed (fake values + no security binary)", () => {
      const providerSrc = readFileSync(join(process.cwd(), "credentials/process-environment/provider.ts"), "utf8");
      assert(!providerSrc.includes("/usr/bin/security"), "process-environment called security");
      assert(!providerSrc.includes("Object.keys(process.env)"), "env enumerated");
      assert(!providerSrc.includes("Object.entries(process.env)"), "env enumerated entries");
    });
  } finally {
    MacOsKeychainProvider.prototype.resolve = originalResolve;
    setRuntimeNodePlatformForTests(undefined);
    if (savedPat === undefined) delete process.env.GITHUB_PAT_INFRASTRUCTURE;
    else process.env.GITHUB_PAT_INFRASTRUCTURE = savedPat;
    if (savedRailway === undefined) delete process.env.RAILWAY_PROJECT_TOKEN;
    else process.env.RAILWAY_PROJECT_TOKEN = savedRailway;
    if (savedSupabase === undefined) delete process.env.SUPABASE_SCHEMA_READ_TOKEN;
    else process.env.SUPABASE_SCHEMA_READ_TOKEN = savedSupabase;
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
