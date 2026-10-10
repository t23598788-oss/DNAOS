import { supabaseAdmin as supabase } from "@/services/supabase/queries"
import { DOC_LABELS, type DocData, type DocType } from "@/engines/documents/engine"
import { loadCompanySettings } from "@/core/config/company-settings"

// CANONICAL RECORD → DocData (owner mission 2026-10-10, ARTIFACT RECOVERY).
// ที่เดียวของระบบที่แปลงเอกสารจริงใน DB (invoices / standalone_documents +
// items) เป็น DocData ให้ renderer — ใช้ร่วมกันโดย document-preview route
// (อ่านอย่างเดียว) และ artifact-recover route (กู้ไฟล์) เพื่อให้ภาพที่
// preview สดกับไฟล์ที่กู้เก็บ byte-identical กันบน runtime เดียวกัน.
// ข้อมูลทุกตัวอ่านจาก record เท่านั้น — ไม่คำนวณยอดใหม่ ไม่สร้างรายการเอง.

// doc type mapping = ชุดเดียวกับ send-document route (ของเดิม)
const ENUM_TO_DOC_TYPE: Record<string, DocType> = {
  QT: "quotation",
  RCP: "receipt",
  ORD: "delivery_order",
  BOQ: "boq",
  PO: "purchase_order",
  PV: "payment_voucher",
}

export type DocTable = "invoices" | "standalone_documents"

export interface LoadedDoc {
  table: DocTable
  id: string
  docNumber: string
  docType: DocType
  rawType: string
  date: string
  status: string
  companyId: string
  subtotal: number
  vat: number
  total: number
  notes: string | null
  items: { description: string; qty: number; unit: string; unitPrice: number }[]
}

/** เอกสารอยู่ใน 2 ตาราง (ไม่มีตารางรวม) — ลองทั้งสองแบบเดียวกับ /api/admin/documents/[id] */
export async function findDocumentTable(id: string): Promise<DocTable | null> {
  const db = supabase()
  const { data: inv } = await db.from("invoices").select("id").eq("id", id).maybeSingle()
  if (inv) return "invoices"
  const { data: doc } = await db.from("standalone_documents").select("id").eq("id", id).maybeSingle()
  return doc ? "standalone_documents" : null
}

export async function loadDocFromRecord(table: string, id: string): Promise<LoadedDoc | null> {
  const db = supabase()
  if (table === "invoices") {
    const { data: inv } = await db
      .from("invoices")
      .select("id, invoice_no, invoice_status, customer_company_id, subtotal, vat_amount, total_amount, invoice_date, notes")
      .eq("id", id)
      .maybeSingle()
    if (!inv) return null
    const { data: rows } = await db
      .from("invoice_items")
      .select("description, qty, unit, unit_price")
      .eq("invoice_id", id)
      .order("sort_order", { ascending: true })
    return {
      table: "invoices",
      id,
      docNumber: String(inv.invoice_no ?? ""),
      docType: "invoice",
      rawType: "invoice",
      date: String(inv.invoice_date ?? "").slice(0, 10),
      status: String(inv.invoice_status ?? ""),
      companyId: String(inv.customer_company_id ?? ""),
      subtotal: Number(inv.subtotal ?? 0),
      vat: Number(inv.vat_amount ?? 0),
      total: Number(inv.total_amount ?? 0),
      notes: inv.notes ?? null,
      items: (rows ?? []).map((r) => ({
        description: String(r.description ?? ""),
        qty: Number(r.qty ?? 0),
        unit: String(r.unit ?? "รายการ"),
        unitPrice: Number(r.unit_price ?? 0),
      })),
    }
  }
  if (table === "standalone_documents") {
    const { data: doc } = await db
      .from("standalone_documents")
      .select("id, document_no, document_type, status, customer_company_id, subtotal, vat_amount, total_amount, document_date, notes")
      .eq("id", id)
      .maybeSingle()
    if (!doc) return null
    const { data: rows } = await db
      .from("standalone_document_items")
      .select("description, qty, unit, unit_price")
      .eq("document_id", id)
      .order("sort_order", { ascending: true })
    const rawType = String(doc.document_type ?? "")
    // DB reality (census 2026-10-10): document_type เก็บเป็น full word
    // (receipt/quotation/delivery_order) — รองรับทั้ง full word และรหัสเก่า
    const resolvedType: DocType | undefined =
      rawType in DOC_LABELS ? (rawType as DocType) : ENUM_TO_DOC_TYPE[rawType]
    return {
      table: "standalone_documents",
      id,
      docNumber: String(doc.document_no ?? ""),
      docType: resolvedType ?? "quotation",
      rawType,
      date: String(doc.document_date ?? "").slice(0, 10),
      status: String(doc.status ?? ""),
      companyId: String(doc.customer_company_id ?? ""),
      subtotal: Number(doc.subtotal ?? 0),
      vat: Number(doc.vat_amount ?? 0),
      total: Number(doc.total_amount ?? 0),
      notes: doc.notes ?? null,
      items: (rows ?? []).map((r) => ({
        description: String(r.description ?? ""),
        qty: Number(r.qty ?? 0),
        unit: String(r.unit ?? "รายการ"),
        unitPrice: Number(r.unit_price ?? 0),
      })),
    }
  }
  return null
}

/** Canonical DocData — จาก record ใน DB เท่านั้น (ยอด/เลข/รายการเดิม ไม่คำนวณใหม่). */
export async function buildDocDataFromRecord(doc: LoadedDoc): Promise<DocData> {
  const settings = await loadCompanySettings()
  const { data: party } = await supabase().from("companies").select("name").eq("id", doc.companyId).maybeSingle()
  return {
    type: doc.docType,
    company: { name: settings.companyName, taxId: settings.companyTaxId },
    docNumber: doc.docNumber,
    date: doc.date,
    status: doc.status,
    customer: { name: (party as { name?: string } | null)?.name ?? "" },
    items: doc.items.length > 0
      ? doc.items
      : [{ description: "ยอดเอกสาร", qty: 1, unit: "รายการ", unitPrice: doc.total }],
    notes: doc.notes ?? undefined,
    precomputedSummary: {
      subtotal: doc.subtotal,
      vatRate: doc.total > doc.subtotal ? doc.vat / Math.max(doc.subtotal, 1) : 0,
      vat: doc.vat,
      total: doc.total,
    },
  }
}
