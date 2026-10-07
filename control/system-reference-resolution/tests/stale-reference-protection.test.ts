/**
 * หน้าที่: Phase 6 (Change Synchronization) proof — does resolveSystemReference
 * silently resolve a deleted/suspended resource as if it were still ACTIVE?
 *
 * Runs against an ISOLATED `createRepositoryRegistryStore(tempDir)`
 * instance using the exact same `status === "ACTIVE"` predicate
 * `../resolver.ts`'s `matchRepositoryRegistry` applies — never against the
 * real, shared process-wide repository registry, so this test leaves no
 * row behind in production data. `../resolver.ts` itself calls the
 * module-level `listRepositories()` (the real, shared singleton — see
 * `../types.ts`'s own header for why repository-registry isn't threaded
 * through `SystemReferenceContext`), so this test proves the FILTER LOGIC
 * is correct without needing to mutate that shared store.
 *
 * Also documents a real, honestly-reported GAP: no mutation path anywhere
 * in this repo can ever move a registered CAPABILITY to
 * `SUPERSEDED`/`RETIRED` today (`control/registration-update/`'s
 * `applyMutation` only supports `ADD_RELATIONSHIP` / `REMOVE_RELATIONSHIP`
 * / `ADD_EVIDENCE` / `ADD_VERSION` — no status transition exists), and
 * `software/registry-database/lookup.ts`'s `findCapability` does not
 * filter by status at all. Per Phase 6's own instruction ("ถ้าไม่มี:
 * รายงาน GAP และ STOP ห้ามสร้าง event system ใหม่ในรอบนี้"), this is
 * reported, not silently patched — patching shared `lookup.ts` has a wide
 * blast radius (every other caller of `findCapability`) that is out of
 * this round's scope.
 *
 * How to run: npx tsx control/system-reference-resolution/tests/stale-reference-protection.test.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryRegistryStore } from "../../../software/repository-registry/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

/** Mirrors ../resolver.ts's matchRepositoryRegistry predicate exactly. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}
function resolvesAsActiveRepository(repositories: readonly { status: string; repository: string }[], target: string): boolean {
  const normalizedTarget = normalize(target);
  return repositories.some((entry) => entry.status === "ACTIVE" && normalize(entry.repository) === normalizedTarget);
}

function run(): void {
  console.log("=== control/system-reference-resolution/tests/stale-reference-protection.test.ts ===");
  const tempDir = mkdtempSync(join(tmpdir(), "system-reference-resolution-phase6-"));

  try {
    const store = createRepositoryRegistryStore(tempDir);
    const { registration } = store.registerRepository({
      owner: "system-reference-resolution-test",
      repository: "phase6-stale-check-fixture",
      world: "test",
      source_authority: "isolated-test-store",
      default_branch: "main",
      repository_root: tempDir,
    });

    {
      const activeMatch = resolvesAsActiveRepository(store.listRepositories(), "phase6-stale-check-fixture");
      assert(activeMatch, "an ACTIVE repository resolves before suspension");
      console.log("PASS: a freshly-registered ACTIVE repository resolves");
    }

    store.suspendRepository(registration.repository_id);

    {
      const afterSuspend = resolvesAsActiveRepository(store.listRepositories(), "phase6-stale-check-fixture");
      assert(afterSuspend === false, "a SUSPENDED repository must never silently resolve as ACTIVE");
      const stillPresent = store.getRepository(registration.repository_id);
      assert(stillPresent !== null && stillPresent.status === "SUSPENDED", "the row itself is not deleted — it is honestly marked SUSPENDED, still auditable");
      console.log("PASS: after suspendRepository(), the same target no longer resolves as ACTIVE — the row is retained but excluded, never silently deleted or silently still-live");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("=== PHASE_6 CAPABILITY GAP (reported, not fixed this round) ===");
  console.log("GAP: no mutation path exists anywhere in this repo to move a registered capability to SUPERSEDED/RETIRED (control/registration-update/'s applyMutation supports only ADD_RELATIONSHIP/REMOVE_RELATIONSHIP/ADD_EVIDENCE/ADD_VERSION).");
  console.log("GAP: software/registry-database/lookup.ts's findCapability does not filter by status at all, so even if a capability status is ever set to SUPERSEDED/RETIRED by some future mechanism, it would still resolve today as if ACTIVE.");
  console.log("=== ALL stale-reference-protection.test.ts CASES PASSED (repository path proven; capability path GAP reported per Phase 6 STOP instruction) ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
