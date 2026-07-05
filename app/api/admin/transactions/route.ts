import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"
import { getWorkflow } from "@/lib/transactions/workflows"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pendingOnly = searchParams.get("pending") === "1"
  const partnerId = searchParams.get("partner_id")
  const txType = searchParams.get("tx_type")

  let query = supabase()
    .from("transactions")
    .select(`
      id, title, tx_type, state, state_changed_at, net_amount, paid_amount, vat_amount,
      project_name, created_at, partner_id, supplier_id, supplier_name,
      partners!transactions_partner_id_fkey(id, name, phone),
      suppliers:partners!transactions_supplier_id_fkey(id, name)
    `)
    .is("deleted_at", null)
    .order("state_changed_at", { ascending: false })

  if (pendingOnly) query = query.neq("state", "closed")
  if (partnerId) query = query.eq("partner_id", partnerId)
  if (txType) query = query.eq("tx_type", txType)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ transactions: data ?? [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    partner_id, supplier_id, supplier_name,
    title, net_amount, vat_amount, project_name,
    tx_type = "sale",
  } = body

  if (!partner_id) {
    return NextResponse.json({ error: "ต้องระบุ partner_id" }, { status: 400 })
  }

  const workflow = getWorkflow(tx_type)
  const initialEvent = workflow.steps[0]?.event ?? "created"

  const { data, error } = await supabase()
    .from("transactions")
    .insert({
      partner_id,
      supplier_id: supplier_id || null,
      supplier_name: supplier_name || null,
      title: title ?? null,
      tx_type,
      net_amount: net_amount ?? null,
      vat_amount: vat_amount ?? null,
      project_name: project_name ?? null,
      state: initialEvent,
      state_changed_at: new Date().toISOString(),
    })
    .select("id, title, tx_type, state, state_changed_at, net_amount, created_at, partner_id")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // บันทึก business_event สำหรับการเปิดงาน
  await supabase()
    .from("business_events")
    .insert({
      partner_id,
      event_type: workflow.steps[0]?.biz_event ?? "quotation_sent",
      event_date: new Date().toISOString().split("T")[0],
      title: title ?? `เปิดงาน${workflow.label}ใหม่`,
      transaction_id: data.id,
    })

  return NextResponse.json({ transaction: data }, { status: 201 })
}
