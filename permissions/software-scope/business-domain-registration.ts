/**
 * หน้าที่: the record that says a given Business Domain reference has been
 * registered — distinct from business-domain.ts's BusinessDomain, which
 * only defines what it IS.
 *
 * Input: a BusinessDomain (see ./business-domain.ts).
 * Output: `BusinessDomainRegistration`.
 * Dependency ที่อนุญาต: ./business-domain.ts.
 * สิ่งที่ห้ามแตะ: same open question as business-domain.ts — this file's
 * existence is not a decision that Business Domain belongs in this repo
 * long-term.
 *
 * NOT_YET_BUILT: no real Business Domain has been registered.
 */

import type { BusinessDomain } from "./business-domain";

export interface BusinessDomainRegistration {
  business_domain: BusinessDomain;
  registered_at: string;
}
