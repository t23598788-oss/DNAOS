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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ drafts: data ?? [] })
}
