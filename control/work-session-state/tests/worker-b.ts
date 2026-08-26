/**
 * หน้าที่: WORKER B of the hard-reset proof — a DIFFERENT process, a different
 * worker identity, started with NOTHING but a work_id. It must be able to work
 * out where the work stands, do the next thing, and record that it did, using
 * only what DNA OS persisted.
 *
 * Input: argv[2] = work_id. No conversation history, no summary, no handover file.
 * Output: stdout the resume briefing plus `DID=<step_id>`; a new checkpoint.
 * Dependency ที่อนุญาต: ../contract.ts, and the real thing its next step verifies.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามอ่าน checkpoint ของ worker A แบบเจาะจง — อ่านผ่าน resume engine เท่านั้น
 * - ห้ามทำ step ที่ resume engine บอกว่ายัง valid ซ้ำ
 * - ห้ามประกาศว่า step ผ่านโดยไม่มี verification ที่ re-derive ได้
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendCheckpoint, buildResumeContext, currentBranch, currentCheckpoint, currentRevision, newSessionId, renderResumeBriefing } from "../contract";
import type { WorkStep } from "../contract";

const workId = process.argv[2];
if (!workId) { console.error("usage: worker-b.ts <work_id>"); process.exit(2); }
const repoRoot = process.cwd();

// 1 — read persistent work state. This is the ONLY input.
const ctx = buildResumeContext(workId, { repoRoot, constraints: ["ห้าม AI ตัดสิน PASS/FAIL", "ห้ามสร้าง capability ซ้ำ"] });
console.log(renderResumeBriefing(ctx));
console.log("---");

if (ctx.resume_status !== "RESUMABLE") { console.log(`NOT_RESUMABLE=${ctx.resume_status}`); process.exit(1); }

const nextId = ctx.next_action.split(" ")[0];
const step = ctx.pending_steps.find((s) => s.step_id === nextId);
if (!step) { console.log("NEXT_STEP_NOT_FOUND"); process.exit(1); }

// 2 — actually do it. s5-graph-proof: the derived graph must expose this very
// work item, read out of the journal, with no node hard-coded for it.
let evidence = "";
if (step.step_id === "s5-graph-proof") {
  const { buildSystemGraph } = require(resolve(repoRoot, "dna-os-circuit/runtime/derived-graph.ts")) as { buildSystemGraph: () => { nodes: readonly { id: string; domain: string }[]; edges: readonly { from: string; to: string; kind: string }[]; source_counts: Record<string, number> } };
  const graph = buildSystemGraph();
  const workNode = graph.nodes.find((n) => n.id === `work:${workId}`);
  const nextNode = graph.nodes.find((n) => n.id === `next_action:${workId}`);
  const sessionEdges = graph.edges.filter((e) => e.to === `work:${workId}` && e.kind === "WORKS_ON");
  if (!workNode || !nextNode || sessionEdges.length === 0) {
    console.log(`GRAPH_PROOF_FAILED work=${Boolean(workNode)} next=${Boolean(nextNode)} sessions=${sessionEdges.length}`);
    process.exit(1);
  }
  evidence = `derived-graph: work node + next_action node + ${sessionEdges.length} WORKS_ON edge(s), work-session-state source_count=${graph.source_counts["work-session-state"]}`;
  console.log(`GRAPH_PROOF_OK ${evidence}`);
}

// 3 — record it, with a verification a later worker can re-derive.
const previous = currentCheckpoint(workId);
if (previous === null) { console.log("NO_CHECKPOINT"); process.exit(1); }
const verifyPath = step.affected_paths[0] ?? "control/work-session-state/resume.ts";
const completed: WorkStep = {
  ...step, state: "COMPLETED",
  verification: { kind: "FILE_DIGEST", path: verifyPath, sha256: createHash("sha256").update(readFileSync(resolve(repoRoot, verifyPath))).digest("hex") },
  completed_at_revision: currentRevision(repoRoot), completed_at: new Date().toISOString(),
  evidence_refs: [...step.evidence_refs, evidence].filter(Boolean),
};

const sessionId = newSessionId();
appendCheckpoint({
  ...previous,
  session_id: sessionId,                    // NEW session
  execution_id: `exec-b-${process.pid}`,
  worker_identity: "worker-b",              // a different worker
  branch: currentBranch(repoRoot),
  steps: previous.steps.map((s) => (s.step_id === completed.step_id ? completed : s)),
  source_revision: currentRevision(repoRoot),
  last_verified_revision: currentRevision(repoRoot),
  next_action: "s6-regression",
  updated_at: new Date().toISOString(),
});

console.log(`DID=${completed.step_id}`);
console.log(`SESSION=${sessionId}`);
console.log(`PID=${process.pid}`);
