/**
 * หน้าที่: the ONE seam between this connector and wherever a real secret
 * actually lives. Owner, 2026-08-17: "Vault client does not exist yet.
 * Therefore define a CredentialProvider interface only." This file is
 * exactly that — an interface, plus zero real implementations. Production
 * code that eventually has a real Vault client implements this interface
 * elsewhere (NOT_YET_BUILT, NOT in this folder — a real Vault client is
 * its own capability, not something this connector folder should own);
 * tests in ./tests/adapter.test.ts implement it with an in-memory fake.
 *
 * Input: a `VaultReference` (from
 * ../../credentials/provider-accounts/digitalocean/credential-reference.ts
 * — a `vault://...` locator, never a secret).
 * Output: `CredentialResolution`.
 * Dependency ที่อนุญาต:
 * `../../credentials/provider-accounts/digitalocean/credential-reference.ts`
 * (type only).
 * สิ่งที่ห้ามแตะ: no implementation of this interface may live in this
 * file. No default/fallback implementation that reads an env var or any
 * other side channel — the whole point of this interface is that
 * ../digitalocean-adapter.ts never knows or cares HOW a secret is
 * resolved, only that resolving it can fail and must be checked.
 */

import type { VaultReference } from "../../credentials/provider-accounts/digitalocean/credential-reference";

export type CredentialResolution =
  | { ok: true; secret: string; credential_source: string }
  | { ok: false; reason: string };

export interface CredentialProvider {
  /**
   * Resolve one `VaultReference` to its real secret value. `credential_source`
   * on success MUST be safe to log/return (e.g. the reference's own `uri`) —
   * never derived from or containing `secret`.
   */
  resolve(reference: VaultReference): Promise<CredentialResolution>;
}
