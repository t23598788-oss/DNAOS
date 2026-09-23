/**
 * Connect — external accounts / channels + credential accessor
 * (capability C, owner decision D4, 2026-09-23).
 *
 * Multi-storefront rule this file exists to satisfy: NO single environment
 * variable may be the identity/config authority for every channel. Each
 * external account (e.g. each LINE Official Account) resolves through its own
 * row of the canonical model, and its credential resolves through
 * public.connect_external_account_credentials(...) — one provider-neutral
 * accessor with no provider name or branch in it.
 *
 * Credential rules (hard):
 *   - the value never leaves the server: this module is used by server routes
 *     and the Deno edge only, never by a client component
 *   - the value is never stored in this model — connect_external_accounts
 *     carries credential_ref (a NAME), and the accessor follows it
 *   - the UI never receives it; provider settings screens read metadata only
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ExternalAccount {
  provider: string;
  externalAccountId: string;
  label: string | null;
  config: Record<string, unknown>;
  credentialRef: string | null;
}

/** Account metadata only — never a credential value. */
export async function resolveExternalAccount(
  db: SupabaseClient,
  input: { provider: string; externalAccountId: string },
): Promise<ExternalAccount | null> {
  const { data, error } = await db
    .from("connect_external_accounts")
    .select("provider, external_account_id, label, config, credential_ref")
    .eq("provider", input.provider)
    .eq("external_account_id", input.externalAccountId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    provider: String(row.provider),
    externalAccountId: String(row.external_account_id),
    label: (row.label as string) ?? null,
    config: (row.config as Record<string, unknown>) ?? {},
    credentialRef: (row.credential_ref as string) ?? null,
  };
}

export interface ExternalAccountCredential {
  provider: string;
  externalAccountId: string;
  label: string | null;
  config: Record<string, unknown>;
  /** Raw credential fields as named by credential_ref; null when unresolved. */
  credential: Record<string, string> | null;
  credentialResolved: boolean;
}

/**
 * The ONE way any runtime reads a provider credential. Delegates to the
 * canonical SQL accessor, so the credential's real location (provider config
 * table today, connector/Vault later) is never known to the caller.
 * Fail-closed by construction: an unknown account returns null; a dangling or
 * malformed credential_ref returns metadata with credentialResolved = false.
 */
export async function resolveExternalAccountCredential(
  db: SupabaseClient,
  input: { provider: string; externalAccountId: string },
): Promise<ExternalAccountCredential | null> {
  const { data, error } = await db.rpc("connect_external_account_credentials", {
    p_provider: input.provider,
    p_external_account_id: input.externalAccountId,
  });
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    provider: String(row.provider),
    externalAccountId: String(row.external_account_id),
    label: (row.label as string) ?? null,
    config: (row.config as Record<string, unknown>) ?? {},
    credential: (row.credential as Record<string, string>) ?? null,
    credentialResolved: row.credential_resolved === true,
  };
}
