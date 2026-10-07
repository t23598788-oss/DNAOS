/**
 * หน้าที่: the relationship "this Account holds/may use this resource" —
 * generic across resource kinds. A plain, flat grant (account_id +
 * resource_type + resource_id) rather than a separate join table per
 * resource type, since nothing here has a real use case yet for
 * resource-type-specific grant fields. This is the mechanism that keeps
 * Account from meaning "Business Domain" or "Software" directly (see
 * account.ts).
 *
 * Input: an Account, and either a BusinessDomain (./business-domain.ts)
 * or a Software (../../software/software-registry/software.ts).
 * Output: `GrantableResourceType`, `AccountResourceGrant`.
 * Dependency ที่อนุญาต: none directly (resource_id is a plain string
 * reference — resolving it to a real BusinessDomain/Software record is
 * the caller's job, not this file's).
 * สิ่งที่ห้ามแตะ: do not add resource-type-specific fields here — if a
 * resource type genuinely needs its own grant shape later, give it its
 * own type instead of widening this one.
 *
 * NOT_YET_BUILT: no real grant has ever been issued.
 */

export type GrantableResourceType = "business_domain" | "software";

export interface AccountResourceGrant {
  grant_id: string;
  account_id: string;
  resource_type: GrantableResourceType;
  resource_id: string; // a business_domain_id or software_id, depending on resource_type
  granted_at: string;
  revoked_at?: string;
}
