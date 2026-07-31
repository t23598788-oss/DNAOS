import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"

// Approval queue for outbound LINE messages that carry real financial figures
// — see supabase/functions/line-webhook-v2/engines/relationship-qa.ts, which
// writes here instead of sending directly (owner instruction 2026-07-10,
// Rule 72: ยอดการเงินต้องผ่านการตรวจสอบเฮียก่อน).

export async function GET() {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const db = supabase()
  const { data, error } = await db
    .from("line_outbound_drafts")
    .select("id, line_user_id, company_id, reason, proposed_text, final_text, context, status, created_at, companies:company_id(name)")
    .order("created_at", { ascending: false })

  // Owner instruction (2026-07-30): a read/list endpoint must never crash the
  // whole page — if the DB can't answer, show an empty table, not a broken
  // screen. Logged server-side so the gap is still visible to us, just not
  // to the customer/admin's UI as a hard failure.
  if (error) {
    console.error("[outbound-drafts] list query failed:", error.message)
    return NextResponse.json({ drafts: [] })
  }
  return NextResponse.json({ drafts: data ?? [] })
}
