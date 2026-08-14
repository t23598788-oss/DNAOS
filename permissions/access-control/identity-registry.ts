/**
 * หน้าที่: the record that says a given Identity has been registered and
 * is active — distinct from identity.ts's Identity, which only defines
 * what an Identity IS.
 *
 * Input: an Identity (see ./identity.ts).
 * Output: `IdentityRegistration`.
 * Dependency ที่อนุญาต: ./identity.ts.
 * สิ่งที่ห้ามแตะ: this is a source-code-level model only — do not wire a
 * real database to this file as part of any "just add persistence" change
 * without an explicit Owner-approved migration step.
 *
 * NOT_YET_BUILT: no storage backend, no real Identity has been registered.
 */

import type { Identity } from "./identity";

export interface IdentityRegistration {
  identity: Identity;
  status: "active" | "suspended" | "revoked";
  registered_at: string;
}
