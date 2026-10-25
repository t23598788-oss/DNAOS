// Connect identity — Deno-side reader of the canonical model (capability C, 2026-09-23).
//
// Same contract as the Next-side resolver (engines/connect/identity.ts): the
// resolution itself lives in SQL (public.connect_identity_current), so both
// runtimes answer from ONE definition instead of duplicating logic. The Edge
// functions keep their own service-role client, so this is a direct read of the
// canonical read model — no provider-shaped table, no provider name in the API.
//
// Provider is a PARAMETER. LINE is simply the provider id this edge serves.
export interface ExternalIdentity {
  provider: string;
  externalSubjectId: string;
  companyId: string | null;
  companyName: string | null;
  companyTaxId: string | null;
  companyPhone: string | null;
  displayName: string | null;
  role: string | null;
  trustLevel: string | null;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = { from: (table: string) => any };

const COLUMNS =
  "provider, external_subject_id, company_id, company_name, company_tax_id, company_phone, display_name, role, trust_level";

// deno-lint-ignore no-explicit-any
function map(row: any): ExternalIdentity {
  return {
    provider: row.provider,
    externalSubjectId: row.external_subject_id,
    companyId: row.company_id ?? null,
    companyName: row.company_name ?? null,
    companyTaxId: row.company_tax_id ?? null,
    companyPhone: row.company_phone ?? null,
    displayName: row.display_name ?? null,
    role: row.role ?? null,
    trustLevel: row.trust_level ?? null,
  };
}

/** Resolve one provider subject — null when the canonical model has no row. */
export async function resolveExternalIdentity(
  supabase: SupabaseLike,
  provider: string,
  externalSubjectId: string,
): Promise<ExternalIdentity | null> {
  const { data } = await supabase
    .from("connect_identity_current")
    .select(COLUMNS)
    .eq("provider", provider)
    .eq("external_subject_id", externalSubjectId)
    .maybeSingle();
  return data ? map(data) : null;
}

/** Just the canonical company id — the shape most engines need. */
export async function resolveCompanyForSubject(
  supabase: SupabaseLike,
  provider: string,
  externalSubjectId: string,
): Promise<{ companyId: string; companyName: string | null } | null> {
  const identity = await resolveExternalIdentity(supabase, provider, externalSubjectId);
  if (!identity?.companyId) return null;
  return { companyId: identity.companyId, companyName: identity.companyName };
}

/**
 * Subjects of one provider holding a canonical role — the provider-neutral form
 * of "who do we notify" (previously a LINE-shaped line_profiles query).
 */
export async function resolveSubjectsByRole(
  supabase: SupabaseLike,
  provider: string,
  role: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("connect_identity_current")
    .select("external_subject_id")
    .eq("provider", provider)
    .eq("role", role)
    .limit(1);
  return (data ?? []).map((r: { external_subject_id: string }) => r.external_subject_id);
}

/** Every identity of one provider (relationship/contact listing screens). */
export async function listProviderIdentities(
  supabase: SupabaseLike,
  provider: string,
): Promise<ExternalIdentity[]> {
  const { data } = await supabase.from("connect_identity_current").select(COLUMNS).eq("provider", provider);
  return (data ?? []).map(map);
}

/** Provider subjects mapped to one canonical company (reverse lookup). */
export async function resolveSubjectsForCompany(
  supabase: SupabaseLike,
  provider: string,
  companyId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("connect_identity_current")
    .select("external_subject_id")
    .eq("provider", provider)
    .eq("company_id", companyId);
  return (data ?? []).map((r: { external_subject_id: string }) => r.external_subject_id);
}

/**
 * Provider account credential via the canonical accessor — the same SQL
 * function the Next runtime uses, so multi-account/channel config resolution is
 * decided once. Returns null (fail-closed) for an unknown account.
 */
export async function resolveAccountCredential(
  // deno-lint-ignore no-explicit-any
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => any },
  provider: string,
  externalAccountId: string,
): Promise<{ config: Record<string, unknown>; credential: Record<string, string> | null; credentialResolved: boolean } | null> {
  const { data, error } = await supabase.rpc("connect_external_account_credentials", {
    p_provider: provider,
    p_external_account_id: externalAccountId,
  });
  if (error || !data) return null;
  // deno-lint-ignore no-explicit-any
  const row = data as any;
  return {
    config: (row.config ?? {}) as Record<string, unknown>,
    credential: (row.credential ?? null) as Record<string, string> | null,
    credentialResolved: row.credential_resolved === true,
  };
}
