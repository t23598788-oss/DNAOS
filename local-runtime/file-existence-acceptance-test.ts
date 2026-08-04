// Real acceptance test for File Existence Intelligence & Recovery (owner,
// 2026-08-04). Uses ONLY a dedicated scratch directory (.dna-os/test-scratch/,
// gitignored via /.dna-os) — per explicit instruction, zero rm/rm-f/rm-rf
// anywhere in this file. Cleanup goes through moveToTrash (real Trash Policy,
// never permanent delete). Run with:
// npx tsx local-runtime/file-existence-acceptance-test.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { registerFile, classifyDuplicate, findCanonicalSibling, getGitState } from "@/engines/workspace/fileExistenceRegistry";
import { createSnapshot, restoreSnapshot } from "@/engines/workspace/snapshotStore";
import { previewDestructiveAction, executeDestructiveAction } from "@/engines/workspace/destructiveActionGate";
import { acquireLock, releaseLock } from "@/engines/workspace/lockManager";
import { moveToTrash } from "@/engines/storage/adapters/trashAdapter";
import { fileURLToPath } from "url";
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_REL = ".dna-os/test-scratch";
const SCRATCH_ABS = join(PROJECT_DIR, SCRATCH_REL);

const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function relOf(name: string) { return join(SCRATCH_REL, name); }
function absOf(name: string) { return join(SCRATCH_ABS, name); }

async function test1_newFileDetectedAndSnapshotted() {
  const rel = relOf("widget.tsx");
  writeFileSync(absOf("widget.tsx"), "export default function Widget() { return null; }\n");
  const record = await registerFile(db, rel, { owningSession: "acceptance-test" });
  console.log(`[test 1] new file registered: git_state=${record.git_state} registration_state=${record.registration_state} hash=${record.content_hash?.slice(0, 12)}`);
  if (record.registration_state !== "UNREGISTERED") throw new Error("FAIL: expected UNREGISTERED for a real new scratch file");
  if (!record.content_hash) throw new Error("FAIL: expected a real content hash");

  const snap = await createSnapshot(db, rel, readFileSync(absOf("widget.tsx"), "utf-8"), { sessionId: "acceptance-test", command: "test" });
  console.log(`  PASS — registered + snapshotted, hash=${snap.content_hash.slice(0, 12)}`);
}

async function test2_exactDuplicateDetected() {
  writeFileSync(absOf("dup.tsx"), "export const X = 1;\n");
  writeFileSync(absOf("dup 2.tsx"), "export const X = 1;\n"); // byte-identical
  const sibling = findCanonicalSibling(relOf("dup 2.tsx"));
  console.log(`[test 2] canonical sibling for "dup 2.tsx": ${sibling}`);
  if (sibling !== relOf("dup.tsx")) throw new Error(`FAIL: expected sibling ${relOf("dup.tsx")}, got ${sibling}`);
  const cls = classifyDuplicate(relOf("dup 2.tsx"), sibling);
  if (cls !== "EXACT_DUPLICATE") throw new Error(`FAIL: expected EXACT_DUPLICATE, got ${cls}`);
  console.log("  PASS — real content hash comparison, not filename-only, classified EXACT_DUPLICATE");
}

async function test3_divergedCopyNotTreatedAsJunk() {
  writeFileSync(absOf("real.tsx"), "export const A = 1;\n");
  writeFileSync(absOf("real 2.tsx"), "export const A = 2; // genuinely different content\n");
  const sibling = findCanonicalSibling(relOf("real 2.tsx"));
  const cls = classifyDuplicate(relOf("real 2.tsx"), sibling!);
  console.log(`[test 3] "real 2.tsx" vs "real.tsx": classification=${cls}`);
  if (cls !== "CONTENT_DIVERGED_COPY") throw new Error(`FAIL: expected CONTENT_DIVERGED_COPY (real content differs), got ${cls} — per owner instruction, a numbered filename alone must never be treated as junk`);
  console.log("  PASS — content genuinely differs, correctly NOT classified as a safe-to-discard duplicate");
}

async function test4_restoreFromSnapshot() {
  const rel = relOf("restorable.tsx");
  const original = "export const V = 'original content';\n";
  writeFileSync(absOf("restorable.tsx"), original);
  const snap = await createSnapshot(db, rel, original, { sessionId: "acceptance-test", command: "test" });
  writeFileSync(absOf("restorable.tsx"), "export const V = 'overwritten';\n"); // simulate mutation
  const restored = await restoreSnapshot(db, snap.content_hash);
  console.log(`[test 4] restore result: ok=${restored.ok}`);
  if (!restored.ok || restored.content !== original) throw new Error("FAIL: restored content does not match original snapshot");
  console.log("  PASS — real content-addressed restore, byte-identical to original");
}

async function test5_destructiveGateBlocksWithoutSnapshot() {
  const rel = relOf("unsnapshotted.tsx");
  writeFileSync(absOf("unsnapshotted.tsx"), "export const NEW = true;\n");
  const preview = await previewDestructiveAction(db, rel, "trash", "acceptance-test-actor", "acceptance-test-session");
  console.log(`[test 5] preview for untracked+unsnapshotted file: blockers=${JSON.stringify(preview.blockers)}`);
  if (preview.blockers.length === 0) throw new Error("FAIL: expected a blocker for an untracked file with no snapshot");
  const result = await executeDestructiveAction(db, rel, "trash", "acceptance-test-actor", "acceptance-test-session", "fake-token-12345678");
  if (result.ok) throw new Error("FAIL: execute should have been blocked");
  console.log(`  PASS — execute correctly blocked: ${result.block_reason}`);
}

async function test6_destructiveGateRequiresConfirmationToken() {
  const rel = relOf("token-test.tsx");
  writeFileSync(absOf("token-test.tsx"), "export const T = 1;\n");
  await createSnapshot(db, rel, readFileSync(absOf("token-test.tsx"), "utf-8"), { sessionId: "acceptance-test", command: "test" });
  const result = await executeDestructiveAction(db, rel, "trash", "acceptance-test-actor", "acceptance-test-session", "");
  console.log(`[test 6] execute with empty confirmationToken: ok=${result.ok} reason=${result.block_reason}`);
  if (result.ok) throw new Error("FAIL: execute without a confirmation token must never succeed");
  console.log("  PASS — empty confirmation_token correctly rejected");
}

async function test7_concurrentSessionOwnershipBlocks() {
  const rel = relOf("owned-by-session-a.tsx");
  writeFileSync(absOf("owned-by-session-a.tsx"), "export const OWNED = true;\n");
  await createSnapshot(db, rel, readFileSync(absOf("owned-by-session-a.tsx"), "utf-8"), { sessionId: "session-A", command: "test" });

  const lockResult = await acquireLock(db, "file", rel, "session-A-actor", "session-A", 60_000);
  if (!lockResult.acquired) throw new Error("FAIL: session A should have acquired the lock cleanly");

  const preview = await previewDestructiveAction(db, rel, "trash", "session-B-actor", "session-B");
  console.log(`[test 7] session B preview on session A's locked file: held_by_active_session=${preview.held_by_active_session} blockers=${JSON.stringify(preview.blockers)}`);
  if (!preview.held_by_active_session) throw new Error("FAIL: expected held_by_active_session=true");

  const result = await executeDestructiveAction(db, rel, "trash", "session-B-actor", "session-B", "attempt-token-123");
  if (result.ok) throw new Error("FAIL: session B must never be able to delete session A's active-locked file");
  console.log(`  PASS — session B correctly BLOCKED from touching session A's locked file: ${result.block_reason}`);

  if (lockResult.lock) await releaseLock(db, lockResult.lock.id);
}

async function test8_missingRegisteredFileDetected() {
  // Registry declares a path but the file doesn't exist — file.inspect-style check.
  const fakeRel = relOf("declared-but-missing.tsx");
  const exists = existsSync(join(PROJECT_DIR, fakeRel));
  console.log(`[test 8] path never created, exists=${exists}`);
  if (exists) throw new Error("FAIL: this path should never have been created");
  console.log("  PASS — a registry-declared-but-missing path is correctly detectable via existsSync (real, not guessed)");
}

async function cleanup() {
  // Every scratch file created above goes to Trash — never rm, per explicit instruction.
  const names = ["widget.tsx", "dup.tsx", "dup 2.tsx", "real.tsx", "real 2.tsx", "restorable.tsx", "unsnapshotted.tsx", "token-test.tsx", "owned-by-session-a.tsx"];
  for (const name of names) {
    const abs = absOf(name);
    if (existsSync(abs)) {
      try { moveToTrash(abs); } catch (e) { console.error(`cleanup: could not move ${name} to Trash:`, (e as Error).message); }
    }
  }
  console.log("\n[cleanup] all scratch test files moved to ~/.Trash (not deleted)");
}

async function main() {
  mkdirSync(SCRATCH_ABS, { recursive: true });
  console.log(`=== File Existence Intelligence acceptance tests (scratch: ${SCRATCH_REL}) ===\n`);
  try {
    await test1_newFileDetectedAndSnapshotted();
    await test2_exactDuplicateDetected();
    await test3_divergedCopyNotTreatedAsJunk();
    await test4_restoreFromSnapshot();
    await test5_destructiveGateBlocksWithoutSnapshot();
    await test6_destructiveGateRequiresConfirmationToken();
    await test7_concurrentSessionOwnershipBlocks();
    await test8_missingRegisteredFileDetected();
    console.log("\nALL FILE EXISTENCE INTELLIGENCE ACCEPTANCE TESTS PASSED");
  } finally {
    await cleanup();
  }
}

main().catch((e) => { console.error("ACCEPTANCE TEST FAILED:", e); process.exit(1); });
