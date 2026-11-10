// Admin read route: list partner business profiles (name, phone, category,
// readiness) for the partner-profile screen. Read-only — no business writes.
import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth
  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied

  const db = supabase()
  const { data, error } = await db
    .from("partner_business_profiles")
    .select("id, business_category, readiness_status, pit_profiles(pit_name, registered_name, phone)")
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ profiles: [], error: error.message }, { status: 500 })

  const profiles = (data ?? []).map((p: any) => ({
    id: p.id,
    name: (Array.isArray(p.pit_profiles) ? p.pit_profiles[0] : p.pit_profiles)?.pit_name ?? (Array.isArray(p.pit_profiles) ? p.pit_profiles[0] : p.pit_profiles)?.registered_name ?? "ไม่ทราบชื่อ",
    phone: (Array.isArray(p.pit_profiles) ? p.pit_profiles[0] : p.pit_profiles)?.phone ?? null,
    business_category: p.business_category,
    readiness_status: p.readiness_status,
  }))

  return NextResponse.json({ profiles })
}
