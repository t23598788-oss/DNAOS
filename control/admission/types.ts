/**
 * หน้าที่: the type contracts for Admission — the layer between
 * Permission/Policy Resolution and Execute (not built this round):
 *
 * REGISTERED ARTIFACT -> DESTINATION MAPPING -> TARGET RESOLUTION
 *   -> PERMISSION/POLICY -> ADMISSION (here) -> STOP
 *
 * Answers exactly one question: "is this work item ready to be sent to
 * the target Policy already allowed?" Never reclassifies, never
 * re-checks duplicates, never re-resolves destination/target, never
 * re-decides policy — it only checks that the finished results of those
 * stages are present, consistent, and still valid.
 *
 * Input: none (pure type definitions).
 * Output: `AdmissionDecision`, `AdmissionInput`, `AdmissionReasonCode`,
 * `ExecutionReadyReference`, `AdmissionResult`.
 * Dependency ที่อนุญาต: ../target-resolution/contract.ts (ResolvedTarget
 * type only), ../permission-policy-resolution/contract.ts (PolicyDecision
 * type only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pre-supply a
 * `decision` — every field here is only ever produced by
 * ./resolver.ts running the real checks.
 */

import type { ResolvedTarget } from "../target-resolution/contract";
import type { PolicyDecision } from "../permission-policy-resolution/contract";

export type AdmissionDecision = "ADMITTED" | "NOT_ADMITTED" | "REQUIRE_APPROVAL" | "UNRESOLVED";

export type AdmissionReasonCode =
  | "ARTIFACT_NOT_REGISTERED"
  | "TASK_NOT_FOUND"
  | "POLICY_DECISION_NOT_FOUND"
  | "IDENTITY_MISMATCH"
  | "TARGET_NOT_RESOLVED"
  | "EVIDENCE_INCOMPLETE"
  | "TASK_NOT_ACTIVE"
  | "POLICY_DENIED"
  | "OWNER_APPROVAL_REQUIRED"
  | "ADMITTED";

/**
 * Exactly the finished results of the prior stages, received as-is —
 * never recomputed. `policy_decision_id`/`policy_decision` are the
 * caller's claim; ./resolver.ts independently re-reads the REAL,
 * persisted PolicyResult (the same Evidence row
 * `control/permission-policy-resolution/resolver.ts` itself wrote) by
 * that id and cross-checks the claim against it — never trusts the
 * caller's claim on its own.
 */
export interface AdmissionInput {
  artifact_resource_id: string;
  task_id: string;
  correlation_id: string;
  resolved_target: ResolvedTarget;
  policy_decision_id: string;
  policy_decision: PolicyDecision;
  evidence_refs: readonly string[];
}

/** The only thing ADMITTED ever produces — a reference, never an action. Execute (not built) is the only thing allowed to act on it. */
export interface ExecutionReadyReference {
  admission_id: string;
  artifact_resource_id: string;
  task_id: string;
  resolved_target: ResolvedTarget;
  authorized_action: string;
  policy_decision_id: string;
  evidence_refs: readonly string[];
  correlation_id: string;
}

export interface AdmissionResult {
  admission_id: string;
  decision: AdmissionDecision;
  reason_code: AdmissionReasonCode;
  artifact_resource_id: string;
  task_id: string;
  correlation_id: string;
  evidence_refs: readonly string[];
  created_at: string;
  /** Present only when decision === "ADMITTED". */
  execution_ready_reference: ExecutionReadyReference | null;
}
