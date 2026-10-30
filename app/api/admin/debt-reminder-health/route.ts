import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { getDebtReminderHealth } from "@/services/debt/reminder-health"

// Debt Reminder delivery health (M025) — the operator's answer to "did anything
// fail to leave the building?". Reads the existing line_events out rows; there
// is no second audit store and no delivery claim beyond PROVIDER_ACCEPTED.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const windowHours = Number(req.nextUrl.searchParams.get("windowHours") ?? "24")
  const stuckMinutes = Number(req.nextUrl.searchParams.get("stuckMinutes") ?? "15")

  try {
    const health = await getDebtReminderHealth(supabase(), {
      windowHours: Number.isFinite(windowHours) && windowHours > 0 ? windowHours : 24,
      stuckMinutes: Number.isFinite(stuckMinutes) && stuckMinutes > 0 ? stuckMinutes : 15,
    })
    return NextResponse.json(health)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
