import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacOsKeychainProvider } from "../../macos-keychain/provider";
import type { KeychainCommandRunner } from "../../macos-keychain/types";
import { createDatabaseCredentialReferenceStore, type DatabaseCredentialEntry } from "../database-credential-registry";
import { DatabaseCredentialResolver } from "../database-credential-resolver";

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

// A bounded test fixture — never a production secret, never a real
// Supabase target. The store never sees this string at all (it only ever
// persists DatabaseCredentialEntry metadata); it exists purely so the
// resolver/Keychain-layer checks below have something to assert on.
const TEST_ONLY_SECRET = "test-fixture-secret-not-real";

const FIXTURE: DatabaseCredentialEntry = {
  credential_ref: "credential://postgres/owner/test_fixture_db",
  credential_type: "postgres_database",
  owner: "owner",
  target: { host: "db.test-project.supabase.co", port: 5432, database: "test_fixture_db", role: "registry_writer", schema: "software_registry" },
  scope: ["database:connect", "software_registry:read", "software_registry:write"],
  status: "ACTIVE",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  resolver_kind: "macos_keychain",
  resolver_service: "dna-os-credential-registry-test",
  resolver_account: "test-fixture-account",
};

function fakeKeychain(secret: string): { provider: MacOsKeychainProvider; calls: Array<{ service: string; account: string }> } {
  const calls: Array<{ service: string; account: string }> = [];
  const run: KeychainCommandRunner = async (_executable, args) => {
    const service = args[args.indexOf("-s") + 1];
    const account = args[args.indexOf("-a") + 1];
    calls.push({ service, account });
    return { stdout: secret, stderr: "", exitCode: 0 };
  };
  return { provider: new MacOsKeychainProvider({ commandRunner: run, platform: "darwin", auditPath: "/tmp/dna-os-credential-registry-test-audit.jsonl" }), calls };
}

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "dna-os-credential-registry-test-"));

  try {
    // A. Register a test reference through the bounded test fixture store — no production secret anywhere here.
    const storeInstanceOne = createDatabaseCredentialReferenceStore(tempDir);
    await check("A. registers a test reference via the bounded fixture store", async () => {
      storeInstanceOne.registerDatabaseCredential(FIXTURE);
      assert(storeInstanceOne.findDatabaseCredential(FIXTURE.credential_ref) !== null, "expected the just-registered entry to be findable in the same instance");
    });

    // B/C. A brand-new store instance over the SAME directory simulates a
    // process restart — nothing here is shared in-process memory.
    const storeInstanceTwo = createDatabaseCredentialReferenceStore(tempDir);
    await check("B/C. a new store instance loads the same credential_ref back after a simulated restart", async () => {
      const reloaded = storeInstanceTwo.findDatabaseCredential(FIXTURE.credential_ref);
      assert(reloaded !== null, "expected the entry to survive a fresh store instance");
      assert(reloaded?.resolver_service === FIXTURE.resolver_service, "resolver_service did not survive restart");
      assert(reloaded?.resolver_account === FIXTURE.resolver_account, "resolver_account did not survive restart");
      assert(reloaded?.status === "ACTIVE", "status did not survive restart");
    });

    // D/E. The resolver, backed by the post-restart store instance, uses
    // the persisted service/account (never guessed from credential_ref)
    // and resolves an ACTIVE reference via the (fake) Keychain.
    await check("D/E. resolver uses persisted service/account and resolves an ACTIVE reference", async () => {
      const { provider, calls } = fakeKeychain(TEST_ONLY_SECRET);
      const resolver = new DatabaseCredentialResolver(provider, { findDatabaseCredential: (ref) => storeInstanceTwo.findDatabaseCredential(ref) });
      const result = await resolver.resolve(FIXTURE.credential_ref);
      assert(result.ok && result.secret === TEST_ONLY_SECRET, "expected the fixture secret to resolve");
      assert(calls.length === 1, "expected exactly one Keychain call");
      assert(calls[0]?.service === FIXTURE.resolver_service && calls[0]?.account === FIXTURE.resolver_account, "resolver did not use the persisted service/account");
    });

    // F. A REVOKED reference is rejected without ever calling Keychain.
    await check("F. a REVOKED reference is rejected before any Keychain call", async () => {
      storeInstanceTwo.setDatabaseCredentialStatus(FIXTURE.credential_ref, "REVOKED");
      const { provider, calls } = fakeKeychain(TEST_ONLY_SECRET);
      const resolver = new DatabaseCredentialResolver(provider, { findDatabaseCredential: (ref) => storeInstanceTwo.findDatabaseCredential(ref) });
      const result = await resolver.resolve(FIXTURE.credential_ref);
      assert(!result.ok && result.reason === "CREDENTIAL_REVOKED", "expected CREDENTIAL_REVOKED rejection");
      assert(calls.length === 0, "revoked reference must never reach Keychain");
    });

    // Revoke must not touch Keychain and must not delete the secret — the
    // metadata update above changed only status/updated_at; confirm the
    // rest of the entry (including resolver identity) is untouched.
    await check("revoke only updates status/updated_at, never resolver identity", async () => {
      const entry = storeInstanceTwo.findDatabaseCredential(FIXTURE.credential_ref);
      assert(entry?.status === "REVOKED", "expected REVOKED status");
      assert(entry?.resolver_service === FIXTURE.resolver_service, "resolver_service must be unchanged by revoke");
      assert(entry?.resolver_account === FIXTURE.resolver_account, "resolver_account must be unchanged by revoke");
      assert(entry?.updated_at !== FIXTURE.updated_at, "expected updated_at to change on revoke");
    });

    // G. An unknown credential_ref is rejected as CREDENTIAL_NOT_REGISTERED.
    await check("G. an unknown credential_ref is rejected as CREDENTIAL_NOT_REGISTERED", async () => {
      const { provider, calls } = fakeKeychain(TEST_ONLY_SECRET);
      const resolver = new DatabaseCredentialResolver(provider, { findDatabaseCredential: (ref) => storeInstanceTwo.findDatabaseCredential(ref) });
      const result = await resolver.resolve("credential://postgres/owner/does-not-exist");
      assert(!result.ok && result.code === "NOT_FOUND" && result.reason === "CREDENTIAL_NOT_REGISTERED", "expected CREDENTIAL_NOT_REGISTERED");
      assert(calls.length === 0, "unknown reference must never reach Keychain");
    });

    // H. The persisted file on disk holds metadata only — no secret, no connection string.
    await check("H. the persisted store file contains no secret and no connection string", async () => {
      const raw = readFileSync(join(tempDir, "database-credential-references.jsonl"), "utf-8");
      assert(!raw.includes(TEST_ONLY_SECRET), "fixture secret leaked into the persisted store file");
      assert(!/postgres(ql)?:\/\//i.test(raw), "a connection string leaked into the persisted store file");
      assert(raw.includes(FIXTURE.credential_ref), "expected the credential_ref to be present as metadata");
      assert(raw.includes(FIXTURE.resolver_service), "expected resolver_service to be present as metadata");
    });

    // Duplicate registration of the same credential_ref is rejected —
    // unchanged behavior from before persistence, now checked against disk.
    await check("duplicate registration of the same credential_ref is rejected", async () => {
      let threw = false;
      try {
        storeInstanceTwo.registerDatabaseCredential(FIXTURE);
      } catch (error) {
        threw = error instanceof Error && error.message === "DUPLICATE_CREDENTIAL_REF";
      }
      assert(threw, "expected DUPLICATE_CREDENTIAL_REF");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
