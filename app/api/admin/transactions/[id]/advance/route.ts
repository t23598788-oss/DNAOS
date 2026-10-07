import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, getTransactionById } from "@/services/supabase/queries"
import { resolveTransition } from "@/engines/transactions/state-machine"
import { changeTransactionStatus } from "@/engines/canonical/transaction-write"

type Params = { params: Promise<{ id: string }> }

// สถานะจริงบน customer_orders คือ public."CustomerOrderStatus" — CANCELLED เป็น terminal branch
// แยกจาก linear steps ใน engines/transactions/workflows.ts (ดูคอมเมนต์ที่ไฟล์นั้น)
//
// D1 cutover (owner 2026-09-25) — Transaction/Job status write = ONE CANONICAL WRITER:
// route นี้คง validation + state machine เดิมไว้ทุกอย่าง (resolveTransition +
// cancel guard) แต่พอได้ target status แล้ว ส่ง command เข้า
// engines/canonical/transaction-write.ts#changeTransactionStatus เท่านั้น —
// ไม่เหลือ direct `.from("customer_orders").update` และไม่เหลือ direct
// `audit_logs.insert` สำหรับ status transition ในไฟล์นี้ (canonical เขียน
// status + audit ครั้งเดียวต่อ request · negative control:
// scripts/transaction-status-authority.test.ts)
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
    // D1 — status + audit เดียวผ่าน canonical (guard/validation ด้านบนคงเดิม)
    try {
      await changeTransactionStatus({
        order_id: id,
        status: "CANCELLED",
        actor: auth.email,
        evidence: { action: "cancel", source: "advance", note: note ?? null },
      })
    } catch (e: unknown) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "เปลี่ยนสถานะธุรกรรมไม่สำเร็จ" }, { status: 500 })
    }

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

  // D1 — target มาจาก state machine เดิม (ห้ามคำนวณซ้ำใน canonical) ·
  // status write + canonical audit (transaction.status_changed) ครั้งเดียว
  try {
    await changeTransactionStatus({
      order_id: id,
      status: transition.to,
      actor: auth.email,
      evidence: {
        action,
        note: note ?? null,
        biz_event: transition.biz_event,
        label: transition.label,
        source: "advance",
      },
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "เปลี่ยนสถานะธุรกรรมไม่สำเร็จ" }, { status: 500 })
  }

  const result = await getTransactionById(id)
  return NextResponse.json({ ...result, new_state: transition.to })
}
