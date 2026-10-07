/**
 * หน้าที่: the record that says a given Account has been registered and
 * is active — distinct from account.ts's Account, which only defines what
 * an Account IS. Split out 2026-08-14 from account.ts for consistency
 * with identity.ts / identity-registry.ts's split (the template pattern
 * for every entity in this repo: type definition and its registration
 * record are always separate files).
 *
 * Input: an Account (see ./account.ts).
 * Output: `AccountRegistration`.
 * Dependency ที่อนุญาต: ./account.ts.
 * สิ่งที่ห้ามแตะ: source-code-level model only — no real database wired
 * to this file without an explicit Owner-approved migration step.
 *
 * NOT_YET_BUILT: no storage backend, no real Account has been registered.
 */

import type { Account } from "./account";

export interface AccountRegistration {
  account: Account;
  status: "pending" | "active" | "suspended" | "revoked";
  registered_at: string;
}
