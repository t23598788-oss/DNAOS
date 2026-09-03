/**
 * หน้าที่: the ONE central event schema DNA OS sends to n8n, the routing
 * decision n8n sends back, and the dispatch/observability records the DNA OS
 * side produces. Pure types — no behaviour, no I/O.
 *
 * WHY A CENTRAL EVENT AND NOT A PER-SOURCE SHAPE: an Owner command, a process
 * crash, a cost anomaly and a verification failure are routed by the SAME
 * router. If each carried its own shape, the classifier would need a branch
 * per producer and every new producer would be a router change. One schema
 * means a new producer is a new emitter and nothing else.
 *
 * Input: none (pure type definitions).
 * Output: every type below.
 * Dependency ที่อนุญาต: none — a leaf contract.
 * สิ่งที่ห้ามแตะ: never add a field that could carry a secret or a full source
 * file. `payload` is for identifiers, counts and short reasons; anything that
 * would need redacting does not belong in an event that leaves this machine.
 * Never add a field that lets n8n name an agent — resolution is DNA OS's, and
 * a field for it would invite the router to guess one.
 */

/**
 * The ten routing groups now live in `contracts/command/route-group-capabilities.ts`
 * and are re-exported here so existing importers of this file are unaffected.
 * They moved because `control/agent-gateway/` needs the SAME definition and
 * the same per-group search order, and a second copy would let the router and
 * the gateway drift into disagreeing about who owns a failure.
 */
export type { RouteGroup } from "../../contracts/command/route-group-capabilities";
export { ROUTE_GROUPS } from "../../contracts/command/route-group-capabilities";
import type { RouteGroup } from "../../contracts/command/route-group-capabilities";

export type EventSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** THE central event. Every field the Owner named, plus the three anti-loop fields. */
export interface DnaOsCentralEvent {
  readonly event_id: string;
  readonly work_id: string | null;
  readonly trace_id: string;
  readonly owner_id: string;
  /** Which capability or interface emitted this. Never a free-text description. */
  readonly source: string;
  /** Dotted, lowercase, e.g. "runtime.process.crashed". A convention, never the only routing signal. */
  readonly event_type: string;
  readonly severity: EventSeverity;
  readonly status: string;
  /** Human-readable, and deliberately NOT used for classification — see the classifier's own comment. */
  readonly message: string;
  readonly capability_id: string | null;
  readonly resource_id: string | null;
  readonly error_code: string | null;
  readonly evidence_ref: string | null;
  readonly occurred_at: string;
  /** Identifiers, counts, short reasons. Never a secret, never a whole source file. */
  readonly payload: Readonly<Record<string, unknown>>;

  // --- anti-loop, required on every event ---
  readonly hop_count: number;
  /** Where this trace began. Preserved unchanged across every hop. */
  readonly origin: string;
}

export type RouteStatus =
  | "ROUTED"
  | "UNRESOLVED_OWNER"
  | "LOOP_DETECTED"
  | "REJECTED_MISSING_FIELDS"
  | "ROUTER_UNREACHABLE";

/** Exactly what the n8n workflow returns. Mirrors its real response, nothing invented. */
export interface RouterDecision {
  readonly accepted: boolean;
  readonly workflow_id: string;
  readonly received_event_id: string | null;
  readonly processed_at: string;
  readonly evidence_ref: string | null;
  readonly route_status: RouteStatus;
  readonly result: string;
  readonly route_group: RouteGroup | null;
  readonly classification_signal?: string;
  readonly classification_matched?: string | null;
  readonly trace_id?: string;
  readonly origin?: string | null;
  readonly hop_count_in?: number | null;
  readonly hop_count_out?: number | null;
  readonly max_hops?: number;
  readonly resolution_required_by?: string;
  readonly next_action?: string;
  readonly owner_decision_required?: boolean;
  readonly loop_reason?: string;
  readonly missing_fields?: readonly string[];
}

/** What DNA OS resolved, from ITS registries, after n8n named the group. */
export interface OwnerResolution {
  readonly route_group: RouteGroup | null;
  readonly capability_id: string | null;
  readonly capability_source: "command-router-registry" | "persistent-software-registry" | null;
  readonly capability_health: string | null;
  readonly permission_requirement: string | null;
  readonly agent_adapter_id: string | null;
  readonly agent_capabilities: readonly string[];
  readonly resolved: boolean;
  readonly reason: string;
  /** Every candidate considered and why it was or was not taken — a resolution with no audit trail is a guess. */
  readonly considered: readonly { capability_id: string; found: boolean; health: string | null; taken: boolean; note: string }[];
}

/** The Owner's required agent dispatch contract. */
export interface AgentDispatchOrder {
  readonly WORK_ID: string;
  readonly TASK_TYPE: RouteGroup;
  readonly TARGET_CAPABILITY: string;
  readonly INPUT_CONTRACT: Readonly<Record<string, unknown>>;
  readonly ALLOWED_ACTIONS: readonly string[];
  readonly FORBIDDEN_ACTIONS: readonly string[];
  readonly EVIDENCE_REQUIRED: readonly string[];
  readonly SUCCESS_CONDITION: string;
  readonly TIMEOUT_MS: number;
}

export interface AgentDispatchResult {
  readonly WORK_ID: string;
  readonly STATUS: string;
  readonly OUTPUT: unknown;
  readonly EVIDENCE_REFS: readonly string[];
  readonly ERROR_CODE: string | null;
  readonly NEXT_ACTION: string;
  readonly OWNER_DECISION_REQUIRED: boolean;
}

/** One observability record per hop, so Control Workspace can draw the real line. */
export interface HopRecord {
  readonly FROM: string;
  readonly TO: string;
  readonly EVENT_ID: string;
  readonly WORK_ID: string | null;
  readonly TRACE_ID: string;
  readonly START: string;
  readonly END: string;
  readonly DURATION_MS: number;
  readonly STATUS: string;
  readonly ERROR_CODE: string | null;
  readonly EVIDENCE_REF: string | null;
  readonly HOP_COUNT: number;
}

/** The error-trigger contract — every field the Owner required on an ERROR event. */
export interface ErrorTriggerContext {
  readonly error_code: string;
  /** The named boundary that actually failed, e.g. "control/runtime-adapter#spawnConfined". Never a guess. */
  readonly failed_boundary: string;
  readonly last_success: string | null;
  readonly last_evidence_ref: string | null;
  readonly retry_count: number;
  readonly severity: EventSeverity;
  readonly owner_decision_required: boolean;
}

export interface RoutedEventOutcome {
  readonly event: DnaOsCentralEvent;
  readonly decision: RouterDecision | null;
  readonly resolution: OwnerResolution;
  readonly order: AgentDispatchOrder | null;
  readonly dispatch: AgentDispatchResult | null;
  readonly hops: readonly HopRecord[];
  readonly route_status: RouteStatus;
  readonly evidence_ref: string;
}
