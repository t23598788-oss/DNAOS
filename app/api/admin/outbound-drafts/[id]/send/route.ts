import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"

type Params = { params: Promise<{ id: string }> }

// The explicit human-confirmation click required by Rule 72 for this draft —
// เฮีย can edit the text before it goes out (body.text overrides proposed_text).
// Same LINE push call as app/api/admin/notifications/send/route.ts.

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const db = supabase()

  const { data: draft, error: fetchErr } = await db
    .from("line_outbound_drafts")
    .select("id, line_user_id, proposed_text, status")
    .eq("id", id)
    .maybeSingle()

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!draft) return NextResponse.json({ error: "ไม่พบร่างข้อความนี้" }, { status: 404 })
  if (draft.status !== "pending_review") return NextResponse.json({ error: "ร่างนี้ถูกดำเนินการไปแล้ว" }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const finalText = (typeof body?.text === "string" && body.text.trim()) || draft.proposed_text

  const res = await sendLineMessage(draft.line_user_id, [{ type: "text", text: finalText }])

  if (!res.success) {
    return NextResponse.json({ error: `LINE API ปฏิเสธ: ${(res.error ?? "").slice(0, 300)}` }, { status: 502 })
  }

  const { error: updErr } = await db
    .from("line_outbound_drafts")
    .update({ status: "sent", final_text: finalText, reviewed_at: new Date().toISOString(), sent_at: new Date().toISOString() })
    .eq("id", id)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
