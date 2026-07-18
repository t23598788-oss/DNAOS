import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import {
  type DocumentDraftInput,
  draftToDocData,
} from "@/engines/documents/document-editor"
import { DOC_LABELS, generateDoc } from "@/engines/documents/engine"
import { loadCompanySettings } from "@/core/config/company-settings"

type Params = { params: Promise<{ id: string }> }

// เอกสารจริงอยู่ใน 2 ตาราง: invoices (document_type invoice) กับ standalone_documents
// (ประเภทอื่นทั้งหมด) — ไม่มีตาราง "documents" รวมเดียว จึงต้องลองทั้งสองตาราง
async function findInvoice(id: string) {
  const { data } = await supabase()
    .from("invoices")
    .select("id, invoice_no, invoice_status, customer_company_id, customer_order_id, total_amount, subtotal, vat_rate, notes, reference_no, invoice_date, due_date, created_at, companies!invoices_customer_company_id_fkey(id, name, phone, address)")
    .eq("id", id)
    .maybeSingle()
  return data
}

async function findInvoiceItems(invoiceId: string) {
  const { data } = await supabase()
    .from("invoice_items")
    .select("description, qty, unit, unit_price")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true })
  return data ?? []
}

async function findStandalone(id: string) {
  const { data } = await supabase()
    .from("standalone_documents")
    .select("id, document_no, document_type, customer_company_id, customer_order_id, total_amount, reference_no, document_date, created_at, companies!standalone_documents_customer_company_id_fkey(id, name, phone, address)")
    .eq("id", id)
    .maybeSingle()
  return data
}

function invoiceToDocument(
  d: NonNullable<Awaited<ReturnType<typeof findInvoice>>>,
  items: Awaited<ReturnType<typeof findInvoiceItems>>,
) {
  // No Double VAT on reopen (owner, 2026-07-18) — root cause of a real
  // production bug: this function never returned subtotal/vat_rate/items,
  // so DocumentBuilder.tsx's selectDoc() fell back to a single fake row
  // priced at the already-VAT-inclusive total_amount and defaulted
  // vatEnabled to true, recomputing 7% VAT on top of VAT every time an
  // existing invoice was reopened/reprinted (confirmed against a real case:
  // stored subtotal 15,753.77 + vat_amount 1,102.76 = total_amount 16,856.53
  // — correct — but the reopened preview showed 16,856.53 + fresh 7% =
  // 18,036.49). Returning the real stored breakdown here is what lets
  // DocumentBuilder reconstruct the SAME numbers instead of re-deriving them.
  return {
    id: d.id,
    document_type: "invoice",
    document_number: d.invoice_no ?? "",
    status: d.invoice_status?.toLowerCase() ?? "draft",
    partner_id: d.customer_company_id ?? null,
    party_name: (d.companies as any)?.name ?? "",
    net_amount: Number(d.total_amount ?? 0),
    reference_number: d.reference_no ?? null,
    issue_date: d.invoice_date ?? null,
    due_date: d.due_date ?? null,
    created_at: d.created_at,
    partners: d.companies ?? null,
    note: d.notes ?? null,
    vat_enabled: Number(d.vat_rate ?? 0) > 0,
    data: {
      items: items.map((it) => ({
        description: it.description,
        qty: Number(it.qty ?? 0),
        unit_label: it.unit,
        unit_price: Number(it.unit_price ?? 0),
      })),
    },
  }
}

function standaloneToDocument(d: NonNullable<Awaited<ReturnType<typeof findStandalone>>>) {
  return {
    id: d.id,
    document_type: d.document_type ?? "document",
    document_number: d.document_no ?? "",
    status: "draft", // standalone_documents ไม่มีคอลัมน์สถานะจริง
    partner_id: d.customer_company_id ?? null,
    party_name: (d.companies as any)?.name ?? "",
    net_amount: Number(d.total_amount ?? 0),
    reference_number: d.reference_no ?? null,
    issue_date: d.document_date ?? null,
    created_at: d.created_at,
    partners: d.companies ?? null,
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const invoice = await findInvoice(id)
  if (invoice) {
    const items = await findInvoiceItems(invoice.id)
    return NextResponse.json({ document: invoiceToDocument(invoice, items) })
  }

  const standalone = await findStandalone(id)
  if (standalone) return NextResponse.json({ document: standaloneToDocument(standalone) })

  return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const draft: DocumentDraftInput = await req.json()

  if (!draft.type || !DOC_LABELS[draft.type]) {
    return NextResponse.json({ error: "type ไม่ถูกต้อง" }, { status: 400 })
  }
  if (!draft.customer?.name?.trim()) {
    return NextResponse.json({ error: "ต้องระบุชื่อคู่ค้า" }, { status: 400 })
  }

  const docNumber = draft.documentNumber?.trim() || ""
  let settings
  try {
    settings = await loadCompanySettings()
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าข้อมูลบริษัท (ชื่อ/เลขผู้เสียภาษี/บัญชีธนาคาร) — ตั้งค่าที่เมนู ตั้งค่า ก่อนแก้ไขเอกสาร", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    )
  }
  const documentData = draftToDocData(draft, docNumber, settings)
  const rendered = generateDoc(documentData)

  if (draft.type === "invoice") {
    const { data, error } = await supabase()
      .from("invoices")
      .update({
        invoice_no: docNumber,
        customer_company_id: draft.partnerId || null,
        invoice_date: draft.issueDate || null,
        due_date: draft.dueDate || null,
        reference_no: draft.reference || null,
        notes: draft.note || null,
        subtotal: rendered.summary.subtotal,
        vat_rate: draft.vatEnabled ? 7 : 0,
        vat_amount: rendered.summary.vat,
        total_amount: rendered.summary.total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, invoice_no, invoice_status, updated_at")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ document: { id: data.id, document_number: data.invoice_no, status: data.invoice_status?.toLowerCase(), updated_at: data.updated_at } })
  }

  const { data, error } = await supabase()
    .from("standalone_documents")
    .update({
      document_no: docNumber,
      document_type: draft.type,
      customer_company_id: draft.partnerId || null,
      document_date: draft.issueDate || null,
      reference_no: draft.reference || null,
      notes: draft.note || null,
      subtotal: rendered.summary.subtotal,
      vat_rate: draft.vatEnabled ? 7 : 0,
      vat_amount: rendered.summary.vat,
      total_amount: rendered.summary.total,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, document_no, updated_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ document: { id: data.id, document_number: data.document_no, status: "draft", updated_at: data.updated_at } })
}

// invoices มี invoice_status (soft-delete = VOID) แต่ standalone_documents ไม่มีคอลัมน์สถานะเลย
// จึงไม่มีทาง soft-delete ได้จริง — ลบแถวจริงสำหรับประเภทนี้
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const invoice = await findInvoice(id)
  if (invoice) {
    const { error } = await supabase().from("invoices").update({ invoice_status: "VOID" }).eq("id", id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabase().from("standalone_documents").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
