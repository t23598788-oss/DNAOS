/**
 * หน้าที่: run the complete error-driven repair loop ONCE, against the real
 * top-of-queue gap, and print exactly what happened at every boundary.
 *
 * THE AGENT ROLE IS FILLED BY THIS SESSION, AND SAYS SO. `codingAgent` below
 * is the "agent" of the Owner's step 4: it receives only the repair package,
 * reads only the file that package names, and returns a proposal with no
 * status field. It cannot declare success — `verifyProposal` does that, from
 * real checks, and it is the only thing that can.
 *
 * WHAT THE AGENT IS ALLOWED TO SEE: `repair.allowed_paths` and nothing else.
 * The function reads exactly one file, the one the root-cause analysis
 * implicated, and never scans the repository.
 *
 * Usage: npx tsx control/repair-loop/tests/first-repair-proof.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runRepairCycle } from "../contract";
import type { AgentProposal, RepairWorkItem } from "../contract";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const TARGET = "control/external-system-lifecycle/pipeline.ts";

/**
 * The proposal for the AI_WRITE_ADAPTER_NOT_REGISTERED gap.
 *
 * Root cause, already established from the source: `pipeline.ts` calls
 * `submitTask(..., [])` with an empty adapter array ON PURPOSE — its own
 * comment says the orchestrator is its own executor and the gateway's adapter
 * loop is unrelated to it. The gateway then correctly records that it could
 * not execute. Both halves are behaving as designed.
 *
 * The DEFECT is that the resulting record is an unlabelled verification
 * failure, indistinguishable from a real one. 280 of them now sit at the top
 * of the gap queue and would send a repair agent to "fix" an intended path.
 *
 * The fix is therefore NOT to change the block. It is to make the deliberate
 * termination self-describing: the caller that caused it records why, on the
 * same task, so every consumer can tell an intended stop from a failure. It
 * adds no import, changes no control flow, and removes no export.
 */
function codingAgent(repair: RepairWorkItem): AgentProposal | null {
  const allowed = repair.allowed_paths.find((p) => p === TARGET);
  if (!allowed) {
    console.log(`  agent: ${TARGET} is not in allowed_paths [${repair.allowed_paths.join(", ")}] — refusing to touch it`);
    return null;
  }

  const before = readFileSync(join(REPO_ROOT, TARGET), "utf8");

  const anchor = `  const activeTask = { ...task, status: "EXECUTING" as const, updated_at: new Date().toISOString() };\n  saveTask(activeTask);`;
  if (!before.includes(anchor)) {
    console.log("  agent: the anchor this repair depends on is not present; refusing to guess a location");
    return null;
  }
  if (before.includes("EXPECTED_BY_DESIGN")) {
    console.log("  agent: the classification is already present — nothing to propose");
    return null;
  }

  const insertion = `${anchor}
  // BY-DESIGN CLASSIFICATION (repair-loop, root cause MISLEADING_EVIDENCE).
  // The submitTask() call above deliberately passes an empty adapter array —
  // this orchestrator is its own executor, as the comment block above states.
  // The gateway therefore records a truthful "AI_WRITE_ADAPTER_NOT_REGISTERED"
  // verification row, and for 280 tasks that row was the ONLY record of what
  // happened. Read by anything that looks for failures — the gap queue, the
  // Workspace graph — a deliberate stop was indistinguishable from a real
  // one, and it sat at the top of the repair queue as the system's single
  // largest apparent defect.
  //
  // This adds the missing half: the caller that caused the state records that
  // it was intended, on the same task_id. Nothing about the block changes,
  // because nothing about the block is wrong.
  saveEvidence({
    evidence_id: \`by-design-\${task.task_id}\`,
    task_id: task.task_id,
    kind: "verification",
    source: "control/external-system-lifecycle/pipeline.ts",
    recorded_at: new Date().toISOString(),
    payload: {
      reason: "AI_WRITE_ADAPTER_NOT_REGISTERED",
      classification: "EXPECTED_BY_DESIGN",
      explanation: "submitTask was called with an empty adapter array on purpose; this orchestrator executes the lifecycle itself and only needs the task identity for Policy and Admission",
      caller: "control/external-system-lifecycle/pipeline.ts",
    },
  });`;

  const content = before
    .replace(anchor, insertion)
    .replace(
      `import { submitTask, recordHandoff, saveTask } from "../agent-gateway/contract";`,
      `import { submitTask, recordHandoff, saveTask, saveEvidence } from "../agent-gateway/contract";`,
    );

  return {
    repair_id: repair.repair_id,
    PROPOSED_CHANGE:
      "record an EXPECTED_BY_DESIGN classification alongside the deliberate AI_WRITE_ADAPTER_NOT_REGISTERED termination, so a by-design stop is distinguishable from a real failure",
    FILES_CHANGED: [{ path: TARGET, operation: "MODIFY", content }],
    CONTRACT_SATISFIED:
      "no export removed, no control flow changed, no new module imported (saveEvidence comes from ../agent-gateway/contract, already imported by this file)",
    TESTS_ADDED_OR_USED: [
      "npx tsc --noEmit -p tsconfig.json",
      "npx tsx control/registration-pipeline/tests/registration-pipeline.test.ts",
      "control/repair-loop gap re-scan (the deterministic check that the queue changes)",
    ],
    EXPECTED_RESULT:
      "future lifecycle runs emit a paired classification row; the gap scanner stops counting those tasks as failures",
    EVIDENCE_REQUIRED: ["gap re-scan before/after", "repo-wide typecheck after promotion"],
  };
}

async function main(): Promise<void> {
  console.log("=".repeat(96));
  console.log("FIRST REPAIR PROOF — one real gap, complete loop");
  console.log("=".repeat(96));

  const outcome = await runRepairCycle({
    only_gap_id: "gap-evidence-AI_WRITE_ADAPTER_NOT_REGISTERED",
    agent: codingAgent,
  });

  console.log(`\nGAP           : ${outcome.gap.gap_id}`);
  console.log(`  state       : ${outcome.gap.state}  (observed ${outcome.gap.occurrences} times, ${outcome.gap.first_seen} .. ${outcome.gap.last_seen})`);
  console.log(`  reason      : ${outcome.gap.reason.slice(0, 130)}`);
  console.log(`\nROOT CAUSE    : ${outcome.root_cause_class}`);
  if (outcome.repair) {
    console.log(`  repair_id   : ${outcome.repair.repair_id}`);
    console.log(`  boundary    : ${outcome.repair.failed_boundary}`);
    console.log(`  repair_type : ${outcome.repair.repair_type}`);
    console.log(`  allowed     : ${outcome.repair.allowed_paths.join(", ")}`);
    console.log(`  signature   : ${outcome.repair.error_signature}  attempt ${outcome.repair.attempt}`);
  }
  console.log(`\nROUTING       : dispatched=${outcome.dispatched}  n8n route_group=${outcome.route_group}`);
  console.log(`PROPOSAL      : ${outcome.proposal ? `${outcome.proposal.FILES_CHANGED.length} file(s) — ${outcome.proposal.FILES_CHANGED.map((f) => f.path).join(", ")}` : "none"}`);

  if (outcome.verdict) {
    console.log(`\nVERIFICATION  : ${outcome.verdict.verdict}${outcome.verdict.failed_stage ? ` at ${outcome.verdict.failed_stage}` : ""}  code_hash=${outcome.verdict.code_hash}`);
    for (const stage of outcome.verdict.stages) {
      console.log(`  ${stage.passed ? "PASS" : "FAIL"}  ${stage.stage.padEnd(30)} ${stage.detail.slice(0, 110)}`);
    }
  } else {
    console.log(`\nVERIFICATION  : not attempted (stopped=${outcome.stopped})`);
  }

  console.log(`\nGRAPH_BEFORE  : ${outcome.graph_before}`);
  console.log(`GRAPH_AFTER   : ${outcome.graph_after}`);
  console.log(`STOPPED       : ${outcome.stopped ?? "-"}`);
  console.log(`EVIDENCE_REF  : ${outcome.evidence_ref}`);
  console.log(`NEXT_GAP      : ${outcome.next_gap_id ?? "-"}`);

  writeFileSync(
    join(REPO_ROOT, "control/repair-loop/data", `first-repair-proof-${Date.now()}.json`),
    JSON.stringify({
      gap: outcome.gap, root_cause_class: outcome.root_cause_class, repair: outcome.repair,
      route_group: outcome.route_group,
      proposal: outcome.proposal ? { ...outcome.proposal, FILES_CHANGED: outcome.proposal.FILES_CHANGED.map((f) => ({ path: f.path, operation: f.operation, bytes: f.content.length })) } : null,
      verdict: outcome.verdict, graph_before: outcome.graph_before, graph_after: outcome.graph_after,
      stopped: outcome.stopped, evidence_ref: outcome.evidence_ref, next_gap_id: outcome.next_gap_id,
    }, null, 2),
  );
}

main().catch((error) => { console.error("PROOF RUN FAILED:", error); process.exit(1); });
