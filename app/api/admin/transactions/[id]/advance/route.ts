import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getTransactionById } from "@/services/supabase/queries"
import { resolveTransition } from "@/engines/transactions/state-machine"

type Params = { params: Promise<{ id: string }> }

// สถานะจริงบน customer_orders คือ public."CustomerOrderStatus" — CANCELLED เป็น terminal branch
// แยกจาก linear steps ใน engines/transactions/workflows.ts (ดูคอมเมนต์ที่ไฟล์นั้น)
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const body = await req.json()
  const action: string = body.action
  const note: string | undefined = body.note

  const { data: order, error: orderErr } = await supabase()
    .from("customer_orders")
    .select("id, status, customer_company_id")
    .eq("id", id)
    .single()

  if (orderErr || !order) return NextResponse.json({ error: "ไม่พบ transaction" }, { status: 404 })

  if (action === "cancel") {
    if (order.status === "CANCELLED" || order.status === "PAID") {
      return NextResponse.json({ error: `ไม่สามารถยกเลิกจากสถานะ "${order.status}" ได้` }, { status: 422 })
    }
    const { error: cancelErr } = await supabase()
      .from("customer_orders")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("id", id)
    if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 })

    await supabase().from("audit_logs").insert({
      entity_type: "customer_order",
      entity_id: id,
      action: "cancel",
      field: "status",
      old_value: order.status,
      new_value: "CANCELLED",
    })

    const result = await getTransactionById(id)
    return NextResponse.json({ ...result, new_state: "CANCELLED" })
  }

  const transition = resolveTransition("sale", order.status, action)

  if (!transition) {
    return NextResponse.json(
      { error: `ไม่สามารถทำ "${action}" จากสถานะ "${order.status}" ได้` },
      { status: 422 }
    )
  }

  const { error: updateErr } = await supabase()
    .from("customer_orders")
    .update({ status: transition.to, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const { error: auditErr } = await supabase().from("audit_logs").insert({
    entity_type: "customer_order",
    entity_id: id,
    action,
    field: "status",
    old_value: order.status,
    new_value: note ? `${transition.to} — ${note}` : transition.to,
  })
  if (auditErr) console.error("[transactions/advance] audit log failed:", auditErr.message)

  const result = await getTransactionById(id)
  return NextResponse.json({ ...result, new_state: transition.to })
}
