/**
 * หน้าที่: the one composed record type this capability exists to define —
 * "which account uses which key," per Owner's own words. Composes
 * ./account-binding.ts (identity), ./credential-reference.ts (secret
 * location, never the secret), ./scope-policy.ts (what it's allowed to
 * do), ./expiry-policy.ts (is it still good), and ./rotation-policy.ts
 * (can it fix itself) into the exact 10-field record Owner specified:
 * ACCOUNT_ID, DIGITALOCEAN_TEAM_ID, AUTH_METHOD, TOKEN_REFERENCE, SCOPES,
 * EXPIRES_AT, REFRESH_REFERENCE, STATUS, LAST_VERIFIED, REVOKED_AT.
 *
 * One record = one credential grant for one (account_id,
 * digitalocean_team_id, auth_method) triple — an account may hold more
 * than one binding at once (e.g. a PAT binding for general API calls plus
 * a separate spaces_key binding), since DigitalOcean itself treats these
 * as genuinely separate credential systems (see
 * ../../../providers/digitalocean/definition/scopes.json
 * separate_credential_systems_not_scope_based).
 *
 * Input: none (pure type).
 * Output: `AccountCredentialBinding`.
 * Dependency ที่อนุญาต: ./account-binding.ts, ./credential-reference.ts,
 * ./scope-policy.ts, ./expiry-policy.ts, ./rotation-policy.ts (all
 * sibling files within this same capability folder — no cross-capability
 * import, per governance/architecture-rules/CAPABILITY_FOLDER_LAW.md
 * rule 9).
 * สิ่งที่ห้ามแตะ: this file must never gain a field holding a real secret
 * value — `token_reference`/`refresh_reference` are the only credential
 * material fields, and both are `VaultReference`-shaped (a `vault://`
 * locator) or explicitly absent, never a token string.
 *
 * NOT_YET_BUILT: no registry (create/get/list) exists yet for this
 * record type — Owner's instruction this round was type design only, to
 * stabilize this shape before ../../../connections/digitalocean/ is built
 * to consume it. See also ./status.ts for the one derived-field helper
 * this round does include (STATUS, computed from EXPIRES_AT/REVOKED_AT/
 * LAST_VERIFIED via ./expiry-policy.ts — never stored independently of
 * those three, to avoid the record disagreeing with itself).
 */

import type { AccountBinding } from "./account-binding";
import type { VaultReference } from "./credential-reference";
import type { ScopePolicy } from "./scope-policy";
import type { ExpiryPolicy, BindingStatus } from "./expiry-policy";
import type { AuthMethod, RotationPolicy } from "./rotation-policy";

export type { AuthMethod, BindingStatus, VaultReference };

export interface AccountCredentialBinding extends AccountBinding, ExpiryPolicy {
  /** Which of DigitalOcean's real, distinct credential systems this binding is for — see ../../../providers/digitalocean/definition/provider.json auth_methods. */
  auth_method: AuthMethod;
  /** Where the real access token/key lives in Vault — never the token itself. `undefined` only for a binding record created before bootstrap (e.g. reserved for an account whose human-driven PAT creation, per provider.json auth_methods.pat.automatable_bootstrap:"PARTIAL", hasn't happened yet). */
  token_reference: VaultReference | undefined;
  /** Real DigitalOcean scope strings this binding actually holds — see ./scope-policy.ts. */
  scopes: ScopePolicy["granted_scopes"];
  /** Present only when auth_method="oauth2" — see ./rotation-policy.ts for why every other auth_method leaves this undefined. */
  refresh_reference: RotationPolicy["refresh_reference"];
  /** Always derived via ./status.ts's deriveStatus(), never hand-set independently — see that file's header for why. */
  status: BindingStatus;
}
