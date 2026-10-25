import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Equipment GPS/Relay — Maintenance Tickets admin surface (implemented
// 2026-08-04, per docs/equipment-maintenance-lock-module.md's "Maintenance
// ticket generation at 250h intervals" row). Extends the existing
// /admin/equipment page (Rule 101/103) rather than a separate page — same
// scope owner (fleet/equipment), same data model dependency
// (equipment_assets).
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  const { data, error } = await db
    .from("maintenance_tickets")
    .select("id, equipment_id, trigger_hours, status, opened_at, closed_at, closed_by, overdue_locked, overdue_locked_at, equipment_assets(asset_code, name, total_engine_hours, current_status)")
    .order("opened_at", { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tickets: data ?? [] })
}
