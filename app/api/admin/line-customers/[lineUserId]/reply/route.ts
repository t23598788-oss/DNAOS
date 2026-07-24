import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner-reported gap 2026-07-11: this admin screen had no way to actually
// reply to a customer — only a draft-approval banner (which only appears
// when the bot already queued a draft) and an internal "ask AI" box that
// never sent anything to LINE at all. This is the missing "type and send
// directly" path. Same LINE push call as
// app/api/admin/outbound-drafts/[id]/send/route.ts, logged to line_events
// with direction:'out' so it shows up in the real thread immediately (same
// column response.ts's logOutboundToDb() writes for the bot's own replies).

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!text) return NextResponse.json({ error: "ข้อความว่างเปล่า" }, { status: 400 })

  const res = await sendLineMessage(lineUserId, [{ type: "text", text }])

  if (!res.success) {
    return NextResponse.json({ error: `LINE API ปฏิเสธ: ${(res.error ?? "").slice(0, 300)}` }, { status: 502 })
  }

  const db = supabase()
  const { error } = await db.from("line_events").insert({
    line_user_id: lineUserId,
    raw_type: "text",
    raw_text: text,
    status: "processed",
    direction: "out",
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
