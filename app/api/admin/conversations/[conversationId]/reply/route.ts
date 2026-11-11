import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"
import { sendFacebookMessage } from "@/engines/communication/facebook-send"

type Params = { params: Promise<{ conversationId: string }> }

// Provider-neutral reply entry point that resolves the outbound channel from
// the central conversation's delivery routes instead of a provider-specific
// contact id. Currently LINE is the only wired provider; other providers can
// be added behind the same delivery-route contract.
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { conversationId } = await params
  const body = await req.json().catch(() => ({}))
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  const provider = typeof body?.provider === "string" && body.provider ? body.provider : "line"
  if (!text) return NextResponse.json({ error: "ข้อความว่างเปล่า" }, { status: 400 })

  const db = supabase()

  const { data: conversation, error: convErr } = await db
    .from("conversations")
    .select("id, channel_type, external_conversation_key")
    .eq("id", conversationId)
    .maybeSingle()
  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
  if (!conversation) return NextResponse.json({ error: "conversation not found" }, { status: 404 })

  const { data: route } = await db
    .from("conversation_delivery_routes")
    .select("recipient_external_id, last_reply_token, provider")
    .eq("conversation_id", conversationId)
    .eq("provider", provider)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!route?.recipient_external_id) {
    return NextResponse.json({ error: `no delivery route for provider ${provider}` }, { status: 404 })
  }

  const recipient = route.recipient_external_id as string

  let res: { success: boolean; messageId?: string; error?: string }
  if (provider === "facebook") {
    res = await sendFacebookMessage(recipient, text)
  } else {
    res = await sendLineMessage(db, recipient, [{ type: "text", text }])
  }
  if (!res.success) {
    return NextResponse.json({ error: res.error ?? "send failed" }, { status: 503 })
  }

  if (provider === "line") {
    const { error } = await db.from("line_events").insert({
      line_user_id: recipient,
      raw_type: "text",
      raw_text: text,
      status: "processed",
      direction: "out",
      line_message_id: res.messageId ?? null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, conversationId, provider, messageId: res.messageId ?? null })
}