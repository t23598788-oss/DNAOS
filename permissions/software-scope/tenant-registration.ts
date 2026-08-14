/**
 * หน้าที่: the record that says a given Tenant has been registered/
 * provisioned — distinct from tenant.ts's Tenant, which only defines what
 * a Tenant IS.
 *
 * Input: a Tenant (see ./tenant.ts).
 * Output: `TenantRegistration`.
 * Dependency ที่อนุญาต: ./tenant.ts.
 * สิ่งที่ห้ามแตะ: source-code-level model only — no real database wired
 * to this file yet.
 *
 * NOT_YET_BUILT: "provisioned" status is aspirational — no real backend
 * exists for any tenant yet.
 */

import type { Tenant } from "./tenant";

export interface TenantRegistration {
  tenant: Tenant;
  status: "declared" | "provisioned";
}
