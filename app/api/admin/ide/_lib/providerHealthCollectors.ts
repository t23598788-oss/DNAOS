/** Existing read-only provider/database collectors; uses the one Monitoring signal store. */
import { SIGNAL_TYPE_REGISTRY, type SignalType } from "./monitoringRegistry";
import { collectSignalWith, MonitoringError, type CollectResult, type MonitoringStatus, type SignalRecord } from "./monitoringSignals";


async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}


// Real system_health_status row shape — only the fields this file reads.
interface SystemHealthStatusRow {
  service_key: string;
  status: string;
  last_check_at: string | null;
  consecutive_failures: number;
}


// ── Real, read-only Supabase health table reader (DATABASE_HEALTH/CONNECTOR_HEALTH/EXTERNAL_PROVIDER_HEALTH) ──
async function readHealthRows(): Promise<SystemHealthStatusRow[] | null> {
  try {
    const mod = await import("@/services/supabase/queries");
    const db = mod.supabaseAdmin();
    const result = await withTimeout(db.from("system_health_status").select("*") as unknown as Promise<{ data: SystemHealthStatusRow[] | null; error: unknown }>, 8000, { data: null, error: new Error("timeout") });
    if (result.error || !result.data) return null;
    return result.data;
  } catch {
    return null;
  }
}


export async function collectDatabaseHealth(): Promise<CollectResult> {
  const rows = await readHealthRows();
  if (!rows) return { status: "UNKNOWN", severity: "INFO", reason: "could not read system_health_status (no credentials, network unreachable, or table missing) — honestly UNKNOWN, never assumed HEALTHY", normalizedValue: null, rawReference: "supabase table public.system_health_status", relatedProvider: "supabase" };
  const row = rows.find((r) => r.service_key === "supabase");
  if (!row) return { status: "UNKNOWN", severity: "INFO", reason: "no real row for service_key='supabase' — honestly UNKNOWN", normalizedValue: null, rawReference: "supabase table public.system_health_status", relatedProvider: "supabase" };
  const ageMs = row.last_check_at ? Date.now() - new Date(row.last_check_at).getTime() : Infinity;
  const staleAfter = SIGNAL_TYPE_REGISTRY.DATABASE_HEALTH.staleAfterMs!;
  if (ageMs > staleAfter) return { status: "STALE", severity: "MEDIUM", reason: `last real check was ${Math.round(ageMs / 60000)} min ago, exceeds staleAfter`, normalizedValue: row, rawReference: "supabase table public.system_health_status", relatedProvider: "supabase" };
  return {
    status: row.status === "degraded" ? "UNHEALTHY" : "HEALTHY", severity: row.status === "degraded" ? (row.consecutive_failures >= 2 ? "CRITICAL" : "MEDIUM") : "INFO",
    reason: row.status === "degraded" ? `real, consecutive_failures=${row.consecutive_failures}` : "real, last check healthy", normalizedValue: row, rawReference: "supabase table public.system_health_status", relatedProvider: "supabase",
  };
}


export async function collectConnectorHealth(): Promise<CollectResult> {
  const rows = await readHealthRows();
  if (!rows) return { status: "UNKNOWN", severity: "INFO", reason: "could not read system_health_status", normalizedValue: null, rawReference: "supabase table public.system_health_status" };
  const cronRows = rows.filter((r) => typeof r.service_key === "string" && r.service_key.startsWith("cron:"));
  if (cronRows.length === 0) return { status: "UNKNOWN", severity: "INFO", reason: "no real cron: rows found", normalizedValue: null, rawReference: "supabase table public.system_health_status" };
  const degraded = cronRows.filter((r) => r.status === "degraded");
  return {
    status: degraded.length === 0 ? "HEALTHY" : "DEGRADED", severity: degraded.length === 0 ? "INFO" : "MEDIUM",
    reason: degraded.length === 0 ? `all ${cronRows.length} real connector cron rows healthy` : `${degraded.length}/${cronRows.length} real connector(s) degraded: ${degraded.map((r) => r.service_key).join(", ")}`,
    normalizedValue: { total: cronRows.length, degraded: degraded.map((r) => r.service_key) }, rawReference: "supabase table public.system_health_status (service_key like 'cron:%')",
  };
}


export async function collectExternalProviderHealth(): Promise<CollectResult> {
  const rows = await readHealthRows();
  if (!rows) return { status: "UNKNOWN", severity: "INFO", reason: "could not read system_health_status", normalizedValue: null, rawReference: "supabase table public.system_health_status" };
  const providers = ["anthropic", "line_messaging", "gmail"];
  const relevant = rows.filter((r) => providers.includes(r.service_key));
  const missing = providers.filter((p) => !relevant.some((r) => r.service_key === p));
  const degraded = relevant.filter((r) => r.status === "degraded");
  const status: MonitoringStatus = missing.length === providers.length ? "UNKNOWN" : degraded.length > 0 ? "UNHEALTHY" : missing.length > 0 ? "DEGRADED" : "HEALTHY";
  return {
    status, severity: status === "UNHEALTHY" ? "HIGH" : status === "DEGRADED" ? "MEDIUM" : "INFO",
    reason: `${relevant.length}/${providers.length} real provider rows found; ${degraded.length} degraded; missing: ${missing.join(", ") || "none"}`,
    normalizedValue: { relevant, missing }, rawReference: "supabase table public.system_health_status", relatedProvider: providers.join(","),
  };
}
export function collectSignal(signalType: SignalType, ownerId: string, actor: string): Promise<SignalRecord> {
  const collector = signalType === "CONNECTOR_HEALTH" ? collectConnectorHealth : signalType === "EXTERNAL_PROVIDER_HEALTH" ? collectExternalProviderHealth : null;
  if (!collector) throw new MonitoringError("SIGNAL_TYPE_NOT_REGISTERED", `unsupported provider signal type: ${signalType}`);
  return collectSignalWith(signalType, ownerId, actor, collector);
}
