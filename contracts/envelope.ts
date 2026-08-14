/**
 * CommandEnvelope / EventEnvelope — the one object shape that legitimately
 * carries all five identity fields at once (see identity-model.ts's
 * closing note for why). Every request that crosses the system boundary
 * — from an external program, an AI agent, or DNA OS's own operational
 * system — arrives as one of these, or is rejected before anything else
 * happens.
 *
 * This is a type contract only. NOT_YET_BUILT: no controller reads or
 * validates this yet (see ../controller/README.md).
 */

import type { IdentityKind } from "./identity-model";

interface EnvelopeIdentity {
  identity_id: string;
  account_id: string;
  tenant_id: string;
  software_id: string;
  kind: IdentityKind;
}

/**
 * A Command — an external caller asking DNA OS's control system to DO
 * something (e.g. "sync this path," "register this connector"). Every
 * Command must resolve to exactly one Account's scope; a Command can never
 * name or affect a second Account's resources, by construction — there is
 * no field here for "target a different account."
 */
export interface CommandEnvelope<TPayload = unknown> {
  command_id: string; // this Command's own unique id — the 5th required field
  issued_by: EnvelopeIdentity;
  intent: string; // e.g. "connector.sync", "connector.register" — classified by the controller, not asserted by the caller
  payload: TPayload;
  issued_at: string;
}

/**
 * An Event — something that already happened, emitted back toward a
 * caller or toward the Operational system's own event stream. Same
 * ownership rule: an Event belongs to exactly one Account.
 */
export interface EventEnvelope<TData = unknown> {
  event_id: string;
  concerns: EnvelopeIdentity; // whose scope this event is about
  event_type: string; // e.g. "connector.sync.completed", "connector.status.changed"
  data: TData;
  occurred_at: string;
  caused_by_command_id?: string; // links back to the CommandEnvelope that caused this, when there is one
}

/**
 * The result of authorizing + routing an envelope. Never a bare boolean —
 * a denial always carries a reason, matching this codebase's own
 * no-silent-failure discipline.
 */
export type RoutingResult =
  | { ok: true; routed_to_adapter: string }
  | { ok: false; reason: string; denied_at_stage: "authenticate" | "authorize" | "classify" | "route" };
