/**
 * หน้าที่: real evidence for the Owner's 2026-08-20 rule — no agent's own
 * self-report may be stored/treated as DNA OS's final decision. Proves
 * (1) an agent handoff claiming status="VERIFIED" is persisted with
 * dna_os_decision="DNA_VALIDATING", never "DNA_VERIFIED", by
 * recordHandoff alone; (2) only confirmDnaOsDecision (called by DNA OS's
 * own pipeline, e.g. control/owner-command/input-gateway.ts) can ever
 * produce dna_os_decision="DNA_VERIFIED"; (3) the agent's original claim
 * and DNA OS's decision are both kept as separate, distinguishable
 * records — never merged into one.
 *
 * How to run:
 *   npx tsx control/agent-gateway/tests/dna-os-decision.test.ts
 */
import { recordHandoff, confirmDnaOsDecision } from "../handoff";
import { loadHandoffsForTask } from "../memory-store";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const taskId = `dna-os-decision-test-${Date.now()}`;

// 1. an agent's own "VERIFIED" self-report is never directly stored as DNA_VERIFIED
const agentHandoff = recordHandoff({
  task_id: taskId,
  agent_id: "codex",
  role: "inspect_test",
  input_reference: `work-order://dna-os-decision-test/${taskId}`,
  files_read: [],
  files_changed: ["tests/__sandbox__/probe.txt"],
  tests_run: ["sandbox.write"],
  status: "VERIFIED",
  evidence_refs: ["evidence://agent/probe"],
  blockers: [],
  next_action: null,
});
check("agent handoff self-reporting VERIFIED is admitted", agentHandoff.ok, JSON.stringify(agentHandoff));
if (agentHandoff.ok) {
  check("agent's own 'VERIFIED' claim is stored as DNA_VALIDATING, never auto-promoted to DNA_VERIFIED", agentHandoff.handoff.dna_os_decision === "DNA_VALIDATING", `got dna_os_decision=${agentHandoff.handoff.dna_os_decision}`);
  check("the agent's original status claim is still preserved, unaltered, as its own separate field", agentHandoff.handoff.status === "VERIFIED");
}

// 2. only confirmDnaOsDecision can produce DNA_VERIFIED, and it is a SEPARATE record
const dnaDecision = confirmDnaOsDecision(taskId, "DNA_VERIFIED", ["evidence://dna-os/regression-pass"], "existing Controller/validator chain confirmed sandbox readback");
check("confirmDnaOsDecision produces a real DNA_VERIFIED record", dnaDecision.dna_os_decision === "DNA_VERIFIED");
check("the DNA OS decision record is attributed to owner-console, never to the submitting agent", dnaDecision.agent_id === "owner-console");

const allHandoffsForTask = loadHandoffsForTask(taskId);
check("both the agent's self-report AND DNA OS's decision are persisted as two distinct records, never merged", allHandoffsForTask.length === 2, `expected 2 records, got ${allHandoffsForTask.length}`);
check("the agent's original handoff record is untouched (still DNA_VALIDATING) after DNA OS's separate decision", allHandoffsForTask.find((h) => h.agent_id === "codex")?.dna_os_decision === "DNA_VALIDATING");

// 3. a self-reported FAILED/BLOCKED is trusted as a negative signal without needing DNA OS promotion (no over-trust risk in the pessimistic direction)
const failedTaskId = `dna-os-decision-test-failed-${Date.now()}`;
const failedHandoff = recordHandoff({
  task_id: failedTaskId,
  agent_id: "codex",
  role: "inspect_test",
  input_reference: `work-order://dna-os-decision-test/${failedTaskId}`,
  files_read: [],
  files_changed: [],
  tests_run: [],
  status: "FAILED",
  evidence_refs: [],
  blockers: ["real compile error"],
  next_action: null,
});
check("an agent's self-reported FAILED is trusted directly as DNA_FAILED (no promotion needed for a negative claim)", failedHandoff.ok && failedHandoff.handoff.dna_os_decision === "DNA_FAILED", JSON.stringify(failedHandoff));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (process as { exitCode?: number }).exitCode = 1;
