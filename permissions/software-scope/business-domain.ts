/**
 * หน้าที่: a REFERENCE to a business line/operating area (e.g. materials
 * sales, equipment/pit operations, debt & finance — dna-os-deadboard's
 * real factory_app_role/business_app_role split is live precedent that
 * domains like this genuinely exist there). Holds only an id + name —
 * never business content, never operational data.
 *
 * Input: none (pure type definition).
 * Output: `BusinessDomain`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add real business fields here (revenue, customer
 * counts, anything from the actual business database) — this type may
 * only ever be an identifying reference. The registration record is its
 * own file (business-domain-registration.ts).
 *
 * OPEN QUESTION, still not decided: the folder taxonomy has no dedicated
 * "business-domain-registry" folder the way it has software-registry/
 * repository-registry/workspace-registry/module-registry — only Software
 * is a first-class registrable resource there. Kept because deleting a
 * concept unilaterally is a bigger call than moving one, but the Owner
 * should decide whether Business Domain belongs in this repo's model at
 * all, or whether Infrastructure should only ever know about Software.
 *
 * NOT_YET_BUILT: no real Business Domain has been registered.
 */

export interface BusinessDomain {
  business_domain_id: string;
  name: string;
}
