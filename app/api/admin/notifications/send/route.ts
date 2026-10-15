/**
 * POST /api/admin/notifications/send — send a real LINE push message to a LINE userId.
 *
 * Same LINE Messaging API call as the already-deployed
 * supabase/functions/line-webhook-v2/engines/response.ts (pushMessages) — this route
 * exists because that Edge Function is triggered by inbound LINE webhooks, and there
 * was no path for the admin UI to trigger an outbound push directly. Reuses the same
 * real endpoint and the same canonical credential path (the "line" connector through
 * the connector lifecycle Run gate), not a second notification system.
 *
 * Requires human confirmation at the UI level (see app/admin/notifications/page.tsx —
 * explicit "ส่ง" button, no auto-send) — matches the registry's own
 * capability_actions.communication.send_message.requires_confirmation: true.
 *
 * UNIFIED DELIVERY (owner directive ต่อจาก 24823b1, 2026-10-15): ขั้นส่งเดินผ่าน
 * Response Gateway กลางเดียว (deliverBusinessResult) — sender ตรงใน route ถูกถอด
 * ออก; engine default deps = ช่องทาง sendLineMessage เดิม + normalizeSendResult
 * เดิม + audit_logs/live_commands เดิม (แถว audit เข็มเดียวกับทุกเส้นทางรวมส่ง —
 * ไม่ใช่แถว logNotification คู่ขนานเดิม) · idempotency 24 ชม. กัน UI ยิงซ้ำ
 * และ precheck line_events ขาออกกันข้อความเดียวกันข้ามช่องทาง (bot replies ด้วย)
 */

import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin } from "@/services/supabase/queries"
import { deliverBusinessResult, findRecentIdenticalOutbound } from "@/engines/delivery/result-delivery"
import { resolveExternalIdentity } from "@/engines/connect/identity"
import { normalizeSendResult } from "@/app/api/admin/ide/_lib/businessFailureBridge"
import { createHash } from "node:crypto"

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => null)
  const to = typeof body?.to === "string" ? body.to.trim() : ""
  const message = typeof body?.message === "string" ? body.message.trim() : ""

  if (!to || !message) {
    return NextResponse.json({ error: "ต้องระบุ to (LINE userId) และ message" }, { status: 400 })
  }

  // Recipient ใช้ to ที่เจ้าของกรอกเองเสมอ (ห้ามระบบคาดเดา/พิมพ์แทนนั้น) —
  // ว่าที่ถูกกรอกมีในชั้น Connect Identity หรือไม่ถูกอ่านรายงานไปจริง ๆ และ
  // อ่านชั้น identity ไม่ได้เลย = ปฏิเสธ (fail-closed, แบบเดียวกับเส้นทางรวมส่งอื่น)
  let identityMapped: boolean | null = null
  try {
    const identity = await resolveExternalIdentity(supabaseAdmin(), { provider: "line", externalSubjectId: to })
    identityMapped = identity !== null
  } catch {
    return NextResponse.json({ error: "อ่านตาราง Connect Identity ไม่สำเร็จ — ปฏิเสธส่งเพื่อกัน mapping ผิด (fail-closed)" }, { status: 500 })
  }

  // กันข้อความเดียวกันซ้ำข้ามช่องทาง (bot replies + admin push ทุกเส้นเขียน
  // line_events ขาออกเดิม) — อ่านไม่ได้ = หยุด (fail-closed)
  try {
    const duplicated = await findRecentIdenticalOutbound(supabaseAdmin(), to, message)
    if (duplicated) {
      return NextResponse.json(
        { ok: false, error: "ข้อความเดียวกันถูกส่งถึงผู้รับนี้เมื่อเร็ว ๆ นี้แล้ว (จากทุกช่องทาง) — ไม่ส่งซ้ำ" },
        { status: 409 },
      )
    }
  } catch {
    return NextResponse.json({ error: "อ่านประวัติการส่ง (line_events) ไม่สำเร็จ — ปฏิเสธส่งเพื่อกันส่งซ้ำ (fail-closed)" }, { status: 500 })
  }

  let lastNormalized: Awaited<ReturnType<typeof normalizeSendResult>> | null = null
  const normalizer = (async (res: { success: boolean; error?: string }) => {
    lastNormalized = await normalizeSendResult(res, {
      providerSlug: "line",
      businessAction: "line.send_notification",
      ownerId: auth.id,
      actor: auth.email,
      source: "/api/admin/notifications/send",
    })
    return lastNormalized
  }) as never

  const delivery = await deliverBusinessResult(
    {
      lineUserId: to,
      replyText: message,
      // idempotency: to + เนื้อข้อความเดิมใน 24 ชม. = งานเดียวกัน (UI กด "ส่ง" ซ้ำไม่ยิง provider ซ้ำ)
      resultKey: `notification:${to}:${createHash("sha256").update(message).digest("hex").slice(0, 32)}`,
      navigateUrl: null,
      workspace: null,
      authorize: async () => true,
    },
    { db: supabaseAdmin() as never, normalizer },
  )

  if (delivery.status !== "SENT") {
    if (delivery.status === "SKIPPED_DUPLICATE") {
      return NextResponse.json(
        { ok: false, error: "ข้อความเดิม (รายการนี้) ส่งไปแล้วภายใน 24 ชม. — ไม่ส่งซ้ำ" },
        { status: 409 },
      )
    }
    // FAILED — Business ได้ normalized result เท่านั้น (bridge เดิมกลืน raw error
    // ภายใน engine normalizer แล้ว; engine เขียนแถว audit failed ให้เอง)
    return NextResponse.json(lastNormalized ?? { ok: false, code: "SEND_FAILED", message: "ส่งไม่สำเร็จ", failureClass: delivery.failureClass ?? null, workId: null, incidentId: null }, { status: 503 })
  }

  return NextResponse.json({ ok: true, delivery: { status: delivery.status, message_id: delivery.messageId ?? null, attempts: delivery.attempts, identity_mapped: identityMapped } })
}
