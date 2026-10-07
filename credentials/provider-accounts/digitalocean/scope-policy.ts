/**
 * หน้าที่: what SCOPES a binding actually holds, and whether that's
 * enough for a given required scope — the check
 * ../../../connections/digitalocean/ (NOT_YET_BUILT) will eventually run
 * before it lets any DNA OS action call a real DigitalOcean endpoint, per
 * Owner's own flow: PROVIDER_DEFINITION -> REQUIRED_ACTION ->
 * REQUIRED_SCOPES -> PERMISSION -> CREDENTIAL_BROKER. This file is the
 * scope-matching primitive that later step would call — it does not
 * itself decide permission (that is
 * ../../../permissions/execution-policy/'s job) and does not look up
 * which scope a DigitalOcean action needs (that is
 * ../../../providers/digitalocean/definition/actions.json's job).
 *
 * Input: `ScopePolicy`, a required scope string.
 * Output: `boolean` (satisfied or not).
 * Dependency ที่อนุญาต: none directly, but `granted_scopes` values are
 * expected to be real strings from
 * ../../../providers/digitalocean/definition/scopes.json's
 * confirmed_scopes/alias_scopes — never invented here.
 * สิ่งที่ห้ามแตะ: never auto-grant a scope not actually present on the
 * binding; alias-scope expansion (`api:read`/`api:write`) is the only
 * exception, and only because DigitalOcean's own docs define that
 * expansion (see scopes.json alias_scopes) — not a shortcut invented here.
 *
 * NOT_YET_BUILT: no persistence — this is the matching rule only.
 */

export interface ScopePolicy {
  /** Real DigitalOcean scope strings this binding actually holds, e.g. ["droplet:read", "droplet:create"] or ["api:write"]. Source of truth for what a real scope string looks like: ../../../providers/digitalocean/definition/scopes.json. */
  granted_scopes: readonly string[];
}

/** DigitalOcean's own two alias scopes (see scopes.json alias_scopes) — the only scope expansion this module performs; every other scope must match exactly. */
const FULL_ACCESS_SCOPE = "api:write";
const FULL_READ_SCOPE = "api:read";

/** True if `granted_scopes` covers `required_scope` — either an exact match, or one of DigitalOcean's two documented alias scopes (api:write covers everything; api:read covers any ":read" scope). */
export function scopeSatisfies(policy: ScopePolicy, required_scope: string): boolean {
  if (policy.granted_scopes.includes(FULL_ACCESS_SCOPE)) return true;
  if (policy.granted_scopes.includes(required_scope)) return true;
  if (policy.granted_scopes.includes(FULL_READ_SCOPE) && required_scope.endsWith(":read")) return true;
  return false;
}
