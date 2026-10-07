/**
 * หน้าที่: the canonical Work Result Ingress — the ONLY path a submitted
 * work result takes from here on:
 *
 *   Agent -> submit_work_result -> Work Result Ingress
 *   -> validate task/worker/session
 *   -> classify result contents -> split into candidate(s)
 *   -> Registration Pipeline (control/registration-pipeline/contract.ts's
 *      runRegistrationPipeline — Validation -> Classification -> Duplicate
 *      Resolution -> Registration Decision -> Registry Writer, single-owner
 *      per stage) -> Registry
 *   -> handoff/evidence reference (recordHandoff, now carrying the real
 *      resource_id/capability_id each artifact became)
 *   -> next decision (computeNextDecisionFromEvidence)
 *
 * The handoff record produced here is evidence that a delivery happened —
 * never the destination of the work. A handoff naming 3 changed files + 1
 * test + 1 new capability becomes 5 separately registered artifacts, never
 * one resource standing in for the whole delivery.
 *
 * Every admission check this function performs (task exists and has an
 * admitted work_order, status is EXECUTING/VERIFYING, no duplicate active
 * submission, field-level HandoffAdmission) is the SAME logic
 * transport/owner-command-http/server.ts's handleAgentHandoff used to run
 * inline — moved here so there is one canonical place, not logic split
 * between a transport file and this capability.
 *
 * Input: `WorkResultInput`, a `RegistryStore` the caller already holds.
 * Output: `ingestWorkResult` -> `WorkResultIngressResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./classifier.ts,
 * ../ui-render-verification/contract.ts (the mandatory render gate),
 * ../agent-gateway/contract.ts, ../registration-pipeline/contract.ts,
 * ../../software/registry-database/contract.ts (RegistryStore type only).
 * สิ่งที่ห้ามแตะ: never call runRegistrationPipeline for an artifact before
 * the task/worker/session admission checks below all pass. Never let a
 * partially-failed artifact registration silently drop the failure —
 * every artifact's real decision is always reported back. Never
 * re-implement Classification/Duplicate Resolution here — this file's
 * only registration-facing responsibility is splitting one work result
 * into candidates and calling the pipeline once per candidate.
 */

import { getTask, loadHandoffsForTask, validateHandoff, recordHandoff, loadEvidenceForTask, computeNextDecisionFromEvidence } from "../agent-gateway/contract";
import { runRegistrationPipeline } from "../registration-pipeline/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import { splitWorkResultIntoCandidates } from "./classifier";
import { decideCompletion } from "../ui-render-verification/contract";
import type { RegisteredArtifact, WorkResultInput, WorkResultIngressResult } from "./types";

const SUCCESSFUL_DECISIONS = new Set(["REGISTERED", "DUPLICATE"]);

function rejected(task_id: string, blocker: string, artifacts: readonly RegisteredArtifact[] = []): WorkResultIngressResult {
  return { status: "REJECTED", task_id, handoff_id: null, dna_os_decision: null, artifacts, next_decision: null, blocker };
}

export function ingestWorkResult(input: WorkResultInput, deps: { store: RegistryStore }): WorkResultIngressResult {
  // 1. validate task/worker/session — the same admission a handoff always required.
  const task = getTask(input.task_id);
  if (!task || !task.work_order) return rejected(input.task_id, "WORK_ORDER_NOT_ADMITTED");
  if (task.status !== "EXECUTING" && task.status !== "VERIFYING") return rejected(input.task_id, `WORK_ORDER_NOT_ACTIVE:${task.status}`);

  // 1a. UI RENDER GATE (Owner, 2026-08-26). This function is where BOTH
  // completion-producing paths converge — `POST /handoff` from a real external
  // agent, and gateway.ts's own internal dispatch-and-verify step, whose
  // COMPLETED/FAILED is decided by this result. Gating here rather than at one
  // caller is what makes it non-bypassable, and there is deliberately no
  // parameter that turns it off.
  //
  // It is deterministic end to end: UI impact comes from path rules over
  // `files_changed` plus the servers' real route table, and the verdict comes
  // from a real browser DOM. A change that no route owns returns UI_IMPACT=NO
  // and this costs nothing.
  const completion = decideCompletion({
    execution_id: input.task_id,
    changed_paths: input.files_changed,
    // The work order names a target path, not a capability id; the task id is
    // the identity this completion is actually about.
    capability_id: input.task_id,
    applied_at: task.updated_at,
    correlation_id: input.input_reference,
  });
  if (completion.status === "COMPLETE_DENIED") {
    return rejected(input.task_id, `UI_RENDER_NOT_VERIFIED:${completion.ui_impact}:${completion.render_verdict ?? "NO_EVIDENCE"}:${completion.reason}`);
  }

  const existingActive = loadHandoffsForTask(task.task_id).find(
    (handoff) => handoff.agent_id !== "owner-console" && (handoff.dna_os_decision === "AGENT_SUBMITTED" || handoff.dna_os_decision === "DNA_VALIDATING"),
  );
  if (existingActive) return rejected(input.task_id, `DUPLICATE_ACTIVE_SUBMISSION:${existingActive.handoff_id}`);

  const admission = validateHandoff(input);
  if (!admission.ok) return rejected(input.task_id, `HANDOFF_ADMISSION_FAILED:${admission.reason_codes.join(",")}`);

  // 2/3. classify result contents -> split into candidate(s).
  const candidates = splitWorkResultIntoCandidates(input);

  // 4. Registration Pipeline -> Registry, one real decision per artifact — never a shortcut, never skipped.
  const artifacts: RegisteredArtifact[] = candidates.map((candidate) => {
    const result = runRegistrationPipeline(candidate, deps.store, input.task_id);
    const resource_id = result.status === "REGISTERED" ? result.resource_id : result.status === "DUPLICATE" ? result.duplicate_of.resource_id : null;
    const capability_id = result.status === "REGISTERED" ? result.capability_id : result.status === "DUPLICATE" ? result.duplicate_of.capability_id : null;
    return { candidate_id: candidate.candidate_id, resource_type: candidate.resource_type, decision: result.status, resource_id, capability_id };
  });

  // 5. handoff/evidence reference — recorded AFTER registration so it can name what the delivery actually became.
  const handoffResult = recordHandoff(input, artifacts.map((a) => ({ resource_type: a.resource_type, resource_id: a.resource_id, capability_id: a.capability_id })));
  if (!handoffResult.ok) return rejected(input.task_id, `HANDOFF_RECORD_FAILED:${handoffResult.admission.reason_codes.join(",")}`, artifacts);

  // 6. next decision — deterministic, from real persisted evidence only.
  const evidence = loadEvidenceForTask(task.task_id);
  const nextDecision = computeNextDecisionFromEvidence(task.task_id, evidence);

  const successCount = artifacts.filter((a) => SUCCESSFUL_DECISIONS.has(a.decision)).length;
  const status = artifacts.length === 0 || successCount === artifacts.length ? "REGISTERED" : successCount > 0 ? "PARTIALLY_REGISTERED" : "REJECTED";

  return {
    status,
    task_id: task.task_id,
    handoff_id: handoffResult.handoff.handoff_id,
    dna_os_decision: handoffResult.handoff.dna_os_decision,
    artifacts,
    next_decision: nextDecision,
    blocker: null,
  };
}
