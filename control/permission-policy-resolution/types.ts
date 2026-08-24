/**
 * หน้าที่: the type contracts for Permission / Policy Resolution — the
 * layer between Target Resolution (`control/target-resolution/`) and
 * Admission/Execute (not built this round):
 *
 * REGISTERED ARTIFACT -> DESTINATION MAPPING -> TARGET RESOLUTION
 *   -> PERMISSION / POLICY RESOLUTION (this folder)
 *   -> [ Admission -> Execute — future rounds ]
 *
 * Input: none (pure type definitions).
 * Output: `RequestedAction`, `PolicyDecision`, `PolicyResolutionInput`,
 * `PolicyResult`.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller pass a pre-computed
 * decision — `decision` is only ever produced by `./resolver.ts`.
 */

export type RequestedAction =
  | "WRITE_SOURCE"
  | "APPEND_EVIDENCE"
  | "REGISTER_CAPABILITY"
  | "UPDATE_CAPABILITY"
  | "REGISTER_SYSTEM_RESOURCE"
  | "UPDATE_SYSTEM_RESOURCE"
  | "PREPARE_DEPLOYMENT"
  | "READ_SYSTEM_STATE";

export type PolicyDecision = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export interface PolicyResolutionInput {
  artifact_resource_id: string;
  artifact_resource_type: string;
  source_capability_id: string | null;
  target_capability_id: string | null;
  target_class: string | null;
  task_id: string;
  worker_id: string;
  /** Caller-supplied, unvalidated until ./resolver.ts checks it against RequestedAction — see reason_code UNKNOWN_ACTION. */
  requested_action: string;
  evidence_refs: readonly string[];
  correlation_id: string;
}

export interface PolicyResult {
  policy_decision_id: string;
  artifact_resource_id: string;
  source_capability_id: string | null;
  target_capability_id: string | null;
  requested_action: string;
  decision: PolicyDecision;
  reason_codes: readonly string[];
  evidence_refs: readonly string[];
  task_id: string;
  correlation_id: string;
  created_at: string;
}
