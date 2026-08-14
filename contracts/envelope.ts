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

/**
 * Corrected 2026-08-14 (second pass): an Identity is not fixed to one
 * Account (see identity-model.ts's Membership). A request still must
 * resolve to exactly ONE Account's scope, but that Account is whichever
 * one the caller is currently ACTING AS for this specific request — i.e.
 * a real Membership row (identity_id, scope_type="account",
 * scope_id=acting_as_account_id, revoked_at=null) must exist before the
 * controller may authorize this envelope. tenant_id is resolved from that
 * account's active AccountTenantAssignment, not asserted by the caller.
 */
interface EnvelopeIdentity {
  identity_id: string;
  acting_as_account_id: string; // which Membership's account scope this request is exercised under — verified, not trusted
  acting_as_tenant_id: string; // resolved server-side from AccountTenantAssignment for acting_as_account_id
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
