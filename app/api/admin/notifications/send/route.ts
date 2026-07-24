/**
 * POST /api/admin/notifications/send — send a real LINE push message to a LINE userId.
 *
 * Same LINE Messaging API call as the already-deployed
 * supabase/functions/line-webhook-v2/engines/response.ts (pushMessages) — this route
 * exists because that Edge Function is triggered by inbound LINE webhooks, and there
 * was no path for the admin UI to trigger an outbound push directly. Reuses the same
 * real endpoint, same required credential (LINE_CHANNEL_ACCESS_TOKEN), not a second
 * notification system.
 *
 * Requires human confirmation at the UI level (see app/admin/notifications/page.tsx —
 * explicit "ส่ง" button, no auto-send) — matches the registry's own
 * capability_actions.communication.send_message.requires_confirmation: true.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"

async function logNotification(action: "sent" | "failed", detail: { to: string; note?: string }) {
  const { error } = await supabaseAdmin().from("audit_logs").insert({
    entity_type: "notification",
    entity_id: detail.to,
    action,
    field: "line_push",
    old_value: null,
    new_value: detail.note ?? null,
  })
  if (error) console.error("[notifications] audit log failed:", error.message)
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const to = typeof body?.to === "string" ? body.to.trim() : ""
  const message = typeof body?.message === "string" ? body.message.trim() : ""

  if (!to || !message) {
    return NextResponse.json({ error: "ต้องระบุ to (LINE userId) และ message" }, { status: 400 })
  }

  const res = await sendLineMessage(to, [{ type: "text", text: message }])

  if (!res.success) {
    await logNotification("failed", { to, note: res.error?.slice(0, 300) })
    return NextResponse.json({ error: `LINE API ปฏิเสธ: ${(res.error ?? "").slice(0, 300)}` }, { status: 502 })
  }

  await logNotification("sent", { to, note: message.slice(0, 200) })
  return NextResponse.json({ ok: true })
}
