/**
 * หน้าที่: define Identity — the full principal record used for
 * registration/membership (distinct from
 * ../../contracts/identity/envelope-identity.ts's EnvelopeIdentity, which
 * is only the minimal wire-shape a request carries). One authenticated
 * principal: a human user, an AI agent, or an external program/service
 * credential.
 *
 * Input: none (pure type definition).
 * Output: `Identity` (re-exports `IdentityKind` from contracts/identity/
 * so this file stays the one-stop reference for identity concepts within
 * permissions/).
 * Dependency ที่อนุญาต: ../../contracts/identity/envelope-identity.ts
 * (IdentityKind only — permissions/ MAY depend on contracts/, never the
 * reverse).
 * สิ่งที่ห้ามแตะ: never add an account_id/tenant_id field directly to
 * Identity — that relationship belongs in membership.ts only. Never
 * redefine IdentityKind locally — always import it from contracts/identity/,
 * so there is exactly one definition.
 *
 * NOT_YET_BUILT: no real identity is issued/verified anywhere yet.
 */

import type { IdentityKind } from "../../contracts/identity/envelope-identity";

export type { IdentityKind };

export interface Identity {
  identity_id: string;
  kind: IdentityKind;
  display_name: string;
}
