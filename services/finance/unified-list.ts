// Unified financial list model (UNIFIED FINANCE ADMIN mission, 2026-10-11).
//
// รวมรายการเงินเข้า/เงินออกจาก canonical tables เดียวกันที่ระบบอัตโนมัติใช้อยู่
// (ไม่มีตาราง manual แยก):
//   เงินเข้า = receipt_documents (หลักฐาน/สลิปทุก channel) + payment_allocations
//   เงินออก = company_expenses (บิลค่าใช้จ่าย) + partner_payable_requests (คำขอจ่าย)
// source metadata (channel/source) แสดงเพื่อตรวจสอบย้อนหลังว่าแถวมาจากช่องทาง
// ใด — ไม่เปลี่ยนหลักการบันทึก/ไม่แยกบัญชี
// ที่นี่เป็น pure functions ล้วน (ไม่แตะ DB) — routes ทำ query แล้วส่ง rows เข้ามา

export type UnifiedDirection = "in" | "out"
export type UnifiedKind = "income_evidence" | "income_allocation" | "expense" | "payable"

export interface UnifiedRow {
  id: string
  kind: UnifiedKind
  direction: UnifiedDirection
  /** วันที่ธุรกรรม/เอกสาร (YYYY-MM-DD) — ไม่มีจริง = null ไม่เดา */
  date: string | null
  counterparty: string | null
  amount: number
  status: string
  /** เลขอ้างอิงหลักฐาน/เอกสาร (ถ้ามีจริง) */
  reference: string | null
  /** channel provenance — ตรวจสอบย้อนหลังได้ ไม่ใช่สิทธิ์พิเศษ */
  source_channel: string
  /** ผู้บันทึก/ผู้กระทำ (actor จาก audit หรือผู้ส่ง) */
  recorded_by: string | null
  /** เอกสาร/สลิปที่เกี่ยวข้อง (id) */
  receipt_document_id: string | null
  created_at: string | null
}

export interface IncomeEvidenceInput {
  id: string
  document_type: string | null
  amount: number | null
  document_date: string | null
  transaction_datetime: string | null
  created_at: string
  sender_name: string | null
  customer_company_name: string | null
  reference_number: string | null
  status: string
  source_channel: string | null
  confirmed_by: string | null
}

export function normalizeIncomeEvidence(r: IncomeEvidenceInput): UnifiedRow {
  return {
    id: r.id,
    kind: "income_evidence",
    direction: "in",
    date: r.document_date ?? (r.transaction_datetime ? r.transaction_datetime.slice(0, 10) : null),
    counterparty: r.sender_name ?? r.customer_company_name ?? null,
    amount: Number(r.amount ?? 0),
    status: r.status,
    reference: r.reference_number,
    source_channel: r.source_channel ?? "unknown",
    recorded_by: r.confirmed_by,
    receipt_document_id: r.id,
    created_at: r.created_at,
  }
}

export interface AllocationInput {
  id: string
  amount: number
  allocated_at: string | null
  receipt_id: string | null
  receipt_reference: string | null
  invoice_number: string | null
  customer_company_name: string | null
}

export function normalizeAllocation(r: AllocationInput): UnifiedRow {
  return {
    id: r.id,
    kind: "income_allocation",
    direction: "in",
    date: r.allocated_at ? r.allocated_at.slice(0, 10) : null,
    counterparty: r.customer_company_name ?? null,
    amount: Number(r.amount ?? 0),
    status: "allocated",
    reference: r.invoice_number ?? r.receipt_reference,
    source_channel: "canonical_payment",
    recorded_by: null,
    receipt_document_id: r.receipt_id,
    created_at: r.allocated_at,
  }
}

export interface ExpenseInput {
  id: string
  document_type: string | null
  amount: number | null
  expense_date: string | null
  created_at: string
  vendor_name: string | null
  tax_invoice_no: string | null
  source: string | null
  submitted_by_name: string | null
  receipt_document_id: string | null
}

export function normalizeExpense(r: ExpenseInput): UnifiedRow {
  return {
    id: r.id,
    kind: "expense",
    direction: "out",
    date: r.expense_date ?? r.created_at.slice(0, 10),
    counterparty: r.vendor_name,
    amount: Number(r.amount ?? 0),
    status: "recorded",
    reference: r.tax_invoice_no,
    source_channel: r.source ?? "line_chat",
    recorded_by: r.submitted_by_name,
    receipt_document_id: r.receipt_document_id,
    created_at: r.created_at,
  }
}

export interface PayableInput {
  id: string
  amount: number
  created_at: string
  partner_name: string | null
  description: string | null
  status: string
  bank_email_verified: boolean | null
}

export function normalizePayable(r: PayableInput): UnifiedRow {
  return {
    id: r.id,
    kind: "payable",
    direction: "out",
    date: r.created_at.slice(0, 10),
    counterparty: r.partner_name,
    amount: Number(r.amount ?? 0),
    status: r.status,
    reference: r.description,
    source_channel: r.status === "pending" || r.status === "owner_acknowledged" ? "payable_workflow" : "canonical_expense",
    recorded_by: null,
    receipt_document_id: null,
    created_at: r.created_at,
  }
}

export interface UnifiedFilters {
  direction?: UnifiedDirection | null
  kind?: UnifiedKind | null
  status?: string | null
  /** ค้น counterparty + reference */
  q?: string | null
  date_from?: string | null
  date_to?: string | null
  limit?: number | null
}

export function applyUnifiedFilters(rows: UnifiedRow[], f: UnifiedFilters): UnifiedRow[] {
  const q = (f.q ?? "").trim().toLowerCase()
  let out = rows.filter((r) => {
    if (f.direction && r.direction !== f.direction) return false
    if (f.kind && r.kind !== f.kind) return false
    if (f.status && r.status !== f.status) return false
    if (f.date_from && (r.date ?? "") < f.date_from) return false
    if (f.date_to && (r.date ?? "") > f.date_to) return false
    if (q) {
      const hay = `${r.counterparty ?? ""} ${r.reference ?? ""} ${r.id}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  out = out.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500)
  return out.slice(0, limit)
}
