import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const [txRes, eventsRes, docsRes] = await Promise.all([
    supabase()
      .from("transactions")
      .select(`
        id, title, tx_type, state, state_changed_at,
        net_amount, paid_amount, vat_amount,
        project_name, created_at, partner_id, supplier_id, metadata,
        partners!transactions_partner_id_fkey(id, name, phone, address),
        suppliers:partners!transactions_supplier_id_fkey(id, name)
      `)
      .eq("id", id)
      .is("deleted_at", null)
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

  if (txRes.error) return NextResponse.json({ error: txRes.error.message }, { status: 404 })

  return NextResponse.json({
    transaction: txRes.data,
    events: eventsRes.data ?? [],
    documents: docsRes.data ?? [],
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const { title, net_amount } = body

  const { data, error } = await supabase()
    .from("transactions")
    .update({ title, net_amount, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, title, state, net_amount")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ transaction: data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const { error } = await supabase()
    .from("transactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
