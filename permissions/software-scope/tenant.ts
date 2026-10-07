/**
 * หน้าที่: define Tenant — the data-isolation boundary. Determines which
 * physical/logical partition (which database, schema, or adapter target)
 * an Account's data lives in.
 *
 * Input: none (pure type definition).
 * Output: `Tenant`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add an account_id field directly here — the
 * relationship to Account is its own file (account-tenant-assignment.ts),
 * kept separate so a group of Accounts can later share a Tenant, or one
 * Account's data can move to a different Tenant, without changing what a
 * Tenant means. The registration record is also its own file
 * (tenant-registration.ts).
 *
 * NOT_YET_BUILT: no real backend/database is assigned to any Tenant yet.
 */

export interface Tenant {
  tenant_id: string;
  display_name: string;
  data_residency_note?: string; // which real backend this tenant's data lives on — NOT_YET_BUILT
}
