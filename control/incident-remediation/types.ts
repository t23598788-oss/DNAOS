/**
 * หน้าที่: type contracts for `control/incident-remediation/` — the loop
 * that closes INCIDENT -> RESOURCE -> REMEDIATION, reusing every component
 * already proven rather than rebuilding any of them.
 *
 * REUSED, NEVER REBUILT: `../alert-correlation/` (incident + the live probe
 * that judges it), `../work-resolution/` (ResolvedWorkContext, persistence,
 * sandbox-bridge), `../scheduler/` (`discoverPool`/`routeWork` — the real
 * "AI as chip" resource selection), `../machine-observation/` (evidence),
 * `../../software/live-census/` (`loadPreviousSnapshot`),
 * `../../permissions/write-gate/` (via the mandatory gate).
 *
 * TWO RULES THIS FILE ENCODES STRUCTURALLY:
 *  1. NO SILENT TERMINAL STATE. Every outcome is one of exactly three
 *     values. There is no "logged and forgotten" branch, and no fourth
 *     state a caller could invent.
 *  2. NO AI AUTHORITY over provider choice or money. Resource selection is
 *     `routeWork`'s deterministic score; anything with a cost consequence
 *     terminates at OWNER_DECISION_REQUIRED.
 *
 * Input: none (pure type definitions).
 * Output: every type below.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a terminal state beyond the three below, and
 * never add a field letting a caller declare an incident RESOLVED — that
 * verdict may only come from re-querying the original fault source.
 */

/** The ONLY three end states. §H: nothing may end merely logged. */
export type RemediationTerminalState =
  | "AUTO_RECOVERY_IN_PROGRESS"
  | "RESOLVED"
  | "OWNER_DECISION_REQUIRED";

export type RemediationBlockReason =
  | "NONE"
  | "UNRESOLVED_ARCHITECTURE"
  | "NO_AUTHORIZED_EXECUTION_RESOURCE"
  | "PAYMENT_REQUIRED"
  | "FINANCIAL_DECISION"
  | "UNKNOWN_SERVICE_OR_PROVIDER"
  | "REMEDIATION_POLICY_VIOLATION"
  | "REMEDIATION_FAILED"
  | "ORIGINAL_FAULT_PERSISTS";

/** One execution attempt against one provider. Failover appends, never replaces. */
export interface ExecutionAttempt {
  /** NEW per attempt — the execution/session identity. */
  readonly execution_id: string;
  /** CLAUDE | CODEX | GEMINI | LOCAL — from ../scheduler/provider-pool.ts. */
  readonly provider: string;
  readonly unit_id: string;
  readonly started_at: string;
  readonly outcome: "DISPATCHED" | "TOKEN_EXHAUSTED" | "UNAVAILABLE" | "POLICY_VIOLATION" | "COMPLETED" | "REFUSED_BY_SANDBOX";
  readonly detail: string;
}

/** What machine-observation actually saw, compared against the approved scope. */
export interface ObservedWriteEvidence {
  readonly observed_at: string;
  readonly pids: readonly number[];
  readonly files_changed: readonly string[];
  /** Files written outside `allowed_write_scope`. Non-empty => POLICY_VIOLATION. */
  readonly out_of_scope_writes: readonly string[];
  readonly detail: string;
}

/** The re-query of the ORIGINAL fault source. Never the Agent's own claim. */
export interface OriginalFaultCheck {
  readonly checked_at: string;
  readonly source: string;
  readonly cleared: boolean;
  readonly detail: string;
}

export interface RemediationRecord {
  readonly incident_id: string;
  readonly work_id: string;
  /** The persisted resolution this remediation is bound to. */
  readonly resolution_id: string;

  readonly provider: string;
  readonly service_id: string;
  readonly resource_id: string;
  readonly capability_id: string;
  readonly runtime_owner: string;
  readonly source_root: string;
  readonly exact_source_paths: readonly string[];
  readonly dependencies: readonly string[];
  readonly consumers: readonly string[];
  readonly credential_boundary: string;

  readonly allowed_write_scope: readonly string[];
  readonly forbidden_write_scope: readonly string[];
  readonly required_remediation: string;

  /** Live census evidence, read from the persisted snapshot — never recomputed blindly. */
  readonly census_evidence: string;
  /** Current runtime state at the moment of decision. */
  readonly current_runtime_state: string;

  readonly attempts: readonly ExecutionAttempt[];
  readonly observation: ObservedWriteEvidence | null;
  readonly fault_check: OriginalFaultCheck | null;

  readonly terminal_state: RemediationTerminalState;
  readonly block_reason: RemediationBlockReason;
  readonly next_action: string;
  /** Structurally constant. Present so the absence of AI money authority is auditable. */
  readonly ai_financial_authority: false;
  /** Structurally constant. Provider choice is routeWork's score, never a model's. */
  readonly ai_provider_selection_authority: false;
  readonly updated_at: string;
}
