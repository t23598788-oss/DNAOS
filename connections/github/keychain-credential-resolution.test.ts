/**
 * หน้าที่: proves the canonical Keychain-backed credential resolution
 * wiring in ./credential-resolution.ts — `credential_ref` -> the real
 * `credentials/registry/api-credential-registry.ts` lookup -> the real
 * `MacOsKeychainProvider.resolve()` call shape, with an INJECTED command
 * runner (the same testability seam `credentials/macos-keychain/tests/
 * provider.test.ts` already establishes and relies on) — never a second
 * real OS Keychain write per test run, and never a real secret value
 * anywhere in this file.
 *
 * Registers real, uniquely-suffixed fixture entries into the real
 * `credentials/registry/data/api-credential-references.jsonl` (the same
 * store `resolveGithubCredential` itself reads at runtime) — this proves
 * the actual production lookup path, not an isolated copy of it.
 *
 * How to run: npx tsx connections/github/keychain-credential-resolution.test.ts
 */

import { readFileSync } from "node:fs";
import { registerApiCredential } from "../../credentials/registry/api-credential-registry";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/index";
import { resolveGithubCredential } from "./credential-resolution";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import type { KeychainCommandRunner } from "../../credentials/macos-keychain/types";

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

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function connectionFixture(credential_ref: ConnectionRegistration["credential_ref"]): ConnectionRegistration {
  return { connection_id: `conn-keychain-test-${uniq}`, account_id: "account-keychain-test", software_id: "dna-os-infrastructure", adapter: "github", credential_ref, status: "connected" };
}

async function main(): Promise<void> {
  // E. raw PAT never persisted outside Keychain (static source proof).
  await check("E. raw PAT never persisted outside Keychain — static source proof", () => {
    const registrySource = readFileSync(new URL("../../credentials/registry/api-credential-registry.ts", import.meta.url), "utf8");
    const entryInterface = registrySource.slice(registrySource.indexOf("export interface ApiCredentialEntry"), registrySource.indexOf("export interface ApiCredentialReferenceStore"));
    const fieldNames = [...entryInterface.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]!.toLowerCase());
    assert(!fieldNames.some((name) => name.includes("secret") || name.includes("token") || name.includes("password")), `ApiCredentialEntry's own field names must never name a secret/token field, got fields: ${JSON.stringify(fieldNames)}`);
    const apiRegSource = readFileSync(new URL("../../credentials/macos-keychain/api-registration.ts", import.meta.url), "utf8");
    assert(apiRegSource.includes("add-generic-password"), "expected the real Keychain write command");
    assert(!apiRegSource.includes("registerApiCredential({ ...input"), "the secret must never be spread into the registry entry");
    assert(!apiRegSource.match(/registerApiCredential\([^)]*secret/s), "input.secret must never be passed into registerApiCredential's entry");
    const resolutionSource = readFileSync(new URL("./credential-resolution.ts", import.meta.url), "utf8");
    assert(!resolutionSource.includes("console.log(") && !resolutionSource.includes("hostLog("), "credential-resolution.ts must never log anything, secret or otherwise");
  });

  // F. credential_ref resolves through Keychain (real lookup, injected OS call).
  await check("F. credential_ref resolves through the real registry lookup + Keychain provider wiring", async () => {
    const ref = `credential://github/test-fixture-owner/test-fixture-repo-${uniq}/source-authority`;
    registerApiCredential({
      credential_ref: ref, provider: "github", account: "test-fixture-owner", scope: ["WRITE_SOURCE"], status: "ACTIVE",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      resolver_kind: "macos_keychain", resolver_service: `dna-os-github-test-${uniq}`, resolver_account: "test-fixture-owner",
    });
    const calledWith: { service: string; account: string } = { service: "", account: "" };
    const runner: KeychainCommandRunner = async (_exe, args) => {
      calledWith.service = args[2]!;
      calledWith.account = args[4]!;
      return { stdout: "dummy-test-token-never-real", stderr: "", exitCode: 0 };
    };
    const provider = new MacOsKeychainProvider({ commandRunner: runner, platform: "darwin", auditPath: "/tmp/dna-os-github-keychain-test-audit.jsonl" });
    const result = await resolveGithubCredential(connectionFixture({ kind: "keychain_ref", ref }), provider);
    assert(result.ok, `expected the credential to resolve, got ${result.ok ? "" : result.reason}`);
    if (result.ok) {
      assert(result.token === "dummy-test-token-never-real", "expected the injected test token to come through unchanged");
      assert(result.credential_source.startsWith("keychain:"), `expected a keychain: credential_source, got ${result.credential_source}`);
    }
    assert(calledWith.service === `dna-os-github-test-${uniq}` && calledWith.account === "test-fixture-owner", "expected the real registered service/account to reach the Keychain call");
  });

  // G. missing Keychain secret -> UNRESOLVED-shaped refusal (never a fabricated token).
  await check("G. missing Keychain secret -> honest refusal, never a fabricated token", async () => {
    const ref = `credential://github/test-fixture-owner/test-fixture-repo-missing-${uniq}/source-authority`;
    registerApiCredential({
      credential_ref: ref, provider: "github", account: "test-fixture-owner", scope: ["WRITE_SOURCE"], status: "ACTIVE",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      resolver_kind: "macos_keychain", resolver_service: `dna-os-github-test-missing-${uniq}`, resolver_account: "test-fixture-owner",
    });
    const runner: KeychainCommandRunner = async () => ({ stdout: "", stderr: "The specified item could not be found in the keychain.", exitCode: 44 });
    const provider = new MacOsKeychainProvider({ commandRunner: runner, platform: "darwin", auditPath: "/tmp/dna-os-github-keychain-test-audit.jsonl" });
    const result = await resolveGithubCredential(connectionFixture({ kind: "keychain_ref", ref }), provider);
    assert(!result.ok, "expected a real refusal when the Keychain item is genuinely absent");
  });

  // An unregistered credential_ref is refused too — never guessed.
  await check("an unregistered credential_ref is refused honestly", async () => {
    const result = await resolveGithubCredential(connectionFixture({ kind: "keychain_ref", ref: `credential://github/never-registered-${uniq}/x/source-authority` }));
    assert(!result.ok, "expected refusal for a credential_ref with no registered entry");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
