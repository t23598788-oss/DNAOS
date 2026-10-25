import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { deliverBusinessResult, findRecentIdenticalOutbound } from "@/engines/delivery/result-delivery"
import { resolveExternalIdentity } from "@/engines/connect/identity"
import { normalizeSendResult } from "@/app/api/admin/ide/_lib/businessFailureBridge"
import { createHash } from "node:crypto"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner-reported gap 2026-07-11: this admin screen had no way to actually
// reply to a customer — only a draft-approval banner (which only appears
// when the bot already queued a draft) and an internal "ask AI" box that
// never sent anything to LINE at all. This is the missing "type and send
// directly" path.
//
// UNIFIED DELIVERY (owner directive ต่อจาก 24823b1, 2026-10-15): delivery
// goes through the ONE central Response Gateway (deliverBusinessResult —
// provider adapter + normalize/retry/idempotency/audit/live_commands มีใน
// engine เดิมทั้งหมด) — sender ตรงใน route ถูกถอดออก สัญญาเดิมที่ยังคุมไว้:
//   - Recipient = lineUserId จาก params (จอจะ list ผู้รับจาก row จริงเสมอ —
//     ไม่มีการพิมพ์/คาดเดา id) + ตรวจผ่าน Connect Identity (fail-closed เมื่อ
//     อ่านชั้น identity ไม่ได้)
//   - channel = sendLineMessage (push) เดิมเท่านั้น — engine default deps
//   - line_events out row เดิม (raw_type/raw_text/direction/line_message_id)
//   - 503 failure payload เดิม (normalized business language — ไม่มี raw error)
//   - กันข้อความเดียวกันซ้ำข้ามช่องทาง: line_events out dedupe precheck ตรงข้าม
//     (กับ bot replies ของ webhook v2 ที่เขียนแถวเดียวกัน) และ engine RESULT-ID
//     idempotency (สาย admin เดียวกัน 24 ชม.)

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  if (!text) return NextResponse.json({ error: "ข้อความว่างเปล่า" }, { status: 400 })

  // Recipient mapping ผ่าน Connect Identity เดิม — อ่านไม่ได้ = ปฏิเสธ (fail-closed)
  let identityMapped: boolean | null = null
  try {
    const identity = await resolveExternalIdentity(supabase(), { provider: "line", externalSubjectId: lineUserId })
    identityMapped = identity !== null
  } catch {
    return NextResponse.json({ error: "อ่านตาราง Connect Identity ไม่สำเร็จ — ปฏิเสธส่งเพื่อกัน mapping ผิด (fail-closed)" }, { status: 500 })
  }

  // กันข้อความเดียวกันซ้ำข้ามช่องทาง (bot reply ผ่าน webhook ก็เขียน line_events
  // ขาออกเหมือนกัน) — อ่านไม่ได้ = หยุด (fail-closed ตาม helper)
  try {
    const duplicated = await findRecentIdenticalOutbound(supabase(), lineUserId, text)
    if (duplicated) {
      return NextResponse.json(
        { ok: false, error: "ข้อความเดียวกันถูกส่งไปยังลูกค้าคนนี้เมื่อเร็ว ๆ นี้แล้ว (จากทุกช่องทาง) — ไม่ส่งซ้ำ" },
        { status: 409 },
      )
    }
  } catch {
    return NextResponse.json({ error: "อ่านประวัติการส่ง (line_events) ไม่สำเร็จ — ปฏิเสธส่งเพื่อกันส่งซ้ำ (fail-closed)" }, { status: 500 })
  }

  // resultKey สำหรับ engine idempotency — เนื้อเดียวกันกับ dedupe ข้างบน
  const resultKey = `reply:${lineUserId}:${createHash("sha256").update(text).digest("hex").slice(0, 32)}`

  // รักษา 503 payload เดิม (NormalizedBusinessResult ของ bridge เดิม) โดย
  // ไม่แตะ engine: normalizer เดิมของ route ถูก wrap — engine เรียกแทน แล้ว
  // route คืน object สุดท้ายพร้อมกันกับ ENGINE ยกเลิก retry ถ้าไม่ retryable
  let lastNormalized: Awaited<ReturnType<typeof normalizeSendResult>> | null = null
  const normalizer = (async (res: { success: boolean; error?: string }) => {
    lastNormalized = await normalizeSendResult(res, {
      providerSlug: "line",
      businessAction: "line.reply",
      ownerId: auth.id,
      actor: auth.email,
      source: "/api/admin/line-customers/[lineUserId]/reply",
    })
    return lastNormalized
  }) as never

  const delivery = await deliverBusinessResult(
    { lineUserId, replyText: text, resultKey, navigateUrl: null, workspace: null, authorize: async () => true },
    { db: supabase() as never, normalizer },
  )

  if (delivery.status !== "SENT") {
    if (delivery.status === "SKIPPED_DUPLICATE") {
      return NextResponse.json(
        { ok: false, error: "ข้อความเดียวกัน (รายการนี้) ส่งไปแล้วภายใน 24 ชม. — ไม่ส่งซ้ำ" },
        { status: 409 },
      )
    }
    // FAILED — สัญญาเดิม: normalized business result อย่างเดียว (raw error ถูกกลืนใน bridge เดิม)
    return NextResponse.json(lastNormalized ?? { ok: false, code: "SEND_FAILED", message: "ส่งไม่สำเร็จ", failureClass: delivery.failureClass ?? null, workId: null, incidentId: null }, { status: 503 })
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
    line_message_id: delivery.messageId ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, delivery: { status: delivery.status, message_id: delivery.messageId ?? null, attempts: delivery.attempts, identity_mapped: identityMapped } })
}
