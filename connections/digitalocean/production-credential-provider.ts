/**
 * หน้าที่: the ONE real, production `CredentialProvider` implementation —
 * same honesty rule as `./production-binding-provider.ts`.
 * `./credential-provider.ts`'s own header states a real Vault client is
 * its own future capability, not something this folder should own. This
 * implementation always fails with a named reason — it is never actually
 * reached in production today, because `productionAccountBindingProvider`
 * already resolves `undefined` first (see `./digitalocean-adapter.ts`'s
 * fixed stage order: binding -> status -> scope -> credential). It exists
 * so the seam is complete and typed, not left as a `null!` placeholder.
 *
 * Input: a `VaultReference` (per `./credential-provider.ts`'s interface).
 * Output: `productionCredentialProvider` (always resolves `ok: false`
 * today).
 * Dependency ที่อนุญาต: ./credential-provider.ts (type only).
 * สิ่งที่ห้ามแตะ: never resolve a real secret here, never read an env var
 * as a side-channel fallback — see ./credential-provider.ts's own
 * สิ่งที่ห้ามแตะ, which this file inherits exactly.
 */

import type { CredentialProvider } from "./credential-provider";

export const productionCredentialProvider: CredentialProvider = {
  async resolve() {
    return { ok: false as const, reason: "VAULT_NOT_YET_BUILT: no real credential broker/Vault client exists in this repo yet" };
  },
};
