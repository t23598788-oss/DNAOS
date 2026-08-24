/**
 * หน้าที่: the CORRECTIVE_LOOP for a completed `DnaOsAgentResult`
 * (Owner, "DNA OS Live Agent Execution Path"). This file implements NO
 * new decision engine — it reuses, unmodified, `./handoff.ts`'s
 * `computeNextDecisionFromEvidence` (the same deterministic engine
 * `control/owner-command/input-gateway.ts` already uses for its own
 * second-pass loop) and `./controller.ts`'s `dispatchTask` (the same
 * Controller every other worker in this repo goes through). No parallel
 * control plane is created: RESULT -> EVIDENCE -> NEXT_DECISION is
 * exactly the existing pipeline, applied here to Agent Host results
 * instead of WorkOrder results.
 *
 * Input: a completed `DnaOsAgentResult` (from `./agent-host-dispatch.ts`).
 * Output: `runCorrectiveLoop` -> `CorrectiveLoopOutcome`. Only a machine
 * state (`TERMINAL` | `OWNER_REVIEW_REQUIRED` | `CORRECTED`) is ever
 * produced -- no natural-language translation of any kind.
 * Dependency ที่อนุญาต: ./handoff.ts, ./memory-store.ts, ./controller.ts,
 * ./workers.ts.
 * สิ่งที่ห้ามแตะ: never add a second `computeNextDecision`-shaped
 * function here -- if the existing one needs a new rule, it belongs in
 * ./handoff.ts, not duplicated in this file.
 */

import { computeNextDecisionFromEvidence } from "./handoff";
import { loadEvidenceForTask } from "./memory-store";
import { dispatchTask } from "./controller";
import { DEFAULT_AGENT_WORKERS } from "./workers";
import type { DnaOsAgentResult } from "./agent-execution-contract";
import type { Task } from "./types";

export type CorrectiveLoopState = "TERMINAL" | "OWNER_REVIEW_REQUIRED" | "CORRECTED";

export interface CorrectiveLoopOutcome {
  state: CorrectiveLoopState;
  decision_id: string | null;
  decision_type: string | null;
  corrective_task_id: string | null;
}

/**
 * PASS never enters the loop at all (nothing to correct). FAIL/ERROR/
 * BLOCKED read the real, already-persisted evidence for this exact
 * task_id and let the EXISTING Decision Engine decide -- never this
 * file's own judgment. `requires_owner_approval`/`terminal` are read
 * straight off that decision; a machine-correctable case dispatches
 * through the SAME `dispatchTask()` Controller as every other worker in
 * this repo, correlated to the original task via `parent_task_id`.
 */
export async function runCorrectiveLoop(result: DnaOsAgentResult, clientId: string): Promise<CorrectiveLoopOutcome> {
  if (result.status === "PASS") {
    return { state: "TERMINAL", decision_id: null, decision_type: null, corrective_task_id: null };
  }

  const evidence = loadEvidenceForTask(result.task_id);
  const decision = computeNextDecisionFromEvidence(result.task_id, evidence);

  if (decision.terminal) {
    return { state: "TERMINAL", decision_id: decision.decision_id, decision_type: decision.decision_type, corrective_task_id: null };
  }
  if (decision.requires_owner_approval) {
    return { state: "OWNER_REVIEW_REQUIRED", decision_id: decision.decision_id, decision_type: decision.decision_type, corrective_task_id: null };
  }

  // decision_type === "CONTINUE" -- the ONLY machine-correctable case the
  // existing Decision Engine can produce today (bounded to depth 1, see
  // handoff.ts's own eligibility rule). Dispatched exactly like every
  // other continuation this repo already performs.
  let correctiveTask: Task;
  try {
    correctiveTask = await dispatchTask(
      "ตรวจ duplicate: bounded continuation re-verification",
      { user_id: "dna-os-agent-execution-loop", workspace_id: "dna-os-infrastructure", conversation_id: `${result.task_id}::corrective`, parent_task_id: result.task_id },
      clientId,
      DEFAULT_AGENT_WORKERS,
    );
  } catch {
    return { state: "OWNER_REVIEW_REQUIRED", decision_id: decision.decision_id, decision_type: decision.decision_type, corrective_task_id: null };
  }
  return { state: "CORRECTED", decision_id: decision.decision_id, decision_type: decision.decision_type, corrective_task_id: correctiveTask.task_id };
}
