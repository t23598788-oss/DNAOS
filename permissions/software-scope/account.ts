/**
 * หน้าที่: define Account — the ownership/responsibility unit. "Who owns
 * this data, who is responsible for it, who it's billed to (if billing
 * ever applies)." That is ALL Account means — it does NOT mean "a
 * business domain," "a piece of software," or "a workspace." Those are
 * separate resources an Account can hold (see resource-grant.ts).
 *
 * Input: none (pure type definition).
 * Output: `Account`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add a business_domain_id or software_id field
 * directly to Account — grant those via resource-grant.ts instead. Which
 * Identities can act for an Account is determined entirely by
 * ../access-control/membership.ts rows, never a field here. The
 * registered-and-active record is a separate file (account-registration.ts).
 *
 * NOT_YET_BUILT: no storage, no real Account has been registered.
 */

export interface Account {
  account_id: string;
  display_name: string;
  created_at: string;
}
