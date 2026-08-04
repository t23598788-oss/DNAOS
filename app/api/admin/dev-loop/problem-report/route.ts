import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { supabaseAdmin } from "@/services/supabase/queries";

/** Read-only owner-alert surface for the existing Dev Loop dashboard. */
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await supabaseAdmin()
    .from("system_health_status")
    .select("service_key, status, detail, last_check_at, last_alert_at")
    .eq("service_key", "dna_os_dev_loop")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({
    report: data?.detail ?? null,
    status: data?.status ?? "healthy",
    last_check_at: data?.last_check_at ?? null,
    last_alert_at: data?.last_alert_at ?? null,
  });
}
