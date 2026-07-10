import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getTransactionById } from "@/services/supabase/queries"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  try {
    const result = await getTransactionById(id)
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ไม่พบ transaction" }, { status: 404 })
  }
}

// customer_orders ไม่มีคอลัมน์ title/net_amount (ไม่ใช่ตารางการเงิน — ยอดเงินคำนวณจาก invoices ที่ผูกอยู่)
// แก้ไขได้เฉพาะฟิลด์ที่มีจริงในตาราง
export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()
  const { delivery_note, requested_delivery_at } = body

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (delivery_note !== undefined) update.delivery_note = delivery_note
  if (requested_delivery_at !== undefined) update.requested_delivery_at = requested_delivery_at

  const { data, error } = await supabase()
    .from("customer_orders")
    .update(update)
    .eq("id", id)
    .select("id, order_no, status, delivery_note, requested_delivery_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ transaction: data })
}

// ไม่มีคอลัมน์ deleted_at บน customer_orders — "ลบ" = เปลี่ยนสถานะเป็น CANCELLED (ตรงกับที่
// app/api/admin/pulse/route.ts ใช้ CANCELLED เป็นสถานะปิดงานอยู่แล้ว)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const { error } = await supabase()
    .from("customer_orders")
    .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
