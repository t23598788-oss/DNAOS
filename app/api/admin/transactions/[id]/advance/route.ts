import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"
import { resolveTransition } from "@/lib/transactions/state-machine"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const action: string = body.action
  const note: string | undefined = body.note

  // ดึง transaction ปัจจุบัน
  const { data: tx, error: txErr } = await supabase()
    .from("transactions")
    .select("id, tx_type, state, partner_id, net_amount, paid_amount, title")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (txErr || !tx) return NextResponse.json({ error: "ไม่พบ transaction" }, { status: 404 })

  const transition = resolveTransition(tx.tx_type ?? "sale", tx.state, action)

  if (!transition) {
    return NextResponse.json(
      { error: `ไม่สามารถทำ "${action}" จากสถานะ "${tx.state}" ใน workflow "${tx.tx_type}" ได้` },
      { status: 422 }
    )
  }

  const now = new Date()
  const today = now.toISOString().split("T")[0]

  // บันทึก paid_amount ถ้าเป็น action pay
  const extraUpdate: Record<string, unknown> = {}
  if (action === "pay" && body.amount != null) {
    extraUpdate.paid_amount = body.amount
  }

  // 1. อัปเดต transaction state
  const { error: updateErr } = await supabase()
    .from("transactions")
    .update({
      state: transition.to,
      state_changed_at: now.toISOString(),
      updated_at: now.toISOString(),
      ...extraUpdate,
    })
    .eq("id", id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // 2. บันทึก business_event
  const { data: event } = await supabase()
    .from("business_events")
    .insert({
      partner_id: tx.partner_id,
      event_type: transition.biz_event,
      event_date: today,
      title: transition.label,
      description: note ?? null,
      transaction_id: id,
    })
    .select("id")
    .single()

  // 3. ดึง transaction ที่อัปเดตแล้วพร้อม events + docs
  const [txRes, eventsRes, docsRes] = await Promise.all([
    supabase()
      .from("transactions")
      .select(`
        id, title, tx_type, state, state_changed_at, net_amount, paid_amount, vat_amount,
        project_name, partner_id, supplier_id, supplier_name,
        partners!transactions_partner_id_fkey(id, name, phone),
        suppliers:partners!transactions_supplier_id_fkey(id, name)
      `)
      .eq("id", id)
      .single(),
    supabase()
      .from("business_events")
      .select("id, event_type, event_date, title, description, metadata, created_at")
      .eq("transaction_id", id)
      .is("deleted_at", null)
      .order("event_date", { ascending: true }),
    supabase()
      .from("documents")
      .select("id, document_type, document_number, status, net_amount, issue_date, created_at")
      .eq("transaction_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
  ])

  return NextResponse.json({
    transaction: txRes.data,
    new_state: transition.to,
    event_id: event?.id,
    events: eventsRes.data ?? [],
    documents: docsRes.data ?? [],
  })
}
