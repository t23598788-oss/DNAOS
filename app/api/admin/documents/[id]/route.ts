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
import { getDocumentDetail } from "@/services/canonical/document-detail"
import { updateDocumentDraft, voidDocument } from "@/engines/canonical/document-write"

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

// DOCUMENT HISTORY & EVIDENCE (owner mission 2026-10-10) — อ่านย้อนหลังทั้งหมดในที่เดียว:
// versions → artifacts (SHA-256/produced_by/origin) → audit_logs → delivery evidence
// จาก canonical tables เดิมทุกตัว ห้ามแก้ของเดิม และห้ามเขียนอะไรทั้งสิ้น
async function loadDocumentHistory(id: string) {
  const db = supabase()
  const { data: versions } = await db
    .from("document_versions")
    .select("id, document_type, document_id, invoice_id, standalone_document_id, version, status, current_version, produced_by, superseded_reason, created_at")
    .or(`invoice_id.eq.${id},standalone_document_id.eq.${id}`)
    .order("version", { ascending: true })
  const versionIds = ((versions ?? []) as any[]).map((v: any) => v.id)
  const { data: artifacts } = versionIds.length
    ? await db.from("document_artifacts").select("id, document_version_id, payload, produced_by, created_at").in("document_version_id", versionIds).order("created_at", { ascending: false })
    : { data: [] as any[] }
  const auditIds = [id, ...versionIds, ...(artifacts ?? []).map((a: any) => a.id)]
  const { data: audit } = await db
    .from("audit_logs")
    .select("id, entity_type, entity_id, action, before_state, after_state, actor_id, created_at")
    .in("entity_id", auditIds)
    .order("created_at", { ascending: false })
    .limit(50)
  // delivery evidence: ข้อความ LINE ขาออกที่มีเลขเอกสารนี้อยู่ใน payload (ถ้าเคยส่ง)
  const { data: delivery } = await db
    .from("line_events")
    .select("id, direction, line_user_id, line_message_id, extracted, created_at")
    .eq("direction", "out")
    .filter("extracted->>document_id", "eq", id)
    .order("created_at", { ascending: false })
    .limit(20)
  return { versions: versions ?? [], artifacts: artifacts ?? [], audit: audit ?? [], delivery: delivery ?? [] }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  // PHASE C7 — canonical detail is attached alongside the legacy payload (UI unchanged).
  const [invoice, standalone] = await Promise.all([findInvoice(id), findStandalone(id)])

  if (invoice) {
    const items = await findInvoiceItems(invoice.id)
    return NextResponse.json({
      document: invoiceToDocument(invoice, items),
      canonical: await getDocumentDetail("invoice", invoice.id),
      history: await loadDocumentHistory(invoice.id),
    })
  }

  if (standalone) {
    return NextResponse.json({
      document: standaloneToDocument(standalone),
      canonical: await getDocumentDetail("standalone_document", standalone.id),
      history: await loadDocumentHistory(standalone.id),
    })
  }

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
  void documentData

  const kind = draft.type === "invoice" ? "invoice" : "standalone_document"
  try {
    const result = await updateDocumentDraft({
      document_kind: kind,
      document_id: id,
      actor: auth.email,
      document_no: docNumber,
      document_type: draft.type,
      customer_company_id: draft.partnerId || null,
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
    })
    return NextResponse.json({
      document: {
        id: result.document_id,
        document_number: docNumber,
        status: kind === "invoice" ? "sent" : "active",
        updated_at: new Date().toISOString(),
        totals: result.totals,
        items_written: result.items_written,
      },
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "แก้ไขเอกสารไม่สำเร็จ"
    const status = message.startsWith("DOCUMENT_VOIDED") || message.startsWith("DOCUMENT_NOT_FOUND") ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

// PHASE D9 — void is business semantics now, never a delete:
// both invoices and standalone_documents keep every row and gain a void version.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const auth = await requireAuth(ADMIN_TIER)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  const [invoice, standalone] = await Promise.all([findInvoice(id), findStandalone(id)])
  const kind = invoice ? "invoice" : standalone ? "standalone_document" : null
  if (!kind) return NextResponse.json({ error: "ไม่พบเอกสาร" }, { status: 404 })

  try {
    const result = await voidDocument({ document_kind: kind, document_id: id, actor: auth.email, reason: "owner void via API" })
    return NextResponse.json({ ok: true, voided: true, deleted: result.deleted, version_no: result.version_no })
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ยกเลิกเอกสารไม่สำเร็จ" }, { status: 500 })
  }
}
