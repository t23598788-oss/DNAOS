/**
 * หน้าที่: whether a binding's credential is still usable, purely from
 * its own recorded timestamps — EXPIRES_AT, REVOKED_AT, LAST_VERIFIED.
 * This is the honest-status half of a binding; ./rotation-policy.ts is
 * the separate question of whether an expiring binding can fix itself
 * automatically.
 *
 * Input: `ExpiryPolicy`, the current time.
 * Output: `BindingStatus`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never treat a missing/undefined `expires_at` as
 * "never expires" without saying so explicitly — DigitalOcean PATs are
 * user-configurable and may genuinely have no expiry (see
 * ../../../providers/digitalocean/definition/provider.json auth_methods.pat),
 * so `expires_at: undefined` is a real, valid state here, not a gap.
 *
 * NOT_YET_BUILT: no scheduled re-verification job exists yet — this file
 * only computes status from timestamps already recorded on the binding.
 */

export type BindingStatus = "active" | "expiring_soon" | "expired" | "revoked" | "unverified";

export interface ExpiryPolicy {
  /** ISO 8601. `undefined` = no expiry was set (a real, valid DigitalOcean PAT state — never assume this means "unknown"). */
  expires_at: string | undefined;
  /** ISO 8601. Set the moment this binding is deliberately revoked (token deleted, access pulled) — distinct from natural expiry. */
  revoked_at: string | undefined;
  /** ISO 8601. Last time this binding was actually exercised against a real DigitalOcean call and confirmed to still work — `undefined` means it has never been verified since being recorded. */
  last_verified: string | undefined;
}

/** How far before `expires_at` a binding is flagged "expiring_soon" rather than still flatly "active" — gives a credential broker (NOT_YET_BUILT) a window to trigger rotation before a real call fails. */
const EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Pure function: derives current status from a binding's own recorded timestamps. `revoked_at` always wins (a revoked binding is never "active" again regardless of expires_at). An unset `last_verified` on an otherwise-live binding is reported "unverified", not silently treated as "active" — a binding this module has never actually confirmed still works should read that way to any caller. */
export function deriveBindingStatus(policy: ExpiryPolicy, now: Date = new Date()): BindingStatus {
  if (policy.revoked_at !== undefined) return "revoked";
  if (policy.expires_at !== undefined) {
    const expiresAtMs = new Date(policy.expires_at).getTime();
    const nowMs = now.getTime();
    if (nowMs >= expiresAtMs) return "expired";
    if (expiresAtMs - nowMs <= EXPIRING_SOON_WINDOW_MS) return "expiring_soon";
  }
  if (policy.last_verified === undefined) return "unverified";
  return "active";
}
