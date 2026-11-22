import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function GET() {
  const actor = await requireAuth(ADMIN_TIER);
  if (actor instanceof NextResponse) return actor;

  const db = supabaseAdmin();
  const now = new Date();
  const since24h = new Date(now.getTime() - DAY_MS).toISOString();
  const since1h = new Date(now.getTime() - HOUR_MS).toISOString();
  const nowIso = now.toISOString();

  const [total, succeeded, failed, processing, expired, recentExecutions, gatewayTotal, recentIngress, healthRows] = await Promise.all([
    db.from("core_event_results").select("id", { count: "exact", head: true }).gte("created_at", since24h),
    db.from("core_event_results").select("id", { count: "exact", head: true }).eq("status", "succeeded").gte("created_at", since24h),
    db.from("core_event_results").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24h),
    db.from("core_event_results").select("id", { count: "exact", head: true }).eq("status", "processing"),
    db.from("core_event_results").select("id", { count: "exact", head: true }).eq("status", "processing").lt("lease_until", nowIso),
    db.from("core_event_results").select("event_id,source,event_type,capability_id,status,attempt_count,error_code,created_at,processed_at").order("created_at", { ascending: false }).limit(25),
    db.from("integration_gateway_events").select("id", { count: "exact", head: true }).gte("received_at", since1h),
    db.from("integration_gateway_events").select("provider,capability,action,received_at").order("received_at", { ascending: false }).limit(25),
    db.from("system_health_status").select("service_key,status,consecutive_failures,last_check_at").order("last_check_at", { ascending: false }).limit(50),
  ]);

  const ledgerAvailable = !total.error && !succeeded.error && !failed.error && !processing.error && !expired.error && !recentExecutions.error;
  const gatewayAvailable = !gatewayTotal.error && !recentIngress.error;
  const healthAvailable = !healthRows.error;
  const stuckCount = expired.count ?? 0;
  const failedCount = failed.count ?? 0;
  const hasHealthFailure = (healthRows.data ?? []).some((row) => row.status === "degraded");
  const overall = stuckCount > 0 || failedCount > 0 || hasHealthFailure
      ? "attention"
      : !ledgerAvailable || !gatewayAvailable || !healthAvailable
        ? "unknown"
        : "unknown"; // Cloudflare queue depth/retry telemetry has no live source yet.

  return NextResponse.json({
    ok: true,
    snapshot: {
      observed_at: nowIso,
      overall,
      sources: {
        core_ledger: ledgerAvailable ? "available" : "unavailable",
        gateway_observation: gatewayAvailable ? "available" : "unavailable",
        health_checks: healthAvailable ? "available" : "unavailable",
        cloudflare_queue_depth: "not_instrumented",
      },
      metrics: {
        events_24h: total.count ?? null,
        succeeded_24h: succeeded.count ?? null,
        failed_24h: failed.error ? null : failedCount,
        processing_now: processing.count ?? null,
        expired_processing_leases: expired.error ? null : stuckCount,
        gateway_events_1h: gatewayTotal.count ?? null,
      },
      health_checks: (healthRows.data ?? []).map((row) => ({
        service_key: String(row.service_key),
        status: String(row.status),
        consecutive_failures: Number(row.consecutive_failures ?? 0),
        last_check_at: typeof row.last_check_at === "string" ? row.last_check_at : null,
      })),
      recent_executions: (recentExecutions.data ?? []).map((row) => ({
        event_id: String(row.event_id),
        source: String(row.source),
        event_type: String(row.event_type),
        capability_id: String(row.capability_id),
        status: String(row.status),
        attempt_count: Number(row.attempt_count ?? 0),
        error_code: typeof row.error_code === "string" ? row.error_code : null,
        created_at: String(row.created_at),
        processed_at: typeof row.processed_at === "string" ? row.processed_at : null,
      })),
      recent_ingress: (recentIngress.data ?? []).map((row) => ({
        provider: String(row.provider),
        capability: String(row.capability),
        action: String(row.action),
        received_at: String(row.received_at),
      })),
    },
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
