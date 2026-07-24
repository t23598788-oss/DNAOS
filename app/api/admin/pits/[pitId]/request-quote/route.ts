import { NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { sendLineMessage } from "@/registry/communication"

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

  const { data: material, error: matErr } = await db
    .from("material_types").select("id, name").eq("id", materialTypeId).maybeSingle()
  if (matErr) return NextResponse.json({ error: matErr.message }, { status: 500 })
  if (!material) return NextResponse.json({ error: "ไม่พบวัสดุนี้" }, { status: 404 })

  const qtyText = quantity ? ` จำนวน ${quantity} คิว` : ""
  const message = `สวัสดีครับ ขอสอบถามราคา${material.name}${qtyText} ล่าสุดวันนี้เท่าไหร่ครับ (ตอบเป็นตัวเลขราคาต่อคิวได้เลยครับ)`

  const lineRes = await sendLineMessage(pit.line_user_id, [{ type: "text", text: message }])
  if (!lineRes.success) {
    return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}` }, { status: 502 })
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

  return NextResponse.json({ ok: true, request_id: request.id })
}
