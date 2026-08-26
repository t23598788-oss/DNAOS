/**
 * หน้าที่: PHASE 6 proof — a real change to a real path resolves to the work
 * session that owns it, and resolves to UNKNOWN when nothing proves ownership.
 *
 * Input: none (its own journal directory under the scratchpad).
 * Output: exit 0 when every case matches, exit 1 otherwise.
 * Dependency ที่อนุญาต: Node built-ins + ../contract.ts.
 * สิ่งที่ห้ามแตะ: ห้ามทำให้เคส UNOWNED/AMBIGUOUS ผ่านด้วยการเดาเจ้าของ —
 * ทั้งสองเคสต้องได้ UNKNOWN ไม่งั้นการพิสูจน์นี้ไร้ความหมาย
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCheckpoint, currentBranch, currentRevision, journalPath, newSessionId, resolveChangeOwner } from "../contract";

const root = mkdtempSync(join(tmpdir(), "change-ownership-proof-"));
const path = journalPath(root);

function base(workId: string, paths: string[], status: "ACTIVE" | "COMPLETE") {
  return {
    work_id: workId, owner_intent_id: null, task_id: `task-${workId}`, session_id: newSessionId(),
    execution_id: `exec-${workId}`, worker_identity: "proof", repository: "DNA-OS-INFRASTRUCTURE",
    branch: currentBranch(), affected_resource_ids: [], affected_paths: paths,
    objective: "ownership proof", current_phase: "PROOF", steps: [], blockers: [], decisions_required: [],
    evidence_refs: [], source_revision: currentRevision(), last_verified_revision: null,
    next_action: "none", do_not_repeat: [], ui_context: null, last_durable_event: [], sync_state: "SYNCED" as const,
    resolution_ref: null, cross_repo_evidence: [],
    status, started_at: new Date().toISOString(),
  };
}

appendCheckpoint(base("work-alpha", ["control/work-session-state"], "ACTIVE"), path);
appendCheckpoint(base("work-beta", ["control/machine-observation", "control/work-session-state"], "ACTIVE"), path);
appendCheckpoint(base("work-gamma", ["control/system-read-paths"], "COMPLETE"), path);

const cases: { name: string; path: string; expect_work: string; expect_prov: string }[] = [
  { name: "a path only one active work declares", path: "control/machine-observation/observation-store.ts", expect_work: "work-beta", expect_prov: "CHECKPOINT_SCOPE" },
  { name: "a path two active works declare is UNKNOWN, not the first one", path: "control/work-session-state/store.ts", expect_work: "UNKNOWN", expect_prov: "AMBIGUOUS" },
  { name: "a path only a COMPLETE work declared is UNOWNED", path: "control/system-read-paths/registry.ts", expect_work: "UNKNOWN", expect_prov: "UNOWNED" },
  { name: "a path nobody declares is UNOWNED", path: "control/command-router/router.ts", expect_work: "UNKNOWN", expect_prov: "UNOWNED" },
  { name: "segment-boundary aware: a sibling folder is not contained", path: "control/work-session-state-legacy/x.ts", expect_work: "UNKNOWN", expect_prov: "UNOWNED" },
  { name: "a path that cannot be normalized is refused, not guessed", path: "../outside/x.ts", expect_work: "UNKNOWN", expect_prov: "UNOWNED" },
];

let failed = 0;
console.log("[CHANGE OWNERSHIP PROOF]");
for (const c of cases) {
  const got = resolveChangeOwner(c.path, { path });
  const ok = got.work_id === c.expect_work && got.provenance === c.expect_prov;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "✔" : "✘"} ${c.name} — work_id=${got.work_id} provenance=${got.provenance} :: ${got.detail}`);
}
rmSync(root, { recursive: true, force: true });
console.log(`\nRESULT: ${cases.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
