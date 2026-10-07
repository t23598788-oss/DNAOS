/**
 * หน้าที่: the two fail-closed gates Owner required — "Fail closed if
 * binding is expired/revoked/unverified" and "Fail closed if required
 * scope is missing" — both checked BEFORE any credential is resolved and
 * BEFORE any network call is made, same ordering discipline as
 * connections/github/github-adapter.ts's authorizeConnectionScope.
 *
 * Input: an `AccountCredentialBinding`, a required scope string (from
 * ./provider-action-lookup.ts).
 * Output: `AuthorizationOutcome`.
 * Dependency ที่อนุญาต:
 * `../../credentials/provider-accounts/digitalocean/status.ts`,
 * `../../credentials/provider-accounts/digitalocean/scope-policy.ts`
 * (both real, already-tested logic — this file does not re-implement
 * status/scope derivation, only applies the fail-closed decision on top
 * of it).
 * สิ่งที่ห้ามแตะ: never treat "expiring_soon" as a denial — Owner's rule
 * names exactly three states (expired/revoked/unverified); a binding that
 * is merely approaching expiry may still proceed. Never silently skip the
 * scope check when `required_scope === "not_confirmed"` — see the
 * conservative fallback below, chosen and documented, not omitted.
 */

import { deriveStatus } from "../../credentials/provider-accounts/digitalocean/status";
import { scopeSatisfies } from "../../credentials/provider-accounts/digitalocean/scope-policy";
import type { AccountCredentialBinding } from "../../credentials/provider-accounts/digitalocean/types";

export type AuthorizationOutcome = { ok: true } | { ok: false; reason: string };

const FAIL_CLOSED_STATUSES = new Set(["expired", "revoked", "unverified"]);

/** Owner's rule, applied exactly: expired/revoked/unverified => deny. active and expiring_soon => proceed. */
export function authorizeBindingStatus(binding: AccountCredentialBinding, now: Date = new Date()): AuthorizationOutcome {
  const status = deriveStatus(binding, now);
  if (FAIL_CLOSED_STATUSES.has(status)) {
    return { ok: false, reason: `binding status is "${status}" — refusing to proceed (fail-closed per Owner's rule: expired/revoked/unverified bindings are never used)` };
  }
  return { ok: true };
}

/**
 * When `../../providers/digitalocean/definition/actions.json`/`billing.json`
 * themselves recorded a scope as "not_confirmed" (DigitalOcean's own docs
 * did not state one), this connector requires the binding to hold
 * DigitalOcean's blanket read-alias scope instead of skipping the check —
 * a deliberate, conservative policy for an undocumented requirement, not
 * a guess at what the real scope string might be.
 */
const UNDOCUMENTED_SCOPE_FALLBACK = "api:read";

export function authorizeRequiredScope(binding: AccountCredentialBinding, required_scope: string): AuthorizationOutcome {
  const effectiveRequired = required_scope === "not_confirmed" ? UNDOCUMENTED_SCOPE_FALLBACK : required_scope;
  if (!scopeSatisfies({ granted_scopes: binding.scopes }, effectiveRequired)) {
    const undocumentedNote =
      required_scope === "not_confirmed"
        ? ` (DigitalOcean's own docs do not state a specific scope for this action, so this connector conservatively requires "${UNDOCUMENTED_SCOPE_FALLBACK}")`
        : "";
    return { ok: false, reason: `binding does not have the required scope "${effectiveRequired}"${undocumentedNote} — refusing to proceed (fail-closed)` };
  }
  return { ok: true };
}
