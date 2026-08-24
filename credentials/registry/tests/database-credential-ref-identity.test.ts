import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacOsKeychainProvider } from "../../macos-keychain/provider";
import type { KeychainCommandRunner } from "../../macos-keychain/types";
import { buildDatabaseCredentialRef, createDatabaseCredentialReferenceStore, type DatabaseCredentialEntry } from "../database-credential-registry";
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

const TEST_ONLY_SECRET = "test-fixture-secret-not-real";
const OWNER_A = "owner";
const LOCAL = { host: "127.0.0.1", port: 5432, database: "postgres", role: "registry_writer" };
const SUPABASE = { host: "db.test-project.supabase.co", port: 5432, database: "postgres", role: "registry_writer" };

async function main(): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), "dna-os-credential-ref-identity-test-"));

  try {
    let refA = "";
    let refB = "";

    // 1/2/3. Same owner, local vs Supabase — must no longer collide now
    // that host+port are part of the identity.
    await check("1/2/3. local and Supabase targets for the same owner produce different refs", () => {
      refA = buildDatabaseCredentialRef({ owner: OWNER_A, ...LOCAL });
      refB = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE });
      assert(refA !== refB, "local and Supabase refs must differ despite identical owner+database+port+role");
    });

    // 4. Determinism.
    await check("4. identical target input produces the identical ref", () => {
      const first = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE });
      const second = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE });
      assert(first === second, "expected a deterministic ref for identical input");
    });

    // 5. Role changes the ref.
    await check("5. a different role produces a different ref", () => {
      const writer = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, role: "registry_writer" });
      const reader = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, role: "software_registry_runtime" });
      assert(writer !== reader, "expected role to change the ref");
    });

    await check("a different host produces a different ref", () => {
      const a = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, host: "db.project-a.supabase.co" });
      const b = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, host: "db.project-b.supabase.co" });
      assert(a !== b, "expected host to change the ref");
    });

    await check("a different port produces a different ref", () => {
      const a = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, port: 5432 });
      const b = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, port: 6543 });
      assert(a !== b, "expected port to change the ref");
    });

    await check("a different database produces a different ref", () => {
      const a = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, database: "postgres" });
      const b = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE, database: "other_db" });
      assert(a !== b, "expected database to change the ref");
    });

    await check("the ref never carries a password/secret-shaped component", () => {
      const ref = buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE });
      assert(!/[?&]password=|:\/\/[^/]*:[^/@]*@/i.test(ref), "ref must never embed a password");
      assert(!ref.includes(TEST_ONLY_SECRET), "ref must never embed a secret value");
    });

    // 6/7. Register under the new ref format, simulate a restart, resolve.
    const entry: DatabaseCredentialEntry = {
      credential_ref: buildDatabaseCredentialRef({ owner: OWNER_A, ...SUPABASE }),
      credential_type: "postgres_database",
      owner: OWNER_A,
      target: { ...SUPABASE, schema: "software_registry" },
      scope: ["database:connect", "software_registry:read", "software_registry:write"],
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      resolver_kind: "macos_keychain",
      resolver_service: "dna-os-ref-identity-test",
      resolver_account: "test-fixture-account",
    };

    const storeInstanceOne = createDatabaseCredentialReferenceStore(tempDir);
    await check("registers a credential under the new canonical ref format", () => {
      storeInstanceOne.registerDatabaseCredential(entry);
      assert(storeInstanceOne.findDatabaseCredential(entry.credential_ref) !== null, "expected the entry to be findable immediately");
    });

    const storeInstanceTwo = createDatabaseCredentialReferenceStore(tempDir);
    await check("6. a new store instance (simulated restart) finds the same canonical ref", () => {
      const reloaded = storeInstanceTwo.findDatabaseCredential(entry.credential_ref);
      assert(reloaded !== null, "expected the entry to survive a simulated restart");
      assert(reloaded?.target.host === SUPABASE.host, "expected persisted host to match");
      assert(reloaded?.target.port === SUPABASE.port, "expected persisted port to match");
    });

    await check("7. resolver resolves correctly using the new ref format's persisted metadata", async () => {
      const calls: Array<{ service: string; account: string }> = [];
      const run: KeychainCommandRunner = async (_executable, args) => {
        calls.push({ service: args[args.indexOf("-s") + 1], account: args[args.indexOf("-a") + 1] });
        return { stdout: TEST_ONLY_SECRET, stderr: "", exitCode: 0 };
      };
      const provider = new MacOsKeychainProvider({ commandRunner: run, platform: "darwin", auditPath: "/tmp/dna-os-ref-identity-test-audit.jsonl" });
      const resolver = new DatabaseCredentialResolver(provider, { findDatabaseCredential: (ref) => storeInstanceTwo.findDatabaseCredential(ref) });
      const result = await resolver.resolve(entry.credential_ref);
      assert(result.ok && result.secret === TEST_ONLY_SECRET, "expected resolver to resolve via persisted metadata");
      assert(calls[0]?.service === entry.resolver_service && calls[0]?.account === entry.resolver_account, "resolver used the wrong service/account");
    });

    // 8. No secret anywhere: not in the ref, not in the persisted file.
    await check("8. no secret appears in the ref or the persisted store file", () => {
      const localRef = buildDatabaseCredentialRef({ owner: OWNER_A, ...LOCAL });
      assert(localRef !== entry.credential_ref, "local and Supabase refs must remain distinct in the persisted store too");
      const raw = readFileSync(join(tempDir, "database-credential-references.jsonl"), "utf-8");
      assert(!raw.includes(TEST_ONLY_SECRET), "secret leaked into the persisted store file");
      assert(!/postgres(ql)?:\/\//i.test(raw), "a raw connection string leaked into the persisted store file");
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
