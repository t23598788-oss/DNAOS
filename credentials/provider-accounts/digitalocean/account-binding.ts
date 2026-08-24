/**
 * หน้าที่: the identity half of one credential binding — which DNA OS
 * Account is paired with which real DigitalOcean Team. DigitalOcean's own
 * account model is Team-based (see ../../../providers/digitalocean/definition/provider.json
 * account_model), so this is deliberately account_id <-> team_id, never
 * account_id <-> "a DigitalOcean account" (no such flat concept exists on
 * DigitalOcean's side).
 *
 * Input: none (pure type).
 * Output: `AccountBinding`.
 * Dependency ที่อนุญาต: none (plain string ids; the real Account record
 * lives in ../../../permissions/software-scope/account-registry.ts and is
 * resolved by the caller, not re-implemented here).
 * สิ่งที่ห้ามแตะ: never add a field here that could hold a secret or a
 * capability grant — this file is identity/pairing only. Scopes live in
 * ./scope-policy.ts, credential material lives in ./credential-reference.ts.
 *
 * NOT_YET_BUILT: no registry/lookup function exists yet — this round is
 * type design only, per Owner's explicit instruction to stabilize this
 * shape before ../../../connections/digitalocean/ is built to consume it.
 */

export interface AccountBinding {
  /** This repo's own Account id — see ../../../permissions/software-scope/account-registry.ts AccountRecord.account_id. Must already be ACTIVE there before a binding referencing it is meaningful. */
  account_id: string;
  /** The real DigitalOcean Team id this account_id is bound to. One DNA OS account_id may have at most one binding per (digitalocean_team_id, auth_method) pair — see ./types.ts AccountCredentialBinding for the full composed record. */
  digitalocean_team_id: string;
}
