/**
 * หน้าที่: the canonical realtime Owner input/output contracts —
 * `OwnerCommandEnvelope` in, `SystemEvent` out. One command path, one event
 * path, for every present and future Owner interface (text, voice, UI,
 * LINE, local app, a future Owner AI).
 *
 * WHAT THIS IS NOT: not a task system, not a scheduler, not an event bus,
 * not a state database. Every one of those already exists and is reused —
 * `../owner-command/`, `../scheduler/`, `../work-resolution/`,
 * `../incident-remediation/`, `../work-continuation/`,
 * `../output-routing/`, `../../observability/joint-monitor/`. This folder
 * defines the two contracts they exchange and the gateway that connects
 * them.
 *
 * WHY A SEPARATE ENVELOPE FROM `contracts/command/command-envelope.ts`:
 * that one is `{ command_id, issued_by, intent, payload, issued_at }` — the
 * router's internal shape, with no notion of WHERE a command came from,
 * WHERE the answer goes, or WHICH existing work it continues. Those three
 * are exactly what a realtime Owner conversation needs. `OwnerCommandEnvelope`
 * carries them and is projected DOWN into the existing `CommandEnvelope` at
 * the boundary, so the router keeps its contract unchanged.
 *
 * Input: none (pure type definitions).
 * Output: every type below.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a field that carries an Agent's prose as
 * truth — `SystemEvent` fields are ids, states and evidence refs, and a
 * natural-language summary belongs to whatever renders the event, never to
 * the event itself. Never add an execution result field an interface could
 * set: results come from the capabilities that did the work.
 */

export type OwnerCommandSource = "TEXT" | "VOICE" | "OWNER_UI" | "LINE" | "LOCAL_APP" | "OWNER_AI";

export type OwnerCommandType =
  | "RUNTIME_OPERATION"
  | "CODE_CHANGE"
  | "INCIDENT_RESPONSE"
  | "OWNER_DECISION"
  | "QUERY";

/** Where the answer goes. The gateway never guesses this. */
export interface ReplyChannel {
  readonly kind: "SSE" | "LINE" | "UI" | "NONE";
  readonly address: string;
}

/**
 * THE one input contract. Every interface normalises into this; an AI may
 * translate natural language INTO it, and may never execute past it.
 */
export interface OwnerCommandEnvelope {
  readonly command_id: string;
  readonly owner_intent_id: string;
  readonly received_at: string;
  readonly source: OwnerCommandSource;
  readonly command_type: OwnerCommandType;
  /** What the Owner wants done, verbatim. Never an executable string. */
  readonly requested_action: string;
  /** Service id, resource id, capability name, or repo path — whatever the Owner named. */
  readonly target: string;
  readonly parameters: Readonly<Record<string, string>>;
  /** Set when this command CONTINUES existing work. This is what keeps a conversation on one work_id. */
  readonly work_id_if_existing: string | null;
  readonly incident_id_if_existing: string | null;
  readonly priority: "NORMAL" | "HIGH";
  readonly authority_context: { readonly identity_id: string; readonly kind: "human" };
  readonly reply_channel: ReplyChannel;
  readonly correlation_id: string;
}

/** §3's closed set of deterministic resolution outcomes. */
export type CommandResolution =
  | "EXECUTABLE_NOW"
  | "WAITING_FOR_DEPENDENCY"
  | "OWNER_DECISION_REQUIRED"
  | "UNRESOLVED_ARCHITECTURE"
  | "ALREADY_IN_PROGRESS"
  | "ALREADY_COMPLETED"
  | "BLOCKED";

/** The immediate, synchronous answer. Never waits for execution. */
export interface CommandAcknowledgement {
  readonly command_id: string;
  readonly work_id: string;
  readonly status: "RECEIVED";
  readonly current_phase: string;
  readonly next_expected_event: string;
  readonly persisted: true;
}

export type SystemEventType =
  | "COMMAND_RECEIVED"
  | "WORK_STARTED"
  | "DEPENDENCY_MISSING"
  | "AGENT_ALLOCATED"
  | "AGENT_FAILED"
  | "AGENT_FAILOVER"
  | "FILE_CHANGED"
  | "VERIFICATION_STARTED"
  | "VERIFICATION_FAILED"
  | "VERIFICATION_PASSED"
  | "DEPLOY_STARTED"
  | "DEPLOY_FAILED"
  | "SERVICE_HEALTHY"
  | "SERVICE_UNHEALTHY"
  /** An authorized recovery action was CHOSEN and is about to run. */
  | "REMEDIATION_STARTED"
  /** The recovery action ran. Says nothing about whether it worked — that is the verify step's answer. */
  | "SERVICE_RESTARTED"
  | "REMEDIATION_FAILED"
  | "INCIDENT_CREATED"
  | "INCIDENT_RESOLVED"
  | "OWNER_DECISION_REQUIRED"
  | "RESOURCE_UNAVAILABLE"
  /** An execution resource became usable again, from deterministic evidence — never from a trial launch. */
  | "RESOURCE_AVAILABLE"
  | "WORK_COMPLETED"
  | "WORK_BLOCKED"
  /** §3 — the SAME work_id waking after its dependency arrived. Never a new work_id. */
  | "WORK_RESUMED";

/**
 * THE one output contract. Ids, states and evidence — never prose as truth.
 * Every consumer (Owner UI, joint-monitor, LINE, a future Owner AI) reads
 * this SAME structure; no channel-specific business logic exists anywhere.
 */
export interface SystemEvent {
  readonly event_id: string;
  readonly command_id: string | null;
  readonly work_id: string | null;
  readonly incident_id: string | null;
  readonly event_type: SystemEventType;
  readonly state: string;
  /** Which capability produced this. Always a real module path. */
  readonly source: string;
  readonly resource_ids: readonly string[];
  readonly capability_ids: readonly string[];
  readonly evidence_refs: readonly string[];
  readonly observed_at: string;
  readonly next_action: string;
}

/** §13's read models. All derived from existing persistent stores. */
export interface WorkStateView {
  readonly work_id: string;
  readonly known: boolean;
  readonly resolution: CommandResolution | null;
  readonly latest_event: SystemEvent | null;
  readonly event_count: number;
  readonly commands: readonly string[];
  readonly detail: string;
}
