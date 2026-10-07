/**
 * Deterministic credential rebind lifecycle: UNBOUND -> REBIND_REQUIRED -> VERIFIED.
 * Never returns or persists raw secrets.
 *
 * How to run:
 *   npx tsx connections/github/credential-rebind.test.ts
 */

import { registerApiCredential } from "../../credentials/registry/api-credential-registry";
import { MacOsKeychainProvider } from "../../credentials/macos-keychain/index";
import type { KeychainCommandRunner } from "../../credentials/macos-keychain/types";
import type { ConnectionRegistration } from "../../contracts/connector/connection";
import { credentialBindReportExposesSecret, inspectGithubCredentialBind, verifyGithubCredentialBind } from "./credential-rebind";

declare const process: { exitCode?: number };
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

function connection(ref: ConnectionRegistration["credential_ref"]): ConnectionRegistration {
  return {
    connection_id: `conn-rebind-${uniq}`,
    account_id: "account-rebind-test",
    software_id: "dna-os-infrastructure",
    adapter: "github",
    credential_ref: ref,
    status: "connected",
  };
}

async function main(): Promise<void> {
  await check("G. missing connection is UNBOUND", () => {
    const report = inspectGithubCredentialBind(null);
    assert(report.state === "UNBOUND", report.state);
    assert(report.secret_exposed === false, "must not expose secrets");
    assert(!credentialBindReportExposesSecret(report), "report must not contain token material");
  });

  await check("G. keychain_ref without verification is REBIND_REQUIRED", () => {
    const report = inspectGithubCredentialBind(connection({
      kind: "keychain_ref",
      ref: `credential://github/test-rebind/${uniq}/source-authority`,
    }));
    assert(report.state === "REBIND_REQUIRED", report.state);
    assert(report.credential_ref?.startsWith("credential://github/") === true, String(report.credential_ref));
    assert(report.credential_source === null, "must not claim verification before resolve");
  });

  await check("H. verify rebind succeeds without returning the secret", async () => {
    const ref = `credential://github/test-rebind-owner/test-rebind-repo-${uniq}/source-authority`;
    registerApiCredential({
      credential_ref: ref,
      provider: "github",
      account: "test-rebind-owner",
      scope: ["WRITE_SOURCE"],
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resolver_kind: "macos_keychain",
      resolver_service: `dna-os-github-rebind-${uniq}`,
      resolver_account: "test-rebind-owner",
    });
    const runner: KeychainCommandRunner = async () => ({
      stdout: "ghp_this_dummy_token_must_never_appear_in_the_bind_report_value",
      stderr: "",
      exitCode: 0,
    });
    const provider = new MacOsKeychainProvider({
      commandRunner: runner,
      platform: "darwin",
      auditPath: "/tmp/dna-os-github-rebind-test-audit.jsonl",
    });
    const report = await verifyGithubCredentialBind(connection({ kind: "keychain_ref", ref }), provider);
    assert(report.state === "VERIFIED", report.detail);
    assert(report.secret_exposed === false, "secret_exposed must be false");
    assert(typeof report.credential_source === "string" && report.credential_source.startsWith("keychain:"), String(report.credential_source));
    assert(!credentialBindReportExposesSecret(report), "verified report must not include the token");
    assert(!JSON.stringify(report).includes("ghp_"), "JSON report must not include token prefix");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
