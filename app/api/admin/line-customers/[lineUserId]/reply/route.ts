import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"
import { normalizeSendResult } from "@/app/api/admin/ide/_lib/businessFailureBridge"

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

  const res = await sendLineMessage(supabase(), lineUserId, [{ type: "text", text }])

  // Business → Infrastructure failure bridge (owner, 2026-09-19): a
  // provider failure is routed through the existing infrastructure
  // pipeline (Signal → Incident → Remediation → Owner escalation) and
  // Business receives ONLY the normalized result — never raw provider
  // error text, never credential/runtime internals.
  const normalized = await normalizeSendResult(res, {
    providerSlug: "line",
    businessAction: "line.reply",
    ownerId: auth.id,
    actor: auth.email,
    source: "/api/admin/line-customers/[lineUserId]/reply",
  })
  if (!normalized.ok) {
    return NextResponse.json(normalized, { status: 503 })
  }

  const db = supabase()
  const { error } = await db.from("line_events").insert({
    line_user_id: lineUserId,
    raw_type: "text",
    raw_text: text,
    status: "processed",
    direction: "out",
    // Delivery evidence (mission 2026-10-10 §4): provider message id — the
    // admin reply is an out writer like every other (BATCH 38 shape).
    line_message_id: res.messageId ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
