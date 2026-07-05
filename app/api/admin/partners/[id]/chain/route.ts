import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id: partnerId } = await params

  const [partnerRes, txRes, docsRes, eventsRes] = await Promise.all([
    // ข้อมูล partner
    supabase()
      .from("partners")
      .select("id, code, name, partner_type_label, phone, address, tax_id, contact_name, created_at")
      .eq("id", partnerId)
      .is("deleted_at", null)
      .single(),

    // transactions ทั้งหมดของ partner นี้ (พร้อม docs + events)
    supabase()
      .from("transactions")
      .select(`
        id, tx_type, state, title, project_name,
        net_amount, paid_amount, vat_amount,
        created_at, state_changed_at,
        suppliers:partners!transactions_supplier_id_fkey(id, name)
      `)
      .eq("partner_id", partnerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),

    // เอกสารทั้งหมดของ partner นี้ (รวม transaction_id)
    supabase()
      .from("documents")
      .select("id, document_type, document_number, status, net_amount, issue_date, created_at, transaction_id")
      .eq("partner_id", partnerId)
      .is("deleted_at", null)
      .order("issue_date", { ascending: false }),

    // events ทั้งหมดของ partner นี้ (รวม transaction_id)
    supabase()
      .from("business_events")
      .select("id, event_type, event_date, title, description, transaction_id, created_at")
      .eq("partner_id", partnerId)
      .is("deleted_at", null)
      .order("event_date", { ascending: false }),
  ])

  if (partnerRes.error) {
    return NextResponse.json({ error: partnerRes.error.message }, { status: 404 })
  }

  const docs = docsRes.data ?? []
  const events = eventsRes.data ?? []
  const transactions = txRes.data ?? []

  // จัด docs และ events ตาม transaction_id
  const docsByTx: Record<string, typeof docs> = {}
  const standaloneDocs: typeof docs = []
  for (const d of docs) {
    if (d.transaction_id) {
      ;(docsByTx[d.transaction_id] ??= []).push(d)
    } else {
      standaloneDocs.push(d)
    }
  }

  const eventsByTx: Record<string, typeof events> = {}
  const standaloneEvents: typeof events = []
  for (const e of events) {
    if (e.transaction_id) {
      ;(eventsByTx[e.transaction_id] ??= []).push(e)
    } else {
      standaloneEvents.push(e)
    }
  }

  // ประกอบ transaction chains
  const chains = transactions.map((tx) => ({
    ...tx,
    documents: docsByTx[tx.id] ?? [],
    events: eventsByTx[tx.id] ?? [],
  }))

  // Financial summary
  const totalInvoiced = docs
    .filter((d) => d.document_type === "invoice")
    .reduce((s, d) => s + Number(d.net_amount ?? 0), 0)

  const totalReceived = docs
    .filter((d) => d.document_type === "receipt")
    .reduce((s, d) => s + Number(d.net_amount ?? 0), 0)

  const totalPaid = transactions.reduce((s, t) => s + Number(t.paid_amount ?? 0), 0)

  const outstanding = totalInvoiced - Math.max(totalReceived, totalPaid)

  // หาวันที่เหตุการณ์แรกสุด
  const allDates = [
    ...docs.map((d) => d.issue_date ?? d.created_at),
    ...events.map((e) => e.event_date),
    ...transactions.map((t) => t.created_at),
  ].filter(Boolean).sort()

  const firstEventDate = allDates[0] ?? null

  return NextResponse.json({
    partner: partnerRes.data,
    chains,
    standalone_docs: standaloneDocs,
    standalone_events: standaloneEvents,
    summary: {
      total_invoiced: totalInvoiced,
      total_received: totalReceived,
      outstanding: Math.max(0, outstanding),
      transaction_count: transactions.length,
      document_count: docs.length,
      first_event_date: firstEventDate,
    },
  })
}
