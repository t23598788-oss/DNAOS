import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase/queries"
import { getServiceCategoryMeta } from "@/config/document-service-categories"
import {
  type DocumentDraftInput,
  calculateDocumentTotals,
  draftToDocData,
} from "@/lib/documents/document-editor"
import { DOC_LABELS, generateDoc } from "@/lib/documents/engine"
import { loadCompanySettings } from "@/lib/config/company-settings"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const { data, error } = await supabase()
    .from("documents")
    .select("*, partners(id, name, phone, address)")
    .eq("id", id)
    .is("deleted_at", null)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })

  return NextResponse.json({ document: data })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const draft: DocumentDraftInput = await req.json()

  if (!draft.type || !DOC_LABELS[draft.type]) {
    return NextResponse.json({ error: "type ไม่ถูกต้อง" }, { status: 400 })
  }
  if (!draft.customer?.name?.trim()) {
    return NextResponse.json({ error: "ต้องระบุชื่อคู่ค้า" }, { status: 400 })
  }

  const docNumber = draft.documentNumber?.trim() || ""
  const settings = await loadCompanySettings()
  const documentData = draftToDocData(draft, docNumber, settings)
  const rendered = generateDoc(documentData)
  const totals = calculateDocumentTotals(draft)
  const netAmount = Math.round((rendered.summary.total - totals.withholdingAmount) * 100) / 100
  const category = getServiceCategoryMeta(draft.serviceCategoryKey)

  const updates = {
    updated_at: new Date().toISOString(),
    document_type: draft.type,
    document_number: docNumber,
    issue_date: draft.issueDate || null,
    due_date: draft.dueDate || null,
    reference_number: draft.reference || null,
    partner_id: draft.partnerId || null,
    party_name: draft.customer.name,
    party_tax_id: draft.customer.tax || null,
    party_address: draft.customer.addr || null,
    party_contact: draft.customer.contact || null,
    party_tel: draft.customer.tel || null,
    service_category_key: category.id,
    service_category_label: category.th,
    terms: draft.terms || null,
    note: draft.note || null,
    discount_amount: totals.discountAmount,
    vat_enabled: draft.vatEnabled,
    vat_mode: draft.vatMode,
    withholding_tax_percent: draft.withholdingTaxPercent,
    subtotal_amount: rendered.summary.subtotal,
    base_amount: rendered.summary.beforeVat,
    vat_amount: rendered.summary.vat,
    gross_amount: rendered.summary.total,
    withholding_amount: totals.withholdingAmount,
    interest_amount: draft.debt?.interestAccrued ?? 0,
    net_amount: netAmount,
    data: {
      ...documentData,
      items: documentData.items.map((item) => ({
        description: item.description,
        detail: item.detail,
        qty: item.qty,
        unit_label: item.unit,
        unit_price: item.unitPrice,
        line_total: item.qty * item.unitPrice - (item.discount ?? 0),
      })),
      render: { label: rendered.label, html: rendered.html, summary: rendered.summary },
    },
  }

  const { data, error } = await supabase()
    .from("documents")
    .update(updates)
    .eq("id", id)
    .select("id, document_number, status, updated_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ document: data })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const { error } = await supabase()
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
