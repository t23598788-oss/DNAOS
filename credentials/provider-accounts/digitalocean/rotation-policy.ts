/**
 * หน้าที่: whether an expiring/expired binding can be refreshed without a
 * human re-pasting a token — directly the distinction Owner drew: OAuth
 * returns a refresh_token the system can use on its own (see
 * ../../../providers/digitalocean/definition/provider.json
 * auth_methods.oauth2.refresh_token_issued), a PAT does not (must be
 * manually reissued from the DigitalOcean Control Panel — see
 * auth_methods.pat.automatable_bootstrap: "PARTIAL"). This file encodes
 * that distinction as one small real rule, not a guess.
 *
 * Input: `RotationPolicy`.
 * Output: `boolean` (can this binding rotate itself).
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never claim a PAT-based binding can auto-rotate —
 * DigitalOcean's own docs (see provider.json) do not offer a PAT refresh
 * mechanism; only OAuth does.
 *
 * NOT_YET_BUILT: no actual refresh call exists yet — that belongs to the
 * credential broker, which does not exist yet either (Owner's flow:
 * CREDENTIAL_BROKER -> VAULT, downstream of ../../../connections/digitalocean/,
 * also NOT_YET_BUILT).
 */

import type { VaultReference } from "./credential-reference";

export type AuthMethod = "pat" | "oauth2" | "spaces_key" | "inference_bearer_auth";

export interface RotationPolicy {
  auth_method: AuthMethod;
  /** Present only for auth_method="oauth2" — the refresh_token's own Vault location, separate from the access token's. `undefined` for every other auth_method (they have no refresh mechanism to reference). */
  refresh_reference: VaultReference | undefined;
}

/** Only OAuth 2.0 (per DigitalOcean's own documented refresh_token issuance) can self-rotate. PAT, Spaces keys, and inference bearer tokens all require a human/manual reissue step today — see ../../../providers/digitalocean/definition/provider.json for the per-method evidence this rule is drawn from. */
export function canAutoRotate(policy: RotationPolicy): boolean {
  return policy.auth_method === "oauth2" && policy.refresh_reference !== undefined;
}
