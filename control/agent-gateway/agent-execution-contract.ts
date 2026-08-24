/**
 * หน้าที่: the MACHINE-ONLY result/error/requested-action contract for
 * DNA OS's live Agent execution path (Owner, "Authority Assembly Phase
 * 1" — 1D Single Output Contract, 1E Requested Action Contract). Every
 * Agent Host dispatch is normalized into exactly this shape by
 * `./agent-host-dispatch.ts` — never a natural-language report, never a
 * per-provider result shape. Downstream DNA OS code must never branch on
 * which provider produced a result — only on these typed fields.
 *
 * Input: none (pure type/constant definitions).
 * Output: `MACHINE_CONTRACT_VERSION`, `Severity`, `AgentResultStatus`,
 * `RequestedActionOperation`, `RequestedAction`, `MachineError`,
 * `VerificationResult`, `DnaOsAgentResult`, `RuntimeEvidence`,
 * `ERROR_CODES`.
 * Dependency ที่อนุญาต: none — a leaf contract, same discipline as
 * `contracts/identity/envelope-identity.ts`.
 * สิ่งที่ห้ามแตะ: never add a free-text field this repo's decision logic
 * could ever branch on — every decision-relevant fact must be one of the
 * typed fields below. Never widen `RequestedActionOperation` implicitly —
 * an operation outside this closed list must be rejected
 * (EXECUTOR_NOT_AVAILABLE / MALFORMED_RESULT), never silently accepted.
 */

export const MACHINE_CONTRACT_VERSION = "DNA_OS_AGENT_RESULT_V1" as const;
export const MACHINE_INPUT_CONTRACT_VERSION = "DNA_OS_AGENT_INPUT_V1" as const;

/**
 * The Machine Input Contract (Owner, "Phase 2 — Agent Workspace
 * Architecture", item 4). Built ONLY by
 * `./workspace-manager.ts`/`./agent-host-dispatch.ts` from a real
 * `WorkOrder` + `TaskWorkspace` — never provider-specific business logic,
 * no field naming a specific AI provider. This is what actually reaches
 * the Agent (as its instruction), so it must carry everything the Agent
 * needs to work AND everything DNA OS needs to later verify the result
 * against.
 */
export interface DnaOsAgentInput {
  protocol: typeof MACHINE_INPUT_CONTRACT_VERSION;
  work_order_id: string;
  workspace_id: string;
  objective: string;
  /** Real, absolute MASTER_SOURCE paths the Agent may read — same as TaskWorkspace.allowed_read_paths. */
  context_refs: readonly string[];
  /** Real, absolute paths the Agent's proposal/artifacts should reference if it names a real-source location it wants changed — informational only, never write authority. */
  source_refs: readonly string[];
  allowed_operations: readonly RequestedActionOperation[];
  expected_outputs: readonly string[];
  acceptance_criteria: readonly string[];
}

/** Canonical severity — exactly these four, nothing else. */
export type Severity = "INFO" | "WARNING" | "BLOCKING" | "CRITICAL";

/** FAIL_CLOSED is the boundary's own verdict (malformed/unknown/mismatched result) — distinct from FAIL (the Agent's own work failed) and ERROR (the Agent process itself errored). */
export type AgentResultStatus = "PASS" | "FAIL" | "ERROR" | "BLOCKED" | "FAIL_CLOSED";

/**
 * Closed vocabulary (Owner, Phase 1E). An Agent may only ever REQUEST one
 * of these; anything else is FAIL_CLOSED at the boundary, never silently
 * passed through. This phase does not require every one of these to have
 * a real executor — see EXECUTOR_NOT_AVAILABLE.
 */
export type RequestedActionOperation =
  | "FILE_CREATE"
  | "FILE_MODIFY"
  | "FILE_DELETE"
  | "FILE_MOVE"
  | "PROCESS_EXECUTE"
  | "GIT_OPERATION"
  | "GITHUB_OPERATION"
  | "PACKAGE_OPERATION"
  | "CREDENTIAL_OPERATION"
  | "SUPABASE_OPERATION"
  | "VERCEL_OPERATION"
  | "NETWORK_OPERATION"
  | "APPLE_EVENT_OPERATION";

/**
 * An action the Agent identified as needed but has NO authority to
 * perform itself — DNA OS decides whether it ever executes, through
 * `./agent-authority-router.ts`. This is the ONLY way a real-state-
 * changing action can ever originate from an Agent Host dispatch.
 */
export interface RequestedAction {
  operation: RequestedActionOperation;
  artifact_ref: string;
  target: string;
}

export interface MachineError {
  error_code: string;
  severity: Severity;
  retryable: boolean;
  required_capability: string | null;
}

export interface VerificationResult {
  verified: boolean;
  /** e.g. "exit_code" | "work_order_id_match" | "artifact_presence" | "boundary_test" */
  method: string;
  checked_against: readonly string[];
}

export interface RuntimeEvidence {
  launcher_pid: number;
  sandbox_pid: number | null;
  agent_pid: number | null;
  /** [launcher_pid, agent_pid] — sandbox_pid and agent_pid are the SAME OS pid by construction: sandbox-exec forks once then execve()s directly into the target binary in place, never a second fork. This is stated explicitly rather than fabricating a third distinct pid. */
  ppid_chain: readonly number[];
  uid: number;
  executable: string;
  workspace: string;
  sandbox_profile_hash: string | null;
  started_at: string;
  ended_at: string;
  exit_code: number | null;
}

export interface DnaOsAgentResult {
  protocol: typeof MACHINE_CONTRACT_VERSION;
  work_order_id: string;
  /** The real TaskWorkspace this dispatch ran under (control/agent-gateway/workspace-manager.ts) — completes the Phase 2 lineage: command_id -> work_order_id -> workspace_id -> launch_id -> agent_pid -> result_id -> verification_id -> decision_id. */
  workspace_id: string;
  /** control/agent-host's own AgentLaunchResult.launchId — null only when no real launch was attempted (e.g. WORKER_NOT_AVAILABLE). */
  launch_id: string | null;
  result_id: string;
  /** The evidence_id of the persisted "verification" Evidence this result's own `verification` field was derived from — null only when no launch was attempted. */
  verification_id: string | null;
  task_id: string;
  worker_id: string;
  status: AgentResultStatus;
  summary: string;
  error_code: string | null;
  severity: Severity | null;
  artifacts: readonly string[];
  evidence_refs: readonly string[];
  requested_actions: readonly RequestedAction[];
  errors: readonly MachineError[];
  verification: VerificationResult;
  runtime: RuntimeEvidence;
  exit_code: number | null;
}

/** Canonical, closed error-code vocabulary — additive only, never inferred from free text. */
export const ERROR_CODES = {
  REAL_SOURCE_WRITE_DENIED: "REAL_SOURCE_WRITE_DENIED",
  EXEC_DENIED: "EXEC_DENIED",
  NETWORK_DENIED: "NETWORK_DENIED",
  WORKER_NOT_AVAILABLE: "WORKER_NOT_AVAILABLE",
  DEPENDENCY_BOUNDARY_EXPANSION_REQUIRED: "DEPENDENCY_BOUNDARY_EXPANSION_REQUIRED",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  LAUNCH_FAILED: "LAUNCH_FAILED",
  MALFORMED_RESULT: "MALFORMED_RESULT",
  MISSING_WORK_ORDER_ID: "MISSING_WORK_ORDER_ID",
  WORK_ORDER_MISMATCH: "WORK_ORDER_MISMATCH",
  UNKNOWN_REQUESTED_ACTION: "UNKNOWN_REQUESTED_ACTION",
  EXECUTOR_NOT_AVAILABLE: "EXECUTOR_NOT_AVAILABLE",
} as const;

/** The closed set `RequestedActionOperation` actually contains — used by the boundary parser and the Authority Router to reject anything else, never inferred ad hoc. */
export const REQUESTED_ACTION_OPERATIONS: readonly RequestedActionOperation[] = [
  "FILE_CREATE", "FILE_MODIFY", "FILE_DELETE", "FILE_MOVE",
  "PROCESS_EXECUTE", "GIT_OPERATION", "GITHUB_OPERATION",
  "PACKAGE_OPERATION", "CREDENTIAL_OPERATION", "SUPABASE_OPERATION",
  "VERCEL_OPERATION", "NETWORK_OPERATION", "APPLE_EVENT_OPERATION",
];
