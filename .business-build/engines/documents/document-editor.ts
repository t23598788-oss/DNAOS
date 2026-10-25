import { DEFAULT_DOCUMENT_SERVICE_CATEGORY, type DocumentServiceCategory } from "@/config/document-service-categories"
import type { CompanySettings } from "@/core/config/company-settings"
import { DOC_LABELS, type DocData, type DocItem, type DocType } from "@/engines/documents/engine"

// เอกสารที่ฟอร์ม/หน้า admin นี้รู้จัก — เป็นสับเซตของ DocType ใน engine.ts (single source of truth)
export type DocumentType = Extract<DocType, "purchase_order" | "delivery_order" | "invoice" | "payment_voucher" | "debt_notice" | "receipt" | "quotation">
export type DocumentStatus = "draft" | "saved"
export type VatMode = "exclusive" | "inclusive"

export type DocumentCustomer = {
  name: string
  tax: string
  addr: string
  contact: string
  tel: string
}

export type DocumentLineItem = {
  description: string
  detail?: string
  qty: number
  unit: string
  unitPrice: number
}

export type DocumentDebtInfo = {
  principal: number
  fee: number
  daysOverdue: number
  interestRate: number
  interestAccrued: number
  penalty?: number
  defaultDate?: string
}

export type DocumentTotals = {
  subtotal: number
  discountAmount: number
  baseAmount: number
  vatAmount: number
  grossAmount: number
  withholdingAmount: number
  netAmount: number
}

export type DocumentDraftInput = {
  type: DocumentType
  documentNumber: string
  issueDate: string
  dueDate: string
  serviceCategoryKey: DocumentServiceCategory
  reference: string
  terms: string
  note: string
  discountAmount: number
  vatEnabled: boolean
  vatMode: VatMode
  withholdingTaxPercent: number
  partnerId: string
  customer: DocumentCustomer
  rows: DocumentLineItem[]
  debt?: DocumentDebtInfo
  transactionId?: string  // เชื่อม transaction ที่เปิดอยู่ — ถ้าไม่ระบุ ระบบจะหาหรือสร้างให้อัตโนมัติ
}

export type DocumentTypeMeta = {
  type: DocumentType
  prefix: string
  route: string
  fullTitle: string
  englishTitle: string
  partyLabel: string
  showDueDate: boolean
  showDebtFields: boolean
  showPayment: boolean
}

export const DOCUMENT_TYPE_ORDER: DocumentType[] = [
  "quotation",
  "purchase_order",
  "delivery_order",
  "invoice",
  "payment_voucher",
]

function buildTypeMeta(type: DocumentType, route: string, partyLabel: string, opts: Partial<DocumentTypeMeta> = {}): DocumentTypeMeta {
  const label = DOC_LABELS[type]
  return {
    type,
    prefix: label.prefix,
    route,
    fullTitle: label.th,
    englishTitle: label.en,
    partyLabel,
    showDueDate: false,
    showDebtFields: false,
    showPayment: false,
    ...opts,
  }
}

export const DOCUMENT_TYPE_META: Record<DocumentType, DocumentTypeMeta> = {
  quotation: buildTypeMeta("quotation", "/admin/quotation", "ลูกค้า / Bill To", { showDueDate: true }),
  purchase_order: buildTypeMeta("purchase_order", "/admin/purchase-order", "ผู้ขาย / Vendor", { showDueDate: true }),
  delivery_order: buildTypeMeta("delivery_order", "/admin/delivery-order", "ผู้รับสินค้า / Ship To"),
  invoice: buildTypeMeta("invoice", "/admin/invoice", "ลูกค้า / Bill To", { showDueDate: true, showPayment: true }),
  payment_voucher: buildTypeMeta("payment_voucher", "/admin/payment-voucher", "ผู้รับเงิน / Pay To"),
  debt_notice: buildTypeMeta("debt_notice", "/admin/debt-notice", "ลูกหนี้ / Debtor", { showDebtFields: true }),
  receipt: buildTypeMeta("receipt", "/admin/receipt", "ลูกค้า / Bill To", { showPayment: true }),
}

export const DOCUMENT_UNIT_OPTIONS = [
  "Transaction", "คิว", "งวด", "ตัน", "เที่ยว", "คัน", "วัน",
  "ชั่วโมง", "ต้น", "เมตร", "ตรม.", "ชิ้น", "กก.", "ลิตร",
  "ถัง", "รอบ", "ครั้ง", "งาน", "โครงการ",
]

// ─────────────────────────────────────────────────────────────
// MEASUREMENT DIMENSION / UNIT REGISTRY (pure data — ไม่ใช่ calculation engine)
// แยกหน่วยออกเป็น "มิติวัด" เพื่อให้ตรวจมิติก่อนบวก/แปลงหน่วย (STEP 2/3)
// ไม่มีสูตรคำนวณที่นี่ — จัดกลุ่มหน่วยที่มีอยู่แล้ว (DOCUMENT_UNIT_OPTIONS) เท่านั้น
// กันการบวกข้ามมิติ (kg+L, m²+m³, ตัน+คิว) และบังคับให้แปลงมวล↔ปริมาตรต้องมี density
// ─────────────────────────────────────────────────────────────
export type MeasurementDimension =
  | "LENGTH"   // ความยาว
  | "AREA"     // พื้นที่
  | "VOLUME"   // ปริมาตร
  | "MASS"     // มวล
  | "TIME"     // เวลา
  | "COUNT"    // จำนวน (นับชิ้น/เที่ยว/รอบ)
  | "RATE"     // อัตรา/งานเหมา (งวด/งาน/โครงการ)
  | "ABSTRACT" // นามธรรม (Transaction = ไม่ผูกมิติ)

export const UNIT_DIMENSION: Record<string, MeasurementDimension> = {
  // — หน่วยเอกสารจริง (DOCUMENT_UNIT_OPTIONS) —
  "Transaction": "ABSTRACT",
  "คิว": "VOLUME",      // m³ ปริมาตร
  "งวด": "RATE",
  "ตัน": "MASS",        // มวล
  "เที่ยว": "COUNT",    // trip
  "คัน": "COUNT",       // vehicle
  "วัน": "TIME",
  "ชั่วโมง": "TIME",
  "ต้น": "COUNT",
  "เมตร": "LENGTH",
  "ตรม.": "AREA",      // m²
  "ชิ้น": "COUNT",
  "กก.": "MASS",       // kg
  "ลิตร": "VOLUME",    // L
  "ถัง": "COUNT",      // ภาชนะ = นับชิ้น
  "รอบ": "COUNT",
  "ครั้ง": "COUNT",
  "งาน": "RATE",
  "โครงการ": "RATE",
  // — หน่วยสากลอ้างอิง (บริบทแปลงหน่วย) —
  "mm": "LENGTH", "cm": "LENGTH", "m": "LENGTH", "km": "LENGTH",
  "m²": "AREA", "km²": "AREA",
  "m³": "VOLUME", "L": "VOLUME", "kL": "VOLUME",
  "g": "MASS", "kg": "MASS",
  "piece": "COUNT", "bag": "COUNT", "roll": "COUNT", "sheet": "COUNT",
  "trip": "COUNT", "h": "TIME", "day": "TIME",
}

/** มิติของหน่วย (null = หน่วยที่ไม่รู้จัก) */
export function dimensionOf(unit: string): MeasurementDimension | null {
  return UNIT_DIMENSION[unit] ?? null
}

/** สองหน่วยอยู่มิติเดียวกันไหม — ใช้ตรวจก่อนบวกปริมาณทางกายภาพ (กัน kg+L, m²+m³, ตัน+คิว) */
export function sameDimension(a: string, b: string): boolean {
  const da = dimensionOf(a)
  const db = dimensionOf(b)
  return da != null && da === db
}

export const VAT_RATE = 0.07

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function formatMoney(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function calculateDocumentTotals(draft: DocumentDraftInput): DocumentTotals {
  const subtotal = roundMoney(draft.rows.reduce((s, r) => s + r.qty * r.unitPrice, 0))
  const discountAmount = roundMoney(draft.discountAmount ?? 0)
  const baseAmount = roundMoney(subtotal - discountAmount)
  const vatAmount = draft.vatEnabled ? roundMoney(baseAmount * VAT_RATE) : 0
  const grossAmount = roundMoney(baseAmount + vatAmount)
  const withholdingAmount =
    draft.withholdingTaxPercent > 0
      ? roundMoney(baseAmount * (draft.withholdingTaxPercent / 100))
      : 0
  const netAmount = roundMoney(grossAmount - withholdingAmount)
  return { subtotal, discountAmount, baseAmount, vatAmount, grossAmount, withholdingAmount, netAmount }
}

export function createEmptyDocumentDraft(type: DocumentType = "invoice"): DocumentDraftInput {
  const today = new Date().toISOString().split("T")[0]
  return {
    type,
    documentNumber: "",
    issueDate: today,
    dueDate: "",
    serviceCategoryKey: DEFAULT_DOCUMENT_SERVICE_CATEGORY,
    reference: "",
    terms: "",
    note: "",
    discountAmount: 0,
    vatEnabled: true,
    vatMode: "exclusive",
    withholdingTaxPercent: 0,
    partnerId: "",
    customer: { name: "", tax: "", addr: "", contact: "", tel: "" },
    rows: [{ description: "", qty: 1, unit: "Transaction", unitPrice: 0 }],
  }
}

export function toThaiDate(dateStr: string): string {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  return d.toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" })
}

export function mapPartnerToCustomer(partner: {
  name: string
  phone?: string | null
  address?: string | null
  tax_id?: string | null
  contact_name?: string | null
}): DocumentCustomer {
  return {
    name: partner.name ?? "",
    tax: partner.tax_id ?? "",
    addr: partner.address ?? "",
    contact: partner.contact_name ?? "",
    tel: partner.phone ?? "",
  }
}

/**
 * แปลง draft ของฟอร์ม → DocData ของ engine.ts (single template เดียวกันทุกประเภทเอกสาร)
 * ไม่คำนวณซ้ำที่นี่ — generateDoc() ใน engine.ts เป็นคนคำนวณ summary ทั้งหมด
 * settings (ชื่อบริษัท/เลขผู้เสียภาษี/บัญชีรับเงิน) มาจาก DB เสมอ — ดู core/config/company-settings.ts
 */
export function draftToDocData(draft: DocumentDraftInput, docNumber: string, settings: CompanySettings): DocData {
  const items: DocItem[] = draft.rows
    .filter((r) => r.description.trim() !== "" || r.unitPrice !== 0)
    .map((r) => ({ description: r.description, detail: r.detail, qty: r.qty, unit: r.unit, unitPrice: r.unitPrice }))

  const data: DocData = {
    type: draft.type,
    company: { name: settings.companyName, taxId: settings.companyTaxId },
    docNumber,
    date: draft.issueDate || undefined,
    customer: draft.customer.name
      ? {
          name: draft.customer.name,
          taxId: draft.customer.tax || undefined,
          contact: draft.customer.contact || undefined,
          address: draft.customer.addr || undefined,
          phone: draft.customer.tel || undefined,
        }
      : undefined,
    reference: draft.reference || undefined,
    items,
    discount: draft.discountAmount || undefined,
    vatRate: draft.vatEnabled ? VAT_RATE : 0,
    debt: draft.debt,
    notes: draft.note || undefined,
  }

  if (DOCUMENT_TYPE_META[draft.type].showPayment) {
    data.paymentRequired = true
    data.payment = {
      bank: settings.paymentBankName,
      account: settings.paymentAccountNumber,
      accountName: settings.paymentAccountName,
      dueDate: draft.dueDate ? toThaiDate(draft.dueDate) : undefined,
    }
  }

  return data
}
