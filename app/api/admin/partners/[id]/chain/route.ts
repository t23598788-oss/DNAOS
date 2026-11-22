import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ANY_AUTHENTICATED } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { denyUnscoped, isCompanyVisible, notFound, resolveAdminReadScope } from "@/app/api/admin/_lib/read-scope"

type Params = { params: Promise<{ id: string }> }

// partners → companies, transactions → customer_orders, documents → invoices + standalone_documents.
// business_events ไม่มีตารางจริงรองรับ (ดู getBusinessEventsByPartner ใน services/supabase/queries.ts) — ว่างเสมอ
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ANY_AUTHENTICATED)
  if (auth instanceof NextResponse) return auth

  const { id: partnerId } = await params

  const ctx = await resolveAdminReadScope(auth)
  const denied = denyUnscoped(ctx)
  if (denied) return denied
  if (!isCompanyVisible(ctx, partnerId)) return notFound()

  const [partnerRes, txRes, invoicesRes, standaloneRes] = await Promise.all([
    supabase()
      .from("companies")
      .select("id, name, type, phone, address, tax_id, email, created_at")
      .eq("id", partnerId)
      .single(),

    supabase()
      .from("customer_orders")
      .select("id, order_no, status, created_at, updated_at")
      .eq("customer_company_id", partnerId)
      .order("created_at", { ascending: false }),

    supabase()
      .from("invoices")
      .select("id, invoice_no, invoice_status, total_amount, invoice_date, created_at, customer_order_id")
      .eq("customer_company_id", partnerId)
      .order("invoice_date", { ascending: false }),

    supabase()
      .from("standalone_documents")
      .select("id, document_no, document_type, total_amount, document_date, created_at, customer_order_id")
      .eq("customer_company_id", partnerId)
      .order("document_date", { ascending: false }),
  ])

  if (partnerRes.error) {
    return NextResponse.json({ error: partnerRes.error.message }, { status: 404 })
  }

  const partner = {
    id: partnerRes.data.id,
    code: partnerRes.data.id?.slice(0, 8) ?? "",
    name: partnerRes.data.name ?? "",
    partner_type_label: partnerRes.data.type ?? "",
    phone: partnerRes.data.phone ?? "",
    address: partnerRes.data.address ?? "",
    tax_id: partnerRes.data.tax_id ?? "",
    contact_name: partnerRes.data.email ?? "",
    created_at: partnerRes.data.created_at,
  }

  const docs = [
    ...(invoicesRes.data ?? []).map((d: any) => ({
      id: d.id,
      document_type: "invoice",
      document_number: d.invoice_no ?? "",
      status: d.invoice_status?.toLowerCase() ?? "draft",
      net_amount: Number(d.total_amount ?? 0),
      issue_date: d.invoice_date,
      created_at: d.created_at,
      transaction_id: d.customer_order_id ?? null,
    })),
    ...(standaloneRes.data ?? []).map((d: any) => ({
      id: d.id,
      document_type: (d.document_type ?? "document").toLowerCase(),
      document_number: d.document_no ?? "",
      status: "draft",
      net_amount: Number(d.total_amount ?? 0),
      issue_date: d.document_date,
      created_at: d.created_at,
      transaction_id: d.customer_order_id ?? null,
    })),
  ].sort((a, b) => new Date(b.issue_date ?? b.created_at).getTime() - new Date(a.issue_date ?? a.created_at).getTime())

  const events: { id: string; event_type: string; event_date: string; title: string; description: string | null; transaction_id: string | null; created_at: string }[] = []

  const transactions = (txRes.data ?? []).map((t: any) => ({
    id: t.id,
    tx_type: "sale",
    state: t.status,
    title: t.order_no ?? "คำสั่งซื้อ",
    project_name: null,
    net_amount: null,
    paid_amount: null,
    vat_amount: null,
    created_at: t.created_at,
    state_changed_at: t.updated_at ?? t.created_at,
    suppliers: null,
  }))

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
    partner,
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
