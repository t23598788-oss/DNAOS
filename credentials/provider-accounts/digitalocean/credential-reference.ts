/**
 * หน้าที่: the ONE shape allowed for pointing at a real secret. Directly
 * extends the reference-only pattern already proven in
 * ../../../contracts/connector/connection.ts's `ConnectionRegistration.credential_ref`
 * (dna-os-deadboard TASK-172: the registry never holds a token, only where
 * to find one) — `VaultReference` here is the Vault-specific variant of
 * that same idea, for the case where the real store is Vault rather than
 * an env var. This file does not modify connection.ts; a future round
 * wiring ../../../connections/digitalocean/ into that generic contract
 * would add `{ kind: "vault_ref" } & VaultReference` to its
 * `credential_ref` union — not done yet, intentionally out of this
 * round's scope.
 *
 * Input: none (pure type + one validator).
 * Output: `VaultReference`.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never widen this type to allow an inline secret value
 * (a literal token string) in any field — `uri` must always be a
 * `vault://` locator, never the secret itself. Never read from or write
 * to an actual Vault here — that is the credential broker's job
 * (NOT_YET_BUILT, see Owner's stated flow: CREDENTIAL_BROKER -> VAULT),
 * strictly downstream of this type.
 */

export interface VaultReference {
  /** e.g. "vault://digitalocean/team-001/control-token" — Owner's own example format. Never a raw secret. */
  uri: string;
}

/** True only for a well-formed `vault://` locator — does not check that the path actually resolves to anything in Vault (this module has no Vault access). Guards against the one mistake this type exists to prevent: someone assigning a literal token string where a reference belongs. */
export function isVaultReference(value: unknown): value is VaultReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "uri" in value &&
    typeof (value as { uri: unknown }).uri === "string" &&
    (value as { uri: string }).uri.startsWith("vault://")
  );
}
