import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Real notification-count source for the finance icon's badge (owner,
// 2026-07-31): "มีรายการที่ต้องจัดการ...ให้เห็นว่ามีกี่รายการที่ต้อง
// จัดการ" — same real polling pattern as quotation-queue's pendingQuotesCount
// (app/admin/relationships/workspace.tsx), counting genuine unresolved
// company-payable items: partner_payable_requests still awaiting the
// owner's action (pending/owner_acknowledged — not yet paid), which now
// includes real automatically-detected Supabase billing invoices
// (supabase-billing-sync edge function) alongside the existing
// partner-material-purchase cascade — same real table, not a guessed count.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  const { count, error } = await db
    .from("partner_payable_requests")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "owner_acknowledged"])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pendingCount: count ?? 0 })
}
