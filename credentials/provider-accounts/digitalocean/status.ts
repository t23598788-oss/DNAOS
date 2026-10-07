/**
 * หน้าที่: the single place `AccountCredentialBinding.status` is computed
 * from — thin wrapper over ./expiry-policy.ts's `deriveBindingStatus` so
 * every caller building/refreshing a binding record derives STATUS the
 * same way, rather than each call site re-deriving it slightly
 * differently (or worse, hand-setting it and letting it drift from
 * EXPIRES_AT/REVOKED_AT/LAST_VERIFIED).
 *
 * Input: `AccountCredentialBinding` (only its expiry-relevant fields are
 * read).
 * Output: `BindingStatus`.
 * Dependency ที่อนุญาต: ./expiry-policy.ts (sibling file, this capability
 * folder only).
 * สิ่งที่ห้ามแตะ: never let this function read `scopes`/`token_reference`
 * — status is purely a function of time/revocation, not of what the
 * credential is allowed to do.
 */

import { deriveBindingStatus, type ExpiryPolicy } from "./expiry-policy";

export function deriveStatus(binding: ExpiryPolicy, now: Date = new Date()) {
  return deriveBindingStatus(binding, now);
}
