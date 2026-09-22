import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase, canonicalDocumentType } from "@/services/supabase/queries"
import {
  type DocumentDraftInput,
  type DocumentType,
  calculateDocumentTotals,
  draftToDocData,
} from "@/engines/documents/document-editor"
import { DOC_LABELS, generateDoc } from "@/engines/documents/engine"
import { loadCompanySettings } from "@/core/config/company-settings"
import { getCanonicalDocumentRows } from "@/services/canonical/document-list"
import { resolveOrderForDocument } from "@/engines/canonical/transaction-write"
import { createDocument } from "@/engines/canonical/document-write"

// PHASE D3/D9 — canonical transaction linking.
// The old behaviour created a customer_order with only company+status when none
// existed (a half chain). Now the target order is resolved BEFORE the document is
// written; when the context is incomplete the request fails validation and nothing
// is written (no half chain, no orphan document).

async function resolveOrder(opts: { partnerId: string; transactionId: string | null }) {
  return resolveOrderForDocument({ customer_company_id: opts.partnerId, transactionId: opts.transactionId })
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") as DocumentType | null
  const search = searchParams.get("search") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? 1))
  const perPage = Math.min(100, Number(searchParams.get("perPage") ?? 50))
  const from = (page - 1) * perPage
  const canonical = type ? canonicalDocumentType(type) : null

  // invoice → invoices table
  if (!canonical || canonical === "invoice") {
    let q = supabase()
      .from("invoices")
      .select("id, invoice_no, invoice_status, customer_company_id, customer_order_id, total_amount, reference_no, invoice_date, created_at, companies!invoices_customer_company_id_fkey(id, name, phone)")
      .order("created_at", { ascending: false })
      .range(from, from + perPage - 1)

    if (search) q = q.ilike("invoice_no", `%${search}%`)

    const { data, error } = await q
    if (error) {
      console.error("[documents] invoices list query failed:", error.message)
      return NextResponse.json({ documents: [] })
    }

    const documents = (data ?? []).map((d: any) => ({
      id: d.id,
      document_type: "invoice",
      document_number: d.invoice_no ?? "",
      status: d.invoice_status?.toLowerCase() ?? "draft",
      partner_id: d.customer_company_id ?? null,
      party_name: d.companies?.name ?? "",
      net_amount: Number(d.total_amount ?? 0),
      reference_number: d.reference_no ?? null,
      issue_date: d.invoice_date ?? null,
      created_at: d.created_at,
      partners: d.companies ?? null,
    }))

    // PHASE C7 — canonical financials attached to each list row (UI unchanged).
    const canon = await getCanonicalDocumentRows(documents.map((d: { id: string }) => d.id))
    return NextResponse.json({
      documents: documents.map((d: any) => ({ ...d, canonical: canon.get(d.id) ?? null })),
    })
  }

  // other types → standalone_documents
  let q = supabase()
    .from("standalone_documents")
    .select("id, document_no, document_type, customer_company_id, customer_order_id, total_amount, reference_no, document_date, created_at, companies!standalone_documents_customer_company_id_fkey(id, name, phone)")
    .eq("document_type", canonical)
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1)

  if (search) q = q.ilike("document_no", `%${search}%`)

  const { data, error } = await q
  if (error) {
    console.error("[documents] standalone_documents list query failed:", error.message)
    return NextResponse.json({ documents: [] })
  }

  const documents = (data ?? []).map((d: any) => ({
    id: d.id,
    document_type: d.document_type ?? canonical,
    document_number: d.document_no ?? "",
    status: d.status ?? "draft",
    partner_id: d.customer_company_id ?? null,
    party_name: d.companies?.name ?? "",
    net_amount: Number(d.total_amount ?? 0),
    reference_number: d.reference_no ?? null,
    issue_date: d.document_date ?? null,
    created_at: d.created_at,
    partners: d.companies ?? null,
  }))

  // PHASE C7 — canonical financials attached to each list row (UI unchanged).
  const canon = await getCanonicalDocumentRows(documents.map((d: { id: string }) => d.id))
  return NextResponse.json({
    documents: documents.map((d: any) => ({ ...d, canonical: canon.get(d.id) ?? null })),
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const draft: DocumentDraftInput = await req.json()

  if (!draft.type || !DOC_LABELS[draft.type]) {
    return NextResponse.json({ error: "type ไม่ถูกต้อง" }, { status: 400 })
  }
  if (!draft.customer?.name?.trim()) {
    return NextResponse.json({ error: "ต้องระบุชื่อคู่ค้า" }, { status: 400 })
  }

  const label = DOC_LABELS[draft.type]
  const docNumber = draft.documentNumber?.trim() || `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`

  let settings
  try {
    settings = await loadCompanySettings()
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้งค่าข้อมูลบริษัท (ชื่อ/เลขผู้เสียภาษี/บัญชีธนาคาร) — ตั้งค่าที่เมนู ตั้งค่า ก่อนออกเอกสาร", detail: e instanceof Error ? e.message : String(e) },
      { status: 503 }
    )
  }
  const documentData = draftToDocData(draft, docNumber, settings)
  const rendered = generateDoc(documentData)
  const totals = calculateDocumentTotals(draft)

  // PHASE D3/D9 — resolve the transaction BEFORE writing anything.
  // Incomplete context ⇒ validation error, no document, no half chain.
  let orderId: string | null = null
  if (draft.partnerId) {
    const resolution = await resolveOrder({ partnerId: draft.partnerId, transactionId: draft.transactionId || null })
    if (!resolution.linked || !resolution.order_id) {
      return NextResponse.json(
        { error: resolution.reason ?? "บริบทงานไม่ครบ", code: resolution.code ?? "TRANSACTION_CONTEXT_INCOMPLETE" },
        { status: 400 },
      )
    }
    orderId = resolution.order_id
  }

  // PHASE D2/D9 — every document goes through the canonical write service:
  // v1.1 money ladder, real line items, version 1 snapshot, audit.
  let created
  try {
    created = await createDocument({
      kind: draft.type === "invoice" ? "invoice" : "standalone_document",
      document_no: docNumber,
      document_type: draft.type,
      customer_company_id: draft.partnerId || null,
      customer_order_id: orderId,
      issue_date: draft.issueDate || null,
      due_date: draft.type === "invoice" ? draft.dueDate || null : null,
      reference_no: draft.reference || null,
      notes: draft.note || null,
      rows: draft.rows,
      discountAmount: draft.discountAmount ?? 0,
      vatEnabled: draft.vatEnabled,
      vatMode: draft.vatMode,
      withholdingTaxPercent: draft.withholdingTaxPercent,
      items: draft.rows.map((r, i) => ({
        description: r.description,
        qty: r.qty,
        unit: r.unit ?? null,
        unit_price: r.unitPrice,
        sort_order: i,
      })),
      actor: auth.email,
      status: draft.type === "invoice" ? "DRAFT" : "active",
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "สร้างเอกสารไม่สำเร็จ" }, { status: 500 })
  }

  const doc = {
    id: created.document_id,
    document_number: created.document_no,
    document_type: draft.type,
    status: draft.type === "invoice" ? "draft" : "active",
    created_at: new Date().toISOString(),
    totals: created.totals,
    version_no: created.version.version_no,
    items_written: created.items_written,
    transaction_id: orderId,
  }

  void rendered
  void totals

  return NextResponse.json({ document: doc }, { status: 201 })
}
