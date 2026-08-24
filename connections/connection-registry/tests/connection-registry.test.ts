/**
 * หน้าที่: proves the Connection Registry — real git discovery against
 * THIS actual repository (no fixture, no fabricated remote), deterministic
 * identity, idempotent re-registration, and real restart-survival via an
 * isolated temp data directory (same `baseDir` testability pattern
 * `credentials/registry/tests/*.ts` already use).
 *
 * How to run: npx tsx connections/connection-registry/tests/connection-registry.test.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverGitRemote } from "../git-discovery";
import { buildConnectionId, createConnectionRegistryStore } from "../registry";
import type { GitRemoteDiscovery } from "../types";

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

async function main(): Promise<void> {
  // A. discover real local git remote.
  let discovered: GitRemoteDiscovery | null = null;
  await check("A. discover real local git remote (repo root, origin, current branch — no fabrication)", async () => {
    const result = await discoverGitRemote(process.cwd());
    assert(result.ok, `expected real git discovery to succeed in this real repository, got ${result.ok ? "" : `${result.reason}: ${result.detail}`}`);
    if (result.ok) {
      discovered = result.value;
      assert(result.value.owner.length > 0, "expected a real, non-empty owner");
      assert(result.value.repository.length > 0, "expected a real, non-empty repository");
      assert(result.value.branch.length > 0, "expected a real, non-empty branch");
      assert(result.value.repository_root.length > 0, "expected a real, non-empty repository_root");
      console.log(`  discovered: owner=${result.value.owner} repository=${result.value.repository} branch=${result.value.branch}`);
    }
  });

  const tempDir = mkdtempSync(join(tmpdir(), "dna-os-connection-registry-test-"));

  // B. deterministic ConnectionRegistration identity.
  await check("B. deterministic identity — same real inputs always produce the same connection_id", () => {
    assert(discovered !== null, "precondition: test A must have discovered real git data");
    const target = { owner: discovered!.owner, repository: discovered!.repository, branch: discovered!.branch };
    const idOne = buildConnectionId({ adapter: "github", connection_type: "SOURCE_AUTHORITY", target });
    const idTwo = buildConnectionId({ adapter: "github", connection_type: "SOURCE_AUTHORITY", target });
    assert(idOne === idTwo, "expected the identical connection_id from the identical real inputs");
    assert(idOne.startsWith("connection://github/SOURCE_AUTHORITY/"), `expected a real, inspectable connection_id, got ${idOne}`);
    const differentBranchId = buildConnectionId({ adapter: "github", connection_type: "SOURCE_AUTHORITY", target: { ...target, branch: `${target.branch}-different` } });
    assert(differentBranchId !== idOne, "a different real branch must produce a different connection_id");
  });

  // C. restart -> connection still there (a fresh store instance over the same real data directory).
  let registeredConnectionId = "";
  await check("C. restart survives — a fresh store instance reads back the same connection", () => {
    assert(discovered !== null, "precondition: test A must have discovered real git data");
    const target = { owner: discovered!.owner, repository: discovered!.repository, branch: discovered!.branch };
    const firstStore = createConnectionRegistryStore(tempDir);
    const first = firstStore.registerConnection({
      adapter: "github", connection_type: "SOURCE_AUTHORITY",
      account_id: "account-connection-registry-test", software_id: "dna-os-infrastructure",
      target, credential_ref: { kind: "keychain_ref", ref: `credential://github/${target.owner}/${target.repository}/source-authority` },
      status: "connected", executor_capability_id: null, scope: ["WRITE_SOURCE"],
    });
    assert(first.inserted === true, "expected the first registration to actually insert");
    registeredConnectionId = first.connection.connection_id;

    // Simulate a restart: a brand-new store instance, same real data directory, no shared in-process state.
    const restartedStore = createConnectionRegistryStore(tempDir);
    const readBack = restartedStore.lookupConnection({ connection_id: registeredConnectionId });
    assert(readBack !== null, "expected the connection to be found by a fresh store instance after 'restart'");
    assert(readBack!.connection_id === registeredConnectionId, "expected the same connection_id to read back");
    assert(readBack!.target?.owner === target.owner && readBack!.target?.repository === target.repository && readBack!.target?.branch === target.branch, "expected the real target to read back unchanged");
  });

  // D. duplicate registration does not create a duplicate connection.
  await check("D. duplicate registration of the same real target is idempotent — no duplicate row", () => {
    assert(discovered !== null, "precondition: test A must have discovered real git data");
    const target = { owner: discovered!.owner, repository: discovered!.repository, branch: discovered!.branch };
    const store = createConnectionRegistryStore(tempDir);
    const countBefore = store.listConnections().length;
    const again = store.registerConnection({
      adapter: "github", connection_type: "SOURCE_AUTHORITY",
      account_id: "account-connection-registry-test", software_id: "dna-os-infrastructure",
      target, credential_ref: { kind: "keychain_ref", ref: `credential://github/${target.owner}/${target.repository}/source-authority` },
      status: "connected", executor_capability_id: null, scope: ["WRITE_SOURCE"],
    });
    assert(again.inserted === false, "expected the duplicate registration to be a no-op, not a fresh insert");
    assert(again.connection.connection_id === registeredConnectionId, "expected the exact same connection_id back");
    const countAfter = store.listConnections().length;
    assert(countAfter === countBefore, `expected no new row — before=${countBefore}, after=${countAfter}`);
  });

  rmSync(tempDir, { recursive: true, force: true });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
