import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [latestRun, recentRuns, recentInvoices, usageCount, blockedCount, recentUsage, catalogCount] = await Promise.all([
    db.from("do_billing_reconciliations").select("run_key,period_start,period_end,account_balance_usd,prepayment_balance_usd,prepayment_blocked,month_to_date_usage_usd,provider_insights_total_usd,gateway_estimated_cost_usd,variance_usd,status,detail,created_at,sku_insights")
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("do_billing_reconciliations").select("run_key,period_start,period_end,provider_insights_total_usd,gateway_estimated_cost_usd,variance_usd,status,created_at")
      .order("created_at", { ascending: false }).limit(7),
    db.from("do_billing_invoices").select("invoice_uuid,invoice_id,invoice_period,amount_usd,updated_at,is_preview,fetched_at,safe_summary")
      .order("fetched_at", { ascending: false }).limit(12),
    db.from("do_usage_events").select("id", { count: "exact", head: true }).gte("created_at", since),
    db.from("do_usage_events").select("id", { count: "exact", head: true }).eq("outcome", "blocked").gte("created_at", since),
    db.from("do_usage_events").select("request_id,operation,api_path,status_code,outcome,latency_ms,created_at,error_code")
      .order("created_at", { ascending: false }).limit(20),
    db.from("do_catalog").select("id", { count: "exact", head: true }),
  ]);
  const schemaReady = !latestRun.error && !recentRuns.error && !recentInvoices.error && !usageCount.error && !blockedCount.error && !recentUsage.error && !catalogCount.error;
  if (!schemaReady) return NextResponse.json({ ok: false, code: "DIGITALOCEAN_METER_SCHEMA_NOT_READY" }, { status: 503 });
  return NextResponse.json({
    ok: true,
    observed_at: new Date().toISOString(),
    metrics: { api_calls_24h: usageCount.count ?? 0, blocked_calls_24h: blockedCount.count ?? 0, catalog_rows: catalogCount.count ?? 0 },
    latest_reconciliation: latestRun.data ?? null,
    reconciliation_history: recentRuns.data ?? [],
    recent_invoices: recentInvoices.data ?? [],
    recent_usage: recentUsage.data ?? [],
    status_basis: "provider billing totals are daily aggregate SKU estimates; API usage events are gateway request telemetry and are not directly attributable to individual SKU charges",
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
