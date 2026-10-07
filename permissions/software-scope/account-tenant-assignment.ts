/**
 * หน้าที่: the explicit relationship "this Account's data lives in this
 * Tenant" — kept as its own record, not a field on Account or Tenant, per
 * Owner instruction (2026-08-14, point 3): Account/Tenant/Workspace is an
 * expandable relationship, not a hardcoded 1:1 assumption.
 *
 * Today's real operating assumption (not a type-level constraint): each
 * Account resolves to exactly one ACTIVE assignment at a time — the
 * simplest thing that could work, with zero speculative multi-tenant
 * resolution logic built for a use case that doesn't exist yet. The type
 * itself does not forbid an Account having multiple assignments over time
 * (history is kept via ended_at); it just doesn't build machinery for "an
 * Account active in two Tenants at once" before that's a real requirement.
 *
 * Input: an Account (./account.ts) and a Tenant (./tenant.ts).
 * Output: `AccountTenantAssignment`.
 * Dependency ที่อนุญาต: none (account_id/tenant_id are plain string
 * references, resolved by the caller).
 * สิ่งที่ห้ามแตะ: do not build multi-tenant resolution logic here without
 * a real use case driving it.
 *
 * NOT_YET_BUILT: no real assignment has ever been made.
 */

export interface AccountTenantAssignment {
  account_id: string;
  tenant_id: string;
  assigned_at: string;
  ended_at?: string;
}
