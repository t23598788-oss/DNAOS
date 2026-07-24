import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/core/auth/requireAuth"
import { ADMIN_TIER } from "@/core/auth/session"
import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { DOC_LABELS, type DocType } from "@/engines/documents/engine"
import { storeDocumentArtifacts, lineDocumentMessages } from "@/gateway/document-artifact-storage"
import { loadCompanySettings } from "@/core/config/company-settings"
import { sendLineMessage } from "@/registry/communication"

type Params = { params: Promise<{ lineUserId: string }> }

// Owner request 2026-07-11: every document already shown in this page's
// "รายละเอียดเพิ่มเติม" section (existing invoices/standalone_documents, not
// just ones just created through the chat) needs a one-click "send" too, all
// from this one screen. Legacy rows may not have persisted line items, so the
// canonical artifact falls back to a single total line while preserving the
// same document form and PDF/image delivery contract.

const ENUM_TO_DOC_TYPE: Record<string, DocType> = {
  QT: "quotation",
  RCP: "receipt",
  ORD: "delivery_order",
  BOQ: "boq",
  PO: "purchase_order",
  PV: "payment_voucher",
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { lineUserId } = await params
  const body = await req.json().catch(() => ({}))
  const table = body?.table
  const documentId = body?.documentId
  if (table !== "invoices" && table !== "standalone_documents") {
    return NextResponse.json({ error: "table ไม่ถูกต้อง" }, { status: 400 })
  }
  if (!documentId) return NextResponse.json({ error: "ขาด documentId" }, { status: 400 })

  const db = supabase()

  const { data: link } = await db
    .from("company_line_links").select("companies(name)").eq("line_user_id", lineUserId).maybeSingle()
  const companyName = (link as any)?.companies?.name ?? "ลูกค้า"

  let documentType: DocType;
  let documentNumber: string;
  let total = 0;
  let subtotal = 0;
  let vat = 0;
  let items: { description: string; qty: number; unit: string; unitPrice: number }[] = [];

  if (table === "invoices") {
    const { data: inv, error } = await db.from("invoices").select("invoice_no, subtotal, vat_amount, total_amount").eq("id", documentId).maybeSingle()
    if (error || !inv) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
    documentType = "invoice"
    documentNumber = inv.invoice_no
    subtotal = Number(inv.subtotal)
    vat = Number(inv.vat_amount)
    total = Number(inv.total_amount)
  } else {
    const { data: doc, error } = await db.from("standalone_documents").select("document_no, document_type, document_date, subtotal, vat_amount, total_amount, customer_company_id").eq("id", documentId).maybeSingle()
    if (error || !doc) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })
    documentType = ENUM_TO_DOC_TYPE[doc.document_type] ?? "quotation"
    documentNumber = doc.document_no
    subtotal = Number(doc.subtotal)
    vat = Number(doc.vat_amount)
    total = Number(doc.total_amount)
    const { data: rows } = await db
      .from("standalone_document_items")
      .select("description, qty, unit, unit_price")
      .eq("document_id", documentId)
      .order("sort_order", { ascending: true })
    items = (rows ?? []).map((row) => ({ description: row.description, qty: Number(row.qty), unit: row.unit, unitPrice: Number(row.unit_price) }))
  }

  const company = await loadCompanySettings()
  const artifacts = await storeDocumentArtifacts(documentId, {
    type: documentType,
    docNumber: documentNumber,
    date: new Date().toISOString().slice(0, 10),
    status: "saved",
    company: { name: company.companyName, taxId: company.companyTaxId },
    customer: { name: companyName },
    items,
    precomputedSummary: { subtotal, vatRate: total > subtotal ? vat / Math.max(subtotal, 1) : 0, vat, total },
  })
  const label = DOC_LABELS[documentType]?.th ?? documentType

  const lineRes = await sendLineMessage(lineUserId, lineDocumentMessages(artifacts, `${label} ${documentNumber}`))

  if (!lineRes.success) {
    return NextResponse.json({ error: `ส่ง LINE ไม่สำเร็จ: ${(lineRes.error ?? "").slice(0, 200)}` }, { status: 502 })
  }

  await db.from("line_events").insert({
    line_user_id: lineUserId,
    raw_type: "image",
    raw_text: `📄 ${label} ${documentNumber} ส่งให้ลูกค้าแล้ว`,
    status: "processed",
    direction: "out",
  })

  return NextResponse.json({ ok: true })
}
