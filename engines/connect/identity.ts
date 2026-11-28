/**
 * Connect — canonical external identity (capability C, owner decision D4, 2026-09-23).
 *
 * ONE resolution contract for every runtime and every provider. Business code
 * asks "who is this external subject / which company is this?" here — it never
 * reads a provider-shaped table, and no provider name appears in any function
 * signature or column. The provider is a PARAMETER.
 *
 * Resolution reads public.connect_identity_current (the canonical read model
 * created by supabase/migrations/20260923000003_connect_external_identity.sql),
 * never public.line_profiles / public.company_line_links — those two are
 * marked HISTORICAL by that migration and are no longer a runtime authority.
 *
 * Writes go through linkExternalIdentity(): the canonical writer for external
 * identity, so there is exactly one place a mapping can be created or changed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** A resolved external identity: provider subject → canonical company/role. */
export interface ExternalIdentity {
  provider: string;
  externalSubjectId: string;
  companyId: string | null;
  companyName: string | null;
  companyTaxId: string | null;
  companyPhone: string | null;
  displayName: string | null;
  role: string | null;
  department: string | null;
  trustLevel: string | null;
  permissions: Record<string, unknown> | null;
}

const VIEW = "connect_identity_current";
const COLUMNS =
  "provider, external_subject_id, company_id, company_name, company_tax_id, company_phone, display_name, role, department, trust_level, permissions";

interface IdentityRow {
  provider: string;
  external_subject_id: string;
  company_id: string | null;
  company_name: string | null;
  company_tax_id: string | null;
  company_phone: string | null;
  display_name: string | null;
  role: string | null;
  department: string | null;
  trust_level: string | null;
  permissions: Record<string, unknown> | null;
}

function map(row: IdentityRow): ExternalIdentity {
  return {
    provider: row.provider,
    externalSubjectId: row.external_subject_id,
    companyId: row.company_id ?? null,
    companyName: row.company_name ?? null,
    companyTaxId: row.company_tax_id ?? null,
    companyPhone: row.company_phone ?? null,
    displayName: row.display_name ?? null,
    role: row.role ?? null,
    department: row.department ?? null,
    trustLevel: row.trust_level ?? null,
    permissions: row.permissions ?? null,
  };
}

/** Resolve one external subject (e.g. one messaging user id) — null when unknown. */
export async function resolveExternalIdentity(
  db: SupabaseClient,
  input: { provider: string; externalSubjectId: string },
): Promise<ExternalIdentity | null> {
  const { data, error } = await db
    .from(VIEW)
    .select(COLUMNS)
    .eq("provider", input.provider)
    .eq("external_subject_id", input.externalSubjectId)
    .maybeSingle();
  if (error || !data) return null;
  return map(data as IdentityRow);
}

/** Resolve many subjects in one round trip (list screens). */
export async function resolveExternalIdentities(
  db: SupabaseClient,
  input: { provider: string; externalSubjectIds: string[] },
): Promise<Map<string, ExternalIdentity>> {
  const out = new Map<string, ExternalIdentity>();
  if (input.externalSubjectIds.length === 0) return out;
  const { data, error } = await db
    .from(VIEW)
    .select(COLUMNS)
    .eq("provider", input.provider)
    .in("external_subject_id", input.externalSubjectIds);
  if (error || !data) return out;
  for (const row of data as IdentityRow[]) {
    const mapped = map(row);
    out.set(mapped.externalSubjectId, mapped);
  }
  return out;
}

/**
 * Subjects of one provider holding a canonical role — the provider-neutral form
 * of "who should be notified" (previously: a LINE-shaped query on line_profiles).
 */
export async function resolveProviderSubjectsByRole(
  db: SupabaseClient,
  input: { provider: string; role: string; limit?: number },
): Promise<string[]> {
  const { data, error } = await db
    .from(VIEW)
    .select("external_subject_id")
    .eq("provider", input.provider)
    .eq("role", input.role)
    .limit(input.limit ?? 1);
  if (error || !data) return [];
  return (data as { external_subject_id: string }[]).map((r) => r.external_subject_id);
}

/**
 * Provider subjects mapped to one canonical company — the provider-neutral form
 * of "which messaging users belong to this company". Optionally narrowed to one
 * or more roles.
 */
export async function resolveProviderSubjectsForCompany(
  db: SupabaseClient,
  input: { provider: string; companyId: string; roles?: string[] },
): Promise<string[]> {
  const base = db.from(VIEW).select("external_subject_id").eq("provider", input.provider).eq("company_id", input.companyId);
  const { data, error } = input.roles?.length ? await base.in("role", input.roles) : await base;
  if (error || !data) return [];
  return (data as { external_subject_id: string }[]).map((r) => r.external_subject_id);
}

/** Every identity of one provider (relationship/contact listing screens). */
export async function listProviderIdentities(
  db: SupabaseClient,
  input: { provider: string },
): Promise<ExternalIdentity[]> {
  const { data, error } = await db.from(VIEW).select(COLUMNS).eq("provider", input.provider);
  if (error || !data) return [];
  return (data as IdentityRow[]).map(map);
}

/** The canonical writer for external identity — the only place a mapping changes. */
export async function linkExternalIdentity(
  db: SupabaseClient,
  input: {
    provider: string;
    externalSubjectId: string;
    companyId?: string | null;
    displayName?: string | null;
    role?: string | null;
    department?: string | null;
    trustLevel?: string | null;
    notes?: string | null;
    permissions?: Record<string, unknown> | null;
    actor: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("connect_external_identities")
    .upsert(
      {
        provider: input.provider,
        external_subject_id: input.externalSubjectId,
        ...(input.companyId !== undefined ? { company_id: input.companyId } : {}),
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.department !== undefined ? { department: input.department } : {}),
        ...(input.trustLevel !== undefined ? { trust_level: input.trustLevel } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
        source: `connect:${input.actor}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,external_subject_id" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
