/**
 * หน้าที่: the relationship that grants an Identity a role/scope inside an
 * Account, a Tenant, or a Workspace. The ONLY mechanism for "Identity X can
 * act as Account Y" — Identity itself never says this directly (see
 * identity.ts).
 *
 * Input: an Identity, a target scope (account/tenant/workspace) + role.
 * Output: `Membership`, `MembershipScopeType` — consumed by
 * scope-check.ts and contracts/command/, contracts/event/.
 * Dependency ที่อนุญาต: ./identity.ts (identity_id type shape only, not imported directly — kept as a plain string to avoid a circular contract).
 * สิ่งที่ห้ามแตะ: never delete a Membership row's history — revoke via
 * revoked_at, matching this whole repo's append-and-link discipline.
 *
 * NOT_YET_BUILT: no storage, no real Membership has ever been granted.
 */

export type MembershipScopeType = "account" | "tenant" | "workspace";

export interface Membership {
  membership_id: string;
  identity_id: string;
  scope_type: MembershipScopeType;
  scope_id: string; // an account_id, tenant_id, or workspace_id, depending on scope_type
  role: string; // scope-specific role/permission label — not enumerated here, real roles are NOT_YET_BUILT
  granted_at: string;
  revoked_at?: string;
}
