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

// ── autoLinkTransaction ────────────────────────────────────────────────────────
// เรียกหลังสร้างเอกสาร — หา transaction ที่เปิดอยู่ของ partner นั้น
// ถ้าไม่มี: สร้างใหม่อัตโนมัติจากข้อมูล partner และเอกสารที่เพิ่งสร้าง
// ถ้ามี transactionId ที่ระบุมา: ใช้ตัวนั้นเลย
// ทั้งหมดนี้ใช้ข้อมูลที่มีอยู่แล้ว — ไม่ต้องกรอกใหม่

async function autoLinkTransaction(opts: {
  documentId: string
  documentType: string
  partnerId: string
  netAmount: number
  transactionId: string | null
}) {
  let orderId = opts.transactionId

  if (!orderId) {
    // หา customer_order ที่ยังเปิดอยู่ของ company นี้
    const { data: existing } = await supabase()
      .from("customer_orders")
      .select("id, status")
      .eq("customer_company_id", opts.partnerId)
      .not("status", "in", '("PAID","CANCELLED")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      orderId = existing.id
    } else {
      // สร้าง customer_order ใหม่อัตโนมัติ
      const { data: newOrder } = await supabase()
        .from("customer_orders")
        .insert({ customer_company_id: opts.partnerId, status: "CONFIRMED" })
        .select("id")
        .single()
      orderId = newOrder?.id ?? null
    }
  }

  if (!orderId) return

  // link invoice → customer_order
  if (opts.documentType === "invoice") {
    await supabase()
      .from("invoices")
      .update({ customer_order_id: orderId })
      .eq("id", opts.documentId)
  } else {
    await supabase()
      .from("standalone_documents")
      .update({ customer_order_id: orderId })
      .eq("id", opts.documentId)
  }
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

    return NextResponse.json({ documents })
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

  return NextResponse.json({ documents })
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
  const netAmount = Math.round((rendered.summary.total - totals.withholdingAmount) * 100) / 100
  let doc: { id: string; document_number: string; document_type: string; status: string; created_at: string }
  let docErr: { message: string } | null

  if (draft.type === "invoice") {
    const { data, error } = await supabase()
      .from("invoices")
      .insert({
        invoice_no: docNumber,
        customer_company_id: draft.partnerId || null,
        invoice_date: draft.issueDate || new Date().toISOString().split("T")[0],
        due_date: draft.dueDate || null,
        reference_no: draft.reference || null,
        notes: draft.note || null,
        subtotal: rendered.summary.subtotal,
        vat_rate: draft.vatEnabled ? 7 : 0,
        vat_amount: rendered.summary.vat,
        total_amount: netAmount,
        paid_amount: 0,
        invoice_status: "DRAFT",
      })
      .select("id, invoice_no, invoice_status, created_at")
      .single()
    doc = data ? { id: data.id, document_number: data.invoice_no, document_type: "invoice", status: data.invoice_status?.toLowerCase() ?? "draft", created_at: data.created_at } : null as any
    docErr = error
  } else {
    const { data, error } = await supabase()
      .from("standalone_documents")
      .insert({
        document_no: docNumber,
        document_type: draft.type,
        customer_company_id: draft.partnerId || null,
        document_date: draft.issueDate || new Date().toISOString().split("T")[0],
        reference_no: draft.reference || null,
        notes: draft.note || null,
        subtotal: rendered.summary.subtotal,
        vat_rate: draft.vatEnabled ? 7 : 0,
        vat_amount: rendered.summary.vat,
        total_amount: netAmount,
      })
      .select("id, document_no, document_type, created_at")
      .single()
    doc = data ? { id: data.id, document_number: data.document_no, document_type: data.document_type, status: "draft", created_at: data.created_at } : null as any
    docErr = error
  }

  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 })

  if (draft.partnerId) {
    await autoLinkTransaction({
      documentId: doc.id,
      documentType: draft.type,
      partnerId: draft.partnerId,
      netAmount: netAmount,
      transactionId: draft.transactionId || null,
    })
  }

  return NextResponse.json({ document: doc }, { status: 201 })
}
