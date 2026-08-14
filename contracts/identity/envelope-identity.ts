/**
 * หน้าที่: the Identity Contract — the wire-level shape of "who + acting
 * as what scope" that rides inside every CommandEnvelope and
 * EventEnvelope. Moved here 2026-08-14 (third correction pass) from
 * permissions/access-control/ specifically to break a two-way dependency:
 * contracts/ must never depend on permissions/ — permissions/ may depend
 * on contracts/, never the reverse. This file has ZERO imports, by
 * design, so it can sit at the bottom of the dependency graph.
 *
 * Input: none (pure type definitions).
 * Output: `IdentityKind`, `EnvelopeIdentity`.
 * Dependency ที่อนุญาต: none — this is a leaf contract with no outgoing
 * dependency to anything, including other contracts/ subfolders.
 * สิ่งที่ห้ามแตะ: never import from permissions/ here, or anywhere else
 * under contracts/ — that direction is exactly what this move exists to
 * forbid permanently. permissions/access-control/identity.ts imports
 * IdentityKind FROM here, not the other way around.
 *
 * NOT_YET_BUILT: nothing reads or validates this yet — see
 * ../../control/command-router/README.md.
 */

export type IdentityKind = "human" | "ai_agent" | "external_program" | "service";

/**
 * An Identity is not fixed to one Account (see
 * ../../permissions/access-control/membership.ts). A request still must
 * resolve to exactly ONE Account's scope, but that Account is whichever
 * one the caller is currently ACTING AS for this specific request — i.e.
 * a real Membership row (identity_id, scope_type="account",
 * scope_id=acting_as_account_id, revoked_at=null) must exist before the
 * controller may authorize this envelope. acting_as_tenant_id is resolved
 * server-side from that account's active AccountTenantAssignment, never
 * asserted by the caller.
 */
export interface EnvelopeIdentity {
  identity_id: string;
  acting_as_account_id: string; // which Membership's account scope this request is exercised under — verified, not trusted
  acting_as_tenant_id: string; // resolved server-side, not caller-asserted
  software_id: string;
  kind: IdentityKind;
}
