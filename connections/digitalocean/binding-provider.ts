/**
 * หน้าที่: the seam between this connector and wherever an
 * `AccountCredentialBinding` actually lives. Mirrors ./credential-provider.ts's
 * reasoning: `../../credentials/provider-accounts/digitalocean/README.md`
 * says explicitly "no registry (create/get/list) exists yet" — so, same as
 * the Vault case, this connector depends only on an interface, never a
 * real store. This is an extension of Owner's stated CredentialProvider
 * principle, applied consistently to the OTHER not-yet-real dependency
 * this connector has, not a separate decision.
 *
 * Input: an `account_id` (this repo's own, from
 * `CommandEnvelope.issued_by.acting_as_account_id`), a
 * `digitalocean_team_id`, and an `auth_method`.
 * Output: `AccountCredentialBinding | undefined` (undefined = no such
 * binding is registered — a real, expected outcome, not an error).
 * Dependency ที่อนุญาต:
 * `../../credentials/provider-accounts/digitalocean/types.ts` (type only).
 * สิ่งที่ห้ามแตะ: no implementation of this interface may live in this
 * file — a real implementation (once a binding registry exists) belongs
 * in `credentials/provider-accounts/digitalocean/`, not here; tests in
 * ./tests/adapter.test.ts implement it with an in-memory fake.
 */

import type { AccountCredentialBinding, AuthMethod } from "../../credentials/provider-accounts/digitalocean/types";

export interface AccountBindingProvider {
  resolve(account_id: string, digitalocean_team_id: string, auth_method: AuthMethod): Promise<AccountCredentialBinding | undefined>;
}
