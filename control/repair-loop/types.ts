/**
 * หน้าที่: the contracts for the error-driven code completion loop — the gap
 * classification, the REPAIR_WORK_ITEM the Owner specified verbatim, the
 * agent's proposal shape, and the deterministic verification verdict. Pure
 * types, no behaviour.
 *
 * WHY A STRUCTURED REPAIR ITEM AND NEVER "fix this": an agent handed a free
 * sentence has to go and find the problem, which means scanning, guessing,
 * and touching files nobody authorised. Every field below exists to remove a
 * reason for the agent to look anywhere else — the exact source path, the
 * exact contract, the exact evidence, the exact dependency, and an explicit
 * allowed/forbidden path list.
 *
 * Input: none (pure type definitions).
 * Output: every type below.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that lets an agent declare its own
 * success. `AgentProposal` has no status field for exactly that reason: only
 * `VerificationVerdict`, produced by deterministic checks this repo runs
 * itself, can say VERIFIED.
 */

/** The seven states the Owner fixed for every capability/connection in the graph. */
export type GapState =
  | "CONNECTED_VERIFIED"
  | "CONNECTED_UNVERIFIED"
  | "DECLARED_ONLY"
  | "MISSING_CONNECTION"
  | "BLOCKED"
  | "ERROR"
  | "UNKNOWN";

/** Root cause classes. A block is NOT assumed to be a defect — see EXPECTED_POLICY_BLOCK. */
export type RootCauseClass =
  | "EXPECTED_POLICY_BLOCK"
  | "EXPECTED_BY_DESIGN"
  | "MISSING_CONNECTION"
  | "CONTRACT_DEFECT"
  | "IMPLEMENTATION_DEFECT"
  | "MISSING_EVIDENCE"
  | "MISLEADING_EVIDENCE"
  | "UNDETERMINED";

export type RepairType =
  | "CODE_DEFECT"
  | "MISSING_IMPLEMENTATION"
  | "MISSING_CONNECTION"
  | "CONTRACT_MISMATCH"
  | "TEST_FAILURE"
  | "RUNTIME_FAILURE"
  | "SECURITY_BLOCK"
  | "REGISTRY_MISMATCH"
  | "EVIDENCE_MISSING"
  | "INFRASTRUCTURE_FAILURE";

/** One item in the deterministic, dependency-ordered gap queue. */
export interface GapRecord {
  readonly gap_id: string;
  /**
   * ADDITIVE (M5, 2026-08-30) — ตัวตนของ "งาน" ที่ช่องว่างนี้อยู่ภายใต้
   *
   * ใช้ความหมายเดิมของ `work-<uuid>` ที่ control/owner-backbone, SSE
   * `/owner/events?work_id=`, `claimWork` และ `WorkspaceReservation` ใช้อยู่แล้ว
   * ไม่ใช่ namespace ใหม่ และ **ห้ามสร้างใหม่เมื่อมีของต้นทางอยู่แล้ว** —
   * ความล้มเหลวเดียวกันต้องมีสายเลือดเดียวตลอดทั้งระบบ
   *
   * optional เพราะ `scanGaps` ค้นเจอช่องว่างจากทะเบียนได้เองโดยไม่มีงานต้นทาง
   * แถวที่ไม่มีค่าคือ "ยังไม่ผูกกับงานใด" ไม่ใช่ "ไม่มีงาน" และแถวเก่าทุกแถว
   * อ่านได้เหมือนเดิม
   */
  readonly work_id?: string;
  /** ตัวตนของเหตุการณ์ต้นทางที่ทำให้ช่องว่างนี้ถูกสร้าง — คงไว้ ไม่ถูกแทนที่ */
  readonly source_event_id?: string;
  readonly capability_id: string;
  readonly source_path: string | null;
  readonly state: GapState;
  /** Why this state, from the record that produced it. Never a summary of an assumption. */
  readonly reason: string;
  readonly evidence_refs: readonly string[];
  readonly registry_refs: readonly string[];
  readonly upstream: readonly string[];
  readonly downstream: readonly string[];
  /** 0 = no upstream gap; higher = more upstream gaps must close first. */
  readonly depth: number;
  readonly occurrences: number;
  readonly first_seen: string | null;
  readonly last_seen: string | null;
  readonly repair_type: RepairType | null;
  readonly actionable: boolean;
  readonly not_actionable_reason: string | null;
}

/** THE repair contract — every field the Owner listed, in the Owner's order. */
export interface RepairWorkItem {
  readonly repair_id: string;
  readonly event_id: string;
  readonly trace_id: string;
  readonly work_id: string;

  readonly failed_capability_id: string;
  readonly failed_boundary: string;
  readonly source_path: string | null;
  readonly upstream_capability: string | null;
  readonly downstream_capability: string | null;

  readonly error_code: string;
  readonly error_message: string;
  readonly observed_state: string;
  readonly expected_contract: string;

  readonly evidence_refs: readonly string[];
  readonly registry_refs: readonly string[];
  readonly existing_tests: readonly string[];
  readonly dependencies: readonly string[];

  readonly allowed_paths: readonly string[];
  readonly forbidden_paths: readonly string[];

  readonly verification_required: readonly string[];
  readonly success_condition: string;

  readonly repair_type: RepairType;
  readonly root_cause_class: RootCauseClass;
  readonly attempt: number;
  readonly error_signature: string;
}

/**
 * What an agent returns. Note what is absent: no status, no "SUCCESS", no
 * "VERIFIED". An agent reports what it changed and what it expects; the
 * verdict is produced by this repo running real checks.
 */
export interface AgentProposal {
  readonly repair_id: string;
  readonly PROPOSED_CHANGE: string;
  readonly FILES_CHANGED: readonly { path: string; operation: "CREATE" | "MODIFY"; content: string }[];
  readonly CONTRACT_SATISFIED: string;
  readonly TESTS_ADDED_OR_USED: readonly string[];
  readonly EXPECTED_RESULT: string;
  readonly EVIDENCE_REQUIRED: readonly string[];
}

export type VerificationStage =
  | "SOURCE_VALIDATION"
  | "CONTRACT_VALIDATION"
  | "DEPENDENCY_VALIDATION"
  | "SECURITY_PERMISSION_VALIDATION"
  | "ISOLATED_TEST"
  | "REGRESSION_TEST"
  | "DETERMINISTIC_VERIFIER"
  | "WRITE_GATE"
  | "CONTROLLED_PROMOTION"
  | "RUNTIME_VERIFICATION";

export interface StageResult {
  readonly stage: VerificationStage;
  readonly passed: boolean;
  readonly detail: string;
  readonly evidence_ref: string | null;
}

export interface VerificationVerdict {
  readonly repair_id: string;
  /** VERIFIED can only be produced by this repo's own deterministic checks. */
  readonly verdict: "VERIFIED" | "REJECT_CHANGE" | "NOT_ATTEMPTED";
  readonly failed_stage: VerificationStage | null;
  readonly stages: readonly StageResult[];
  readonly evidence_ref: string;
  readonly code_hash: string | null;
}

/** Conditions that stop the loop automatically, without asking. */
export type StopCondition =
  | "OWNER_DECISION_REQUIRED"
  | "SECURITY_BOUNDARY_CHANGE_REQUIRED"
  | "NEW_EXTERNAL_CREDENTIAL_REQUIRED"
  | "PAID_RESOURCE_REQUIRED"
  | "DESTRUCTIVE_CHANGE_REQUIRED"
  | "NO_VERIFIABLE_EVIDENCE"
  | "LOOP_DETECTED"
  | "NO_PROGRESS"
  | "MAX_ATTEMPTS_REACHED";

export interface RepairAttemptRecord {
  readonly repair_id: string;
  readonly trace_id: string;
  readonly attempt: number;
  readonly code_hash: string | null;
  readonly error_signature: string;
  readonly verdict: string;
  readonly recorded_at: string;
  /** Which verifier produced this verdict. Attempts are only comparable within one version — see verifier.ts's VERIFIER_VERSION. */
  readonly verifier_version?: string;
}

export interface RepairCycleOutcome {
  readonly repair: RepairWorkItem | null;
  readonly gap: GapRecord;
  readonly root_cause_class: RootCauseClass;
  readonly dispatched: boolean;
  readonly route_group: string | null;
  readonly proposal: AgentProposal | null;
  readonly verdict: VerificationVerdict | null;
  readonly graph_before: GapState;
  readonly graph_after: GapState;
  readonly stopped: StopCondition | null;
  readonly evidence_ref: string;
  readonly next_gap_id: string | null;
}
