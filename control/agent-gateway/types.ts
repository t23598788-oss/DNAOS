/**
 * หน้าที่: the central, provider-agnostic contract for the DNA OS Agent
 * Gateway (Phase 23). Every field here is deliberately generic — no
 * ChatGPT/Claude/VS Code/localhost/Owner-identity assumption anywhere.
 * `AgentAdapter` implementations (see ./adapters/) are the ONLY place a
 * provider-specific detail may live; this file, gateway.ts, and
 * memory-store.ts must never import a provider SDK.
 *
 * Input: none (pure type definitions).
 * Output: Task, Context, MemoryReference, Artifact, ExecutionRequest,
 * ExecutionResult, Evidence, Status, Capability, AgentAdapter.
 * Dependency ที่อนุญาต: none — leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field naming a specific AI provider, model,
 * or hard-coded path/identity. Never let this file import anything from
 * ./adapters/.
 */

export type Status = "RECEIVED" | "ROUTING" | "POLICY_CHECK" | "WAITING_OWNER_DECISION" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "FAILED" | "BLOCKED";

export interface WorkOrder {
  operation: "CREATE" | "MODIFY";
  target_type: "FILE";
  target_path: string;
  requested_change: string;
  content: string;
  workspace_scope: string;
  mode: "sandbox";
  required_tests: readonly ("sandbox.write" | "sandbox.readback")[];
  forbidden_files: readonly string[];
  evidence: readonly { source: string; note: string }[];
  /** Canonical Owner work identity when this order is part of an Owner command lifecycle. */
  work_order_id?: string;
  /**
   * Additive (Owner, "Authority Assembly Phase 1A — Unify Work Unit").
   * Present ONLY when this WorkOrder also describes real Agent Host work
   * (running a real AI runtime), never for a plain sandbox file write —
   * every existing FILE-write caller (ai-write-adapter, work-order-validator,
   * work-order-related tests) is completely unaffected by this field's
   * presence or absence. This is the ONE reconciliation point between
   * this type and control/agent-host/'s own AgentLaunchRequest — no third
   * work-unit representation was created.
   */
  agent_run?: AgentRunSpec;
}

/**
 * A provider-neutral run specification — `worker_kind` is a data VALUE
 * (CLAUDE/CODEX/GEMINI/LOCAL), never a branch in this file's own logic,
 * matching this file's own header rule ("never add a field naming a
 * specific AI provider... hard-coded path/identity" — the identity here
 * is a caller-supplied string value the Agent Gateway looks up in
 * control/agent-host/worker-registry.ts, not a literal path this file
 * names itself). Declared as a plain string union here (not imported
 * from control/agent-host/types.ts) to preserve this file's own
 * "Dependency ที่อนุญาต: none — leaf contract" rule.
 */
export interface AgentRunSpec {
  worker_kind: "CLAUDE" | "CODEX" | "GEMINI" | "LOCAL";
  instruction: string;
  /**
   * Real TaskWorkspace id (Owner, Phase 2 — "Agent Workspace
   * Architecture"), allocated by
   * `control/agent-gateway/workspace-manager.ts#createTaskWorkspace`.
   * When present, this is the ONLY source of truth for read/write scope
   * — `assigned_source_paths`/`workspace_path` below are ignored in
   * favor of the real `TaskWorkspace.allowed_read_paths`/
   * `allowed_write_workspace`. Optional only for backward compatibility
   * with callers that have not yet been migrated to WorkspaceManager.
   */
  workspace_id?: string;
  /** Real, absolute paths the Agent is assigned to read as its actual task source. Superseded by workspace_id when present. */
  assigned_source_paths: readonly string[];
  /** Real, absolute paths of runtime/library dependencies the worker needs beyond assigned source (e.g. node_modules). */
  dependency_read_paths: readonly string[];
  /** Real, absolute, temporary workspace path — never a real-source directory. Superseded by workspace_id when present. */
  workspace_path: string;
  timeout_ms: number;
  expected_result_contract: "DNA_OS_AGENT_RESULT_V1";
  /**
   * ENGINEERING coding scope only. When present, DNA OS — not the worker —
   * supplies allowed_write_paths from admitted coding paths. Omitted on
   * Business Runtime agent-host runs so their write scope is unchanged.
   */
  coding_write_paths?: readonly string[];
}

export interface MemoryReference {
  user_id: string;
  workspace_id: string;
  conversation_id: string;
  task_id: string;
  parent_task_id: string | null;
  created_at: string;
}

export interface Context {
  memory: MemoryReference;
  /** Real, already-persisted facts loaded BEFORE execution — never invented, never the raw chat transcript alone. */
  relevant_prior_evidence_ids: readonly string[];
  system_state_snapshot: Readonly<Record<string, unknown>>;
}

/**
 * SYSTEM_STATE = admitted via admitCompletedTask() — an already-decided,
 * synchronous outcome from control/command-router/, no Worker/Agent
 * involved. WORK_ITEM = admitted via submitTask()/dispatchTask() — real
 * work handed to an AgentAdapter, whose Result/Evidence always comes back
 * through this same gateway's Verify/Next Decision path. Optional only so
 * pre-existing Task fixtures built before this field existed keep
 * compiling — both real admission paths in ./gateway.ts always set it.
 * See ../../contracts/command/output-contract.ts for the parallel
 * synchronous-result shape this mirrors.
 */
export type TaskOutputLane = "SYSTEM_STATE" | "WORK_ITEM";

export interface Task {
  /**
   * The repo-relative paths this task will change, carried from admission all
   * the way to completion (Owner, 2026-08-26). Before this, only
   * `work_order.target_path` knew what a task touched and it never reached the
   * completion decision, so paths that complete through `persistStatus`
   * bypassed the UI render gate for lack of a change set — not because they
   * were exempt.
   *
   * `undefined` and `[]` mean different things and must stay different: a task
   * with NO work order changed no file through DNA OS at all, while an empty
   * declared list is a claim that can be checked.
   */
  affected_paths?: readonly string[];
  task_id: string;
  memory: MemoryReference;
  intent_text: string;
  submitted_by_client: string; // a generic client identifier the adapter supplies — never assumed to be a specific product
  status: Status;
  created_at: string;
  updated_at: string;
  work_order?: WorkOrder;
  /**
   * What the caller knew about WHERE this task should go, carried from
   * submission so a later decision resolves the same capability the first
   * one did. Without it, `ownerDecision` re-matched from the intent SENTENCE
   * alone and could land somewhere else than the original routing — the
   * capability would silently change between "received" and "approved".
   * Absent for every legacy caller, which then behaves exactly as before.
   */
  route_context?: {
    route_group?: string | null;
    target_capability_id?: string | null;
    target_capability_name?: string | null;
    event_type?: string | null;
    error_code?: string | null;
    work_id?: string | null;
    trace_id?: string | null;
    evidence_ref?: string | null;
    /**
     * ADDITIVE (Owner, CONNECT_NEW_AUTHORIZED_WRITE_FAILURE_TO_CANONICAL_AGENT_WORK
     * PHASE 3). ตัวตนของ "เหตุการณ์ต้นทาง" ที่ทำให้งานนี้ถูกสร้างขึ้นโดยอัตโนมัติ
     * เมื่อมีสองฟิลด์นี้ `submitTask` จะใช้มันเป็นแหล่งของ `idempotency_key`
     * แทนการ hash เนื้อ WorkOrder — เพราะกฎคือ "หนึ่งเหตุการณ์ต้นทาง สร้างงาน
     * ได้อย่างมากหนึ่งงาน" ซึ่งเนื้อ WorkOrder ตอบแทนไม่ได้
     *
     * ทุก caller เดิมไม่ส่งสองฟิลด์นี้ พฤติกรรมของพวกเขาจึงไม่เปลี่ยนเลย
     */
    source_event_type?: string | null;
    source_event_id?: string | null;
  };
  idempotency_key?: string;
  next_action?: string | null;
  output_lane?: TaskOutputLane;
}

export interface Capability {
  capability_id: string;
  problem_type: string;
  source: "capability_index.json" | "control/command-router" | string;
}

export interface ExecutionRequest {
  task_id: string;
  capability: Capability;
  adapter_id: string;
  input: Readonly<Record<string, unknown>>;
}

export interface Evidence {
  evidence_id: string;
  task_id: string;
  /** Owner/command correlation. Optional on historical rows; new producers set it. */
  correlation_id?: string;
  work_order_id?: string;
  kind: "policy_decision" | "execution_output" | "verification" | "owner_decision" | "capability_lookup" | "admission" | "recovery" | "idempotency" | "explain_resource_request" | "post_commit_check" | "post_commit_verification" | "runtime_discovery" | "build_execution" | "deployable_artifact_readiness" | "continuation" | "workspace_lifecycle" | "candidate_manifest" | "artifact_inspection" | "test_verification" | "security_verification" | "contract_verification" | "promotion_decision" | "candidate_verification";
  source: string;
  recorded_at: string;
  payload: unknown;
}

export interface Artifact {
  artifact_id: string;
  task_id: string;
  kind: string;
  reference: string; // a path/id, never inline secret content
}

export interface ExecutionResult {
  task_id: string;
  status: Status;
  output: unknown;
  evidence_ids: readonly string[];
  verified: boolean | null; // null = not yet verified
  next_action?: string | null;
}

/**
 * The ONE interface every provider must implement — ChatGPT-compatible,
 * Claude/Claude Code, a local CLI tool, a future provider. The gateway
 * core calls only this interface; it never knows or cares which real
 * implementation is behind it.
 */
export interface AgentAdapter {
  adapter_id: string;
  describe(): { adapter_id: string; capabilities: readonly string[] };
  execute(request: ExecutionRequest): Promise<{ output: unknown; ok: boolean; error?: string }>;
}

/** Structured, provider-neutral handoff shared by Codex, Claude Code, and Owner Console. */
export type HandoffStatus = "RECEIVED" | "IN_PROGRESS" | "VERIFIED" | "FAILED" | "BLOCKED";

/**
 * Owner rule (2026-08-20): no agent — Claude Code, Codex, or any future
 * provider — may certify its own work as final. `HandoffRecord.status`
 * above (including a "VERIFIED" claim) is always the SUBMITTING AGENT's
 * own self-report — evidence to be checked, never a verdict. This
 * separate field is the only place a final decision lives, and only
 * ../input-gateway... no: only `control/agent-gateway/handoff.ts`'s
 * `confirmDnaOsDecision` (called exclusively by DNA OS's own pipeline —
 * admission/validator/controller/regression gate, e.g.
 * `control/owner-command/input-gateway.ts`) may ever set this to
 * DNA_VERIFIED. `recordHandoff` itself NEVER promotes an agent's
 * "VERIFIED" self-report directly to DNA_VERIFIED — it always starts at
 * DNA_VALIDATING for that case.
 */
export type DnaOsDecision = "AGENT_SUBMITTED" | "DNA_VALIDATING" | "DNA_VERIFIED" | "DNA_FAILED" | "DNA_BLOCKED";

export interface HandoffRecord {
  handoff_id: string;
  task_id: string;
  agent_id: string;
  role: string;
  input_reference: string;
  files_read: readonly string[];
  files_changed: readonly string[];
  tests_run: readonly string[];
  status: HandoffStatus;
  evidence_refs: readonly string[];
  blockers: readonly string[];
  next_action: string | null;
  created_at: string;
  updated_at: string;
  /** Computed server-side only — never accepted as caller input (see HandoffInput, which has no such field). */
  dna_os_decision: DnaOsDecision;
  /**
   * References to whatever this delivery's contents were split into and
   * registered as, via ../work-result-ingress/. This handoff is evidence
   * that the delivery happened — the real resource_id/capability_id rows
   * are what the artifacts actually became, never this record itself.
   * Optional/empty for handoffs that predate work-result-ingress or that
   * genuinely split into zero artifacts (e.g. a pure status/blocker report).
   */
  registered_artifacts?: readonly { resource_type: string; resource_id: string | null; capability_id: string | null }[];
}
