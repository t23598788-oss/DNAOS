import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { deliverBusinessResult } from "@/engines/delivery/result-delivery"
import { resolveExternalIdentity } from "@/engines/connect/identity"

// Response Gateway กลาง (owner directive 2026-10-15, Result Delivery runtime
// integration): จุดสิ้นสุดงาน RFQ ส่งข้อความออกผ่าน deliverBusinessResult()
// เดียว — provider adapter เดิม (registry/communication.sendLineMessage),
// normalize/retry/idempotency/audit/live_commands เดิมของ engine กลาง
// (ห้าม sender คู่ขนานค่าอื่นใดอีก)

type Params = { params: Promise<{ pitId: string }> }

// Outbound Supplier RFQ (owner, 2026-07-24, Autonomous Supply Chain
// Orchestrator Step 3): the one, admin-confirmed send path asking a pit's
// real LINE contact for their current price on a material. Admin-triggered
// only (owner's explicit choice over auto-send) — matches Rule 72's pattern
// used everywhere else outbound (notifications/send, send-debt, reply).
// The reply itself is parsed by the LINE webhook (handlers/text.ts), which
// matches it back to the pit_price_requests row this creates.
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { pitId } = await params
  // Recipient Mapping ผ่าน Connect Identity (ห้ามกำหนด LINE User ID ขึ้นเอง):
  // ผู้รับ = pit.line_user_id ที่มีอยู่จริงจาก pit_profiles row (mapping ผูกผ่าน
  // LINE OA เดิมของระบบ — ไม่รับจาก request body) · ถ้าอ่านชั้น Connect
  // identity ไม่ได้ = ปฏิเสธ (fail-closed); ถ้ายังไม่มี row มิร์เรอร์ = ส่งต่อ
  // ตามสัญญาดิม (row mapping ผูกจริงใน pit_profiles + รายงานเป็น known gap)
  const resolveIdentity = async (lineUserId: string) => {
    try {
      return await resolveExternalIdentity(supabase(), { provider: "line", externalSubjectId: lineUserId })
    } catch {
      return "mapping-unreadable"
    }
  }
  const body = await req.json().catch(() => ({}))
  const materialTypeId = typeof body?.material_type_id === "string" ? body.material_type_id : ""
  const quantity = typeof body?.quantity === "number" ? body.quantity : null
  if (!materialTypeId) return NextResponse.json({ error: "ต้องระบุ material_type_id" }, { status: 400 })

  const db = supabase()

  const { data: pit, error: pitErr } = await db
    .from("pit_profiles")
    .select("id, pit_name, line_user_id, deleted_at")
    .eq("id", pitId)
    .maybeSingle()
  if (pitErr) return NextResponse.json({ error: pitErr.message }, { status: 500 })
  if (!pit) return NextResponse.json({ error: "ไม่พบบ่อ/แพล้นท์นี้" }, { status: 404 })
  if (pit.deleted_at) return NextResponse.json({ error: "บ่อ/แพล้นท์นี้ถูกปิดใช้งานแล้ว" }, { status: 400 })
  if (!pit.line_user_id) {
    return NextResponse.json({ error: "บ่อ/แพล้นท์นี้ยังไม่ได้เชื่อมบัญชี LINE — ส่งขอราคาอัตโนมัติไม่ได้" }, { status: 400 })
  }
  const mapped = await resolveIdentity(pit.line_user_id)
  if (mapped === "mapping-unreadable") {
    return NextResponse.json({ error: "อ่านตาราง Connect Identity ไม่สำเร็จ — ปฏิเสธส่งเพื่อกัน mapping ผิด (fail-closed)" }, { status: 500 })
  }

  const { data: material, error: matErr } = await db
    .from("material_types").select("id, name").eq("id", materialTypeId).maybeSingle()
  if (matErr) return NextResponse.json({ error: matErr.message }, { status: 500 })
  if (!material) return NextResponse.json({ error: "ไม่พบวัสดุนี้" }, { status: 404 })

  const qtyText = quantity ? ` จำนวน ${quantity} คิว` : ""
  const message = `สวัสดีครับ ขอสอบถามราคา${material.name}${qtyText} ล่าสุดวันนี้เท่าไหร่ครับ (ตอบเป็นตัวเลขราคาต่อคิวได้เลยครับ)`

  // resultKey = ตัวตนของผลลัพธ์ใช้กันส่งซ้ำ (idempotency engine กลาง):
  // ถามราคาวัสดุเดิมของบ่อเดิมในวันเดียวกัน = งานเดียวกัน ไม่ยิงข้อความซ้ำ
  const resultKey = `rfq:${pit.id}:${material.id}:${quantity ?? "na"}:${new Date().toISOString().slice(0, 10)}`
  const delivery = await deliverBusinessResult(
    {
      lineUserId: pit.line_user_id,
      replyText: message,
      resultKey,
      navigateUrl: null,
      workspace: null,
      // requireAuth(ADMIN_TIER) ผ่านแล้วล่างนี้ตัวเดียว — ไม่มี default-allow
      authorize: async () => true,
    },
    // deps เดิมทั้งหมด: engine default = sendLineMessage + normalizeSendResult + supabaseAdmin
    { db: db as never },
  )

  if (delivery.status === "SKIPPED_DUPLICATE") {
    return NextResponse.json(
      { ok: false, error: "ขอราคาวัสดุนี้จากบ่อนี้เมื่อเช้าวันนี้แล้ว — ไม่ส่งข้อความซ้ำ (ผลลัพธ์เดียว idempotency)" },
      { status: 409 },
    )
  }
  if (delivery.status !== "SENT") {
    return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${delivery.failureClass ?? "UNKNOWN"}` }, { status: 502 })
  }

  const { data: request, error: reqErr } = await db
    .from("pit_price_requests")
    .insert({
      pit_profile_id: pit.id,
      material_type_id: material.id,
      requested_quantity: quantity,
      line_user_id: pit.line_user_id,
      requested_by: auth.email,
      status: "pending",
    })
    .select("id")
    .single()
  if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, request_id: request.id, delivery: { status: delivery.status, message_id: delivery.messageId ?? null, attempts: delivery.attempts, identity_mapped: mapped !== null } })
}
