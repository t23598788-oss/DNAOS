import { NextRequest, NextResponse } from "next/server"
import { supabase, documentTypeVariants } from "@/lib/supabase/queries"
import { getServiceCategoryMeta } from "@/config/document-service-categories"
import {
  type DocumentDraftInput,
  type DocumentType,
  calculateDocumentTotals,
  draftToDocData,
} from "@/lib/documents/document-editor"
import { DOC_LABELS, generateDoc } from "@/lib/documents/engine"
import { loadCompanySettings } from "@/lib/config/company-settings"
import { getLinkRule, shouldAdvance, buildAutoTitle } from "@/lib/transactions/document-link"
import { getWorkflow } from "@/lib/transactions/workflows"

// ── autoLinkTransaction ────────────────────────────────────────────────────────
// เรียกหลังสร้างเอกสาร — หา transaction ที่เปิดอยู่ของ partner นั้น
// ถ้าไม่มี: สร้างใหม่อัตโนมัติจากข้อมูล partner และเอกสารที่เพิ่งสร้าง
// ถ้ามี transactionId ที่ระบุมา: ใช้ตัวนั้นเลย
// ทั้งหมดนี้ใช้ข้อมูลที่มีอยู่แล้ว — ไม่ต้องกรอกใหม่

async function autoLinkTransaction(opts: {
  documentId: string
  documentType: string
  partnerId: string
  partnerName: string
  netAmount: number
  transactionId: string | null
}) {
  const rule = getLinkRule(opts.documentType)
  if (!rule) return  // doc type นี้ไม่มี rule → ไม่ link

  let txId = opts.transactionId

  if (!txId) {
    // หา transaction ที่เปิดอยู่ของ partner นี้ ในประเภทงานเดียวกัน
    const { data: existing } = await supabase()
      .from("transactions")
      .select("id, tx_type, state")
      .eq("partner_id", opts.partnerId)
      .eq("tx_type", rule.tx_type)
      .neq("state", "closed")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      txId = existing.id
    } else {
      // สร้าง transaction ใหม่อัตโนมัติจากข้อมูล partner ที่เลือกไว้แล้ว
      const workflow = getWorkflow(rule.tx_type)
      const { data: newTx } = await supabase()
        .from("transactions")
        .insert({
          partner_id: opts.partnerId,
          tx_type: rule.tx_type,
          title: buildAutoTitle(opts.partnerName, rule.tx_type),
          net_amount: opts.netAmount,
          state: workflow.steps[0]?.event ?? "created",
          state_changed_at: new Date().toISOString(),
        })
        .select("id")
        .single()
      txId = newTx?.id ?? null
    }
  }

  if (!txId) return

  // link document → transaction
  await supabase()
    .from("documents")
    .update({ transaction_id: txId })
    .eq("id", opts.documentId)

  // advance transaction state ถ้า target_event อยู่ข้างหน้ากว่า current state
  const { data: tx } = await supabase()
    .from("transactions")
    .select("state, tx_type")
    .eq("id", txId)
    .single()

  if (tx) {
    const workflow = getWorkflow(tx.tx_type ?? rule.tx_type)
    if (shouldAdvance(workflow, tx.state, rule.target_event)) {
      const now = new Date()
      await supabase()
        .from("transactions")
        .update({ state: rule.target_event, state_changed_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", txId)

      // บันทึก business_event
      await supabase()
        .from("business_events")
        .insert({
          partner_id: opts.partnerId,
          event_type: rule.biz_event_type,
          event_date: now.toISOString().split("T")[0],
          title: workflow.steps.find((s) => s.event === rule.target_event)?.label ?? rule.target_event,
          transaction_id: txId,
        })
    }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get("type") as DocumentType | null
  const search = searchParams.get("search") ?? ""
  const page = Math.max(1, Number(searchParams.get("page") ?? 1))
  const perPage = Math.min(100, Number(searchParams.get("perPage") ?? 50))
  const from = (page - 1) * perPage

  let query = supabase()
    .from("documents")
    .select("id, document_type, document_number, status, partner_id, party_name, net_amount, reference_number, issue_date, created_at, partners(id, name, phone)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(from, from + perPage - 1)

  if (type) {
    const variants = documentTypeVariants(type)
    query = variants.length > 1 ? query.in("document_type", variants) : query.eq("document_type", type)
  }
  if (search) query = query.ilike("document_number", `%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(req: NextRequest) {
  const draft: DocumentDraftInput = await req.json()

  if (!draft.type || !DOC_LABELS[draft.type]) {
    return NextResponse.json({ error: "type ไม่ถูกต้อง" }, { status: 400 })
  }
  if (!draft.customer?.name?.trim()) {
    return NextResponse.json({ error: "ต้องระบุชื่อคู่ค้า" }, { status: 400 })
  }

  const label = DOC_LABELS[draft.type]
  const docNumber = draft.documentNumber?.trim() || `${label.prefix}-${new Date().toISOString().split("T")[0].replace(/-/g, "")}-${String(Date.now()).slice(-3)}`

  const settings = await loadCompanySettings()
  const documentData = draftToDocData(draft, docNumber, settings)
  const rendered = generateDoc(documentData)
  const totals = calculateDocumentTotals(draft)
  const netAmount = Math.round((rendered.summary.total - totals.withholdingAmount) * 100) / 100
  const category = getServiceCategoryMeta(draft.serviceCategoryKey)

  const docPayload = {
    document_type: draft.type,
    document_number: docNumber,
    status: "draft",
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
    source: "deadboard",
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

  const { data: doc, error: docErr } = await supabase()
    .from("documents")
    .insert(docPayload)
    .select("id, document_number, document_type, status, created_at")
    .single()

  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })

  // ── Auto-link transaction ──────────────────────────────────────────────────
  // ถ้ามี partner_id ให้หา transaction ที่เปิดอยู่ หรือสร้างใหม่อัตโนมัติจากข้อมูล partner
  if (draft.partnerId) {
    const txId = draft.transactionId || null
    await autoLinkTransaction({
      documentId: doc.id,
      documentType: draft.type,
      partnerId: draft.partnerId,
      partnerName: draft.customer.name,
      netAmount: netAmount,
      transactionId: txId,
    })
  }

  return NextResponse.json({ document: doc }, { status: 201 })
}
