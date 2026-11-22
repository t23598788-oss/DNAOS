/**
 * Provider Credentials metadata layer — the shared read/write helpers behind
 * GET/PUT /api/admin/provider-settings and the rotate / request-approval /
 * destructive-gate routes (Connections & Credentials, 2026-09-24).
 *
 * Scope rules (enforced by construction, not by convention):
 *  - These helpers touch ONLY metadata tables (provider_credential_requirements,
 *    provider_connection_settings, provider_credential_events). Secret VALUES
 *    never pass through here — they live in the EXISTING Connect credential
 *    authority (public.connectors .secret jsonb, service-role-only RLS; Vault
 *    RPCs for the OAuth path) and travel only inside gateway/connectors
 *    updateConnector() calls made by the routes.
 *  - Migration not applied yet (tables missing) → reads fail OPEN to empty +
 *    migrated:false (honest UI banner) while the mutation-side approval gate
 *    fails CLOSED (unknown environment treated as production — see
 *    assertProviderMutationAllowed).
 *  - Audit: metadata-only changes log into provider_credential_events (actor =
 *    authenticated email). Credential mutations additionally log into
 *    audit_logs through core/connector-loader.logConnectorLifecycleEvent
 *    (actor_user_id = authenticated user id) — the routes own that call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RequirementRow {
  id: string;
  provider_id: string;
  credential_key: string;
  field_label: string;
  field_kind: "secret" | "text" | "readonly";
  required: boolean;
  is_secret: boolean;
  scope: string;
  applies_to: "any" | "local" | "staging" | "production";
  sort_order: number;
  help_text: string;
  status: "active" | "planned" | "retired";
}

export interface SettingsRow {
  provider_id: string;
  display_name: string;
  environment: "local" | "staging" | "production";
  sort_order: number | null;
  rotation_supported: boolean;
  verification_supported: boolean;
  credential_version: number;
  last_verified_at: string | null;
  last_test_status: "pass" | "fail" | null;
  last_rotated_at: string | null;
  connector_id: string | null;
}

export interface CredentialEventInput {
  provider_id: string;
  connector_id?: string | null;
  action: "save" | "rotate" | "rotate_failed" | "disconnect" | "settings_changed";
  field_keys?: string[];
  version?: number | null;
  detail?: Record<string, unknown>;
  actor?: string | null;
  result?: string;
}

export type MutationGate =
  | { allowed: true; environment: string; proposal_id?: string; proposal_status?: string }
  | { allowed: false; environment: string; proposal_id?: string; proposal_status?: string };

const ENVIRONMENTS = ["local", "staging", "production"] as const;
export function isEnvironment(v: unknown): v is SettingsRow["environment"] {
  return typeof v === "string" && (ENVIRONMENTS as readonly string[]).includes(v);
}

/** Missing-relation = migration not applied on THIS database (honest empty). */
function isMissingTable(err: unknown): boolean {
  // Plain-object PostgrestError (not an Error subclass) — read .message from
  // any shape + honor PGRST205 directly (same fix proven on the device pair
  // route's live probe,2026-09-25).
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "PGRST205") return true;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
  return /Could not find the table|relation .* does not exist|PGRST205|schema cache/i.test(msg);
}

export async function loadRequirements(db: SupabaseClient): Promise<{ rows: RequirementRow[]; migrated: boolean }> {
  try {
    const { data, error } = await db
      .from("provider_credential_requirements")
      .select("*")
      .order("provider_id", { ascending: true })
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as RequirementRow[], migrated: true };
  } catch (e) {
    if (isMissingTable(e)) return { rows: [], migrated: false };
    throw e;
  }
}

export async function loadSettings(db: SupabaseClient): Promise<{ rows: SettingsRow[]; migrated: boolean }> {
  try {
    // Order ALWAYS comes from the DB (sort_order, nulls last) — the UI never
    // hardcodes provider order (PHASE 9).
    const { data, error } = await db
      .from("provider_connection_settings")
      .select("*")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("provider_id", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as SettingsRow[], migrated: true };
  } catch (e) {
    if (isMissingTable(e)) return { rows: [], migrated: false };
    throw e;
  }
}

/** Latest credential events (metadata only) for the board's audit-status line. */
export async function loadRecentEvents(db: SupabaseClient, limit = 50): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await db
      .from("provider_credential_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

/**
 * Insert one credential-mutation/metadata event. Returns false (non-silently)
 * when the table is missing so the route can surface audit_written:false
 * instead of swallowing a lost audit row.
 */
export async function insertEvent(db: SupabaseClient, input: CredentialEventInput): Promise<boolean> {
  const { error } = await db.from("provider_credential_events").insert({
    provider_id: input.provider_id,
    connector_id: input.connector_id ?? null,
    action: input.action,
    field_keys: JSON.stringify(input.field_keys ?? []),
    version: input.version ?? null,
    detail: JSON.stringify(input.detail ?? {}),
    actor: input.actor ?? null,
    result: input.result ?? "ok",
  });
  if (error) {
    console.error(`[provider-credentials] event insert failed (${input.action}/${input.provider_id}): ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Create-or-update the metadata row for one provider. Throws
 * META_TABLES_MISSING when the migration has not been applied — mutations must
 * not pretend metadata was recorded when it was not.
 */
export async function upsertSettings(
  db: SupabaseClient,
  providerId: string,
  patch: Partial<Omit<SettingsRow, "provider_id">>
): Promise<SettingsRow> {
  const row: Record<string, unknown> = { provider_id: providerId, updated_at: new Date().toISOString() };
  for (const key of ["display_name", "environment", "sort_order", "connector_id", "credential_version", "last_verified_at", "last_test_status", "last_rotated_at"] as const) {
    if (patch[key] !== undefined) row[key] = patch[key];
  }
  const { data, error } = await db
    .from("provider_connection_settings")
    .upsert(row, { onConflict: "provider_id" })
    .select("*")
    .single();
  if (error) {
    if (isMissingTable(error)) {
      const e = new Error("ตาราง metadata ยังไม่ถูกสร้างบนฐานข้อมูลนี้ (รัน migration 20260924000001 ก่อน)") as Error & { code?: string };
      e.code = "META_TABLES_MISSING";
      throw e;
    }
    throw new Error(error.message);
  }
  return data as SettingsRow;
}

/**
 * Split a form submission {key: value} into the two existing jsonb targets
 * (config vs secret) using the registry rows — unknown keys are REFUSED, never
 * guessed, so the board can never become a raw jsonb injection surface.
 */
export async function splitFieldsByRequirements(
  db: SupabaseClient,
  providerId: string,
  fields: Record<string, unknown>
): Promise<{ config: Record<string, string>; secret: Record<string, string>; keys: { config: string[]; secret: string[] } }> {
  const { rows } = await loadRequirements(db);
  const providerRows = rows.filter((row) => row.provider_id === providerId);
  if (providerRows.length === 0) {
    const e = new Error("ไม่พบ requirement registry ของ provider นี้ (migration ยังไม่ถูก apply หรือยังไม่มี seed)") as Error & { code?: string };
    e.code = "REQUIREMENTS_MISSING";
    throw e;
  }
  // Credential names such as `token` are shared across providers. Never let a
  // requirement belonging to another provider authorize a write here.
  const byKey = new Map(providerRows.map((r) => [r.credential_key, r]));
  const config: Record<string, string> = {};
  const secret: Record<string, string> = {};
  const configKeys: string[] = [];
  const secretKeys: string[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    const req = byKey.get(key);
    if (!req || req.field_kind === "readonly") {
      const e = new Error(`credential_key ไม่อยู่ใน registry ของ ${providerId}: ${key}`) as Error & { code?: string };
      e.code = "UNKNOWN_CREDENTIAL_KEY";
      throw e;
    }
    if (raw === undefined || raw === null || String(raw).length === 0) continue; // empty = untouched, never clears a stored value
    const value = String(raw);
    if (req.is_secret || req.field_kind === "secret") {
      secret[key] = value;
      secretKeys.push(key);
    } else {
      config[key] = value;
      configKeys.push(key);
    }
  }
  return { config, secret, keys: { config: configKeys, secret: secretKeys } };
}

/**
 * Destructive-mutation gate (PHASE 10): disconnect / rotate on a production —
 * or unknown (fail-closed) — environment requires an APPROVED latest proposal
 * of the matching capability in the ONE existing proposal store, decided
 * through the ONE existing decide route. Non-production environments pass
 * straight through (still fully audited by the caller).
 */
export async function assertProviderMutationAllowed(
  db: SupabaseClient,
  providerId: string,
  kind: "rotate" | "disconnect"
): Promise<MutationGate> {
  const { getLatestProposal } = await import("@/engines/integration-gateway/evidence/proposalStore");
  const settings = await loadSettings(db);
  const row = settings.rows.find((r) => r.provider_id === providerId);
  // Missing table / no row / unknown environment = cannot prove it is NOT
  // production → fall into the approval path (the proposal store works
  // regardless of this migration).
  const environment = row?.environment ?? "production";
  if (settings.migrated && row && row.environment !== "production") {
    return { allowed: true, environment };
  }
  const latest = await getLatestProposal(db, providerId, `connector.${kind}.requested`);
  if (latest?.status === "approved") {
    return { allowed: true, environment, proposal_id: latest.id, proposal_status: latest.status };
  }
  return {
    allowed: false,
    environment,
    ...(latest ? { proposal_id: latest.id, proposal_status: latest.status } : {}),
  };
}

