/**
 * หน้าที่: `evaluateAdmission()` — deterministically answers "is this
 * work item ready to be sent to the target Policy already allowed?" No
 * LLM, no AI reasoning, no free-text policy generation — every branch
 * below is a fixed check against real, already-produced state (task
 * store, the real persisted PolicyResult evidence, the caller-supplied
 * ResolvedTarget). Never reclassifies, never re-checks duplicates, never
 * re-resolves a destination/target, never re-decides policy, never
 * executes anything.
 *
 * REGISTERED ARTIFACT -> DESTINATION MAPPING -> TARGET RESOLUTION
 *   -> PERMISSION/POLICY -> ADMISSION (here) -> STOP
 *
 * Input: `AdmissionInput`, a real `RegistryStore`.
 * Output: `evaluateAdmission` -> `AdmissionResult` (also persisted as
 * Evidence, kind="admission" — the same closed literal
 * `control/agent-gateway/types.ts`'s `Evidence.kind` already carried).
 * Dependency ที่อนุญาต: ../agent-gateway/contract.ts (getTask,
 * loadEvidenceForTask, saveEvidence — task context + the real persisted
 * policy decision + evidence persistence only), ../../software/registry-database/contract.ts
 * (findResourceById, RegistryStore — read-only, existence check only),
 * ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never call classifyCandidate/resolveDuplicate/
 * resolveArtifactDestination/resolveTarget/resolvePolicy here — Admission
 * consumes their finished results, it never recomputes them. Never call a
 * network API, git, GitHub, or a child process. Never return ADMITTED
 * from a default/fallback branch — the only path to ADMITTED is every
 * check passing and policy_decision === "ALLOW".
 */

import { getTask, loadEvidenceForTask, saveEvidence } from "../agent-gateway/contract";
import { findResourceById } from "../../software/registry-database/contract";
import type { RegistryStore } from "../../software/registry-database/contract";
import type { PolicyResult } from "../permission-policy-resolution/contract";
import { newAdmissionId, nowIso } from "./host-runtime";
import type { AdmissionInput, AdmissionReasonCode, AdmissionResult } from "./types";

export interface AdmissionContext {
  store: RegistryStore;
}

const TERMINAL_TASK_STATUSES = new Set(["COMPLETED", "FAILED", "BLOCKED"]);

function finalize(input: AdmissionInput, decision: AdmissionResult["decision"], reason_code: AdmissionReasonCode, buildReference?: (admissionId: string) => AdmissionResult["execution_ready_reference"]): AdmissionResult {
  const admissionId = newAdmissionId();
  const result: AdmissionResult = {
    admission_id: admissionId,
    decision,
    reason_code,
    artifact_resource_id: input.artifact_resource_id,
    task_id: input.task_id,
    correlation_id: input.correlation_id,
    evidence_refs: input.evidence_refs,
    created_at: nowIso(),
    execution_ready_reference: buildReference ? buildReference(admissionId) : null,
  };
  saveEvidence({
    evidence_id: result.admission_id,
    task_id: result.task_id,
    kind: "admission",
    source: "control/admission/resolver.ts",
    recorded_at: result.created_at,
    payload: result,
  });
  return result;
}

export function evaluateAdmission(input: AdmissionInput, context: AdmissionContext): AdmissionResult {
  // MINIMUM CHECK 1 — artifact has real registration.
  const artifact = findResourceById(input.artifact_resource_id, context.store);
  if (!artifact) return finalize(input, "UNRESOLVED", "ARTIFACT_NOT_REGISTERED");

  // MINIMUM CHECK 5 (existence half) — task/work order exists at all.
  const task = getTask(input.task_id);
  if (!task) return finalize(input, "UNRESOLVED", "TASK_NOT_FOUND");

  // MINIMUM CHECK 3 — the policy decision must reference the SAME
  // artifact/task. Never trust the caller's claimed policy_decision_id/
  // policy_decision alone — independently re-read the REAL, persisted
  // PolicyResult (the same Evidence row permission-policy-resolution
  // itself wrote) and cross-check the claim against it.
  const evidence = loadEvidenceForTask(input.task_id);
  const policyEvidence = evidence.find((e) => e.kind === "policy_decision" && e.evidence_id === input.policy_decision_id);
  if (!policyEvidence) return finalize(input, "UNRESOLVED", "POLICY_DECISION_NOT_FOUND");
  const realPolicy = policyEvidence.payload as PolicyResult;
  if (realPolicy.artifact_resource_id !== input.artifact_resource_id || realPolicy.task_id !== input.task_id || realPolicy.decision !== input.policy_decision) {
    return finalize(input, "NOT_ADMITTED", "IDENTITY_MISMATCH");
  }
  if (input.resolved_target.artifact_resource_id !== input.artifact_resource_id) {
    return finalize(input, "NOT_ADMITTED", "IDENTITY_MISMATCH");
  }

  // MINIMUM CHECK 2 — target has a real RESOLVED result.
  if (input.resolved_target.target_status !== "RESOLVED" || !input.resolved_target.target_ref) {
    return finalize(input, "UNRESOLVED", "TARGET_NOT_RESOLVED");
  }

  // MINIMUM CHECK 6 — required evidence is present.
  if (input.evidence_refs.length === 0 || realPolicy.evidence_refs.length === 0) {
    return finalize(input, "UNRESOLVED", "EVIDENCE_INCOMPLETE");
  }

  // MINIMUM CHECK 5 (validity half) — task/work order still active.
  if (TERMINAL_TASK_STATUSES.has(task.status)) {
    return finalize(input, "NOT_ADMITTED", "TASK_NOT_ACTIVE");
  }

  // MINIMUM CHECK 4 — policy decision itself.
  if (realPolicy.decision === "DENY") return finalize(input, "NOT_ADMITTED", "POLICY_DENIED");
  if (realPolicy.decision === "REQUIRE_APPROVAL") return finalize(input, "REQUIRE_APPROVAL", "OWNER_APPROVAL_REQUIRED");
  if (realPolicy.decision !== "ALLOW") {
    // Defensive: any future PolicyDecision value this function doesn't
    // yet know how to handle is reported honestly as UNRESOLVED, never
    // silently admitted.
    return finalize(input, "UNRESOLVED", "POLICY_DECISION_NOT_FOUND");
  }

  return finalize(input, "ADMITTED", "ADMITTED", (admissionId) => ({
    admission_id: admissionId,
    artifact_resource_id: input.artifact_resource_id,
    task_id: input.task_id,
    resolved_target: input.resolved_target,
    authorized_action: realPolicy.requested_action,
    policy_decision_id: realPolicy.policy_decision_id,
    evidence_refs: input.evidence_refs,
    correlation_id: input.correlation_id,
  }));
}
