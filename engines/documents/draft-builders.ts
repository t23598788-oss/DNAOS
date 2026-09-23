/**
 * Draft Builders
 *
 * สร้าง DocumentDraftInput จากข้อมูลที่มีอยู่แล้วในระบบ
 * ใช้ใน Server Components (create-document/page.tsx) เพื่อ pre-fill form
 * ไม่มีการกรอกข้อมูลใหม่ — ดึงจาก canonical company/document source ที่มีจริง
 *
 * B-01/B-02 reconciliation (2026-09-23, FULL_BUSINESS_SYSTEM_RECONCILIATION §19):
 *   · เดิมอ่าน `partners` / `documents` — **สองตารางนี้ไม่มีใน LIVE** (PGRST205 ยืนยันด้วย PostgREST)
 *   · ตอนนี้อ่าน canonical source จริง: `companies` (B-01) และ `standalone_documents` / `invoices`
 *     + embed `companies` ตาม FK เดิม (`standalone_documents_customer_company_id_fkey`,
 *     `invoices_customer_company_id_fkey`) — ชุดเดียวกับที่ app/api/admin/documents/route.ts ใช้อยู่
 *   · field mapping ทุกตัวพิสูจน์จาก LIVE + source (ดูตารางในรายงาน §20) — ไม่มี guessed mapping
 *   · `contact` ไม่มีคอลัมน์เทียบเท่าใน `companies` (contact_name/contact_person = 42703)
 *     ⇒ คืน "" ตาม contract เดิม **ไม่ใช้ email แทน** (คนละความหมาย)
 *   · `net_amount` (legacy = gross − WHT) → `net_payable` ตาม basis ของ canonicalFinancials
 *   · `transaction_id` (legacy → transactions ที่ไม่มีแล้ว) → `customer_order_id`
 *     (พิสูจน์ด้วย engines/canonical/transaction-write.ts#resolveOrderForDocument ที่ค้นด้วย customer_orders.id)
 */

import { supabase } from "@/services/supabase/queries"
import {
  createEmptyDocumentDraft,
  mapPartnerToCustomer,
  type DocumentDraftInput,
  type DocumentType,
} from "@/engines/documents/document-editor"

// เอกสารที่ควรสร้างต่อจากเอกสารประเภทต่าง ๆ
export const NEXT_DOC_SUGGESTIONS: Record<string, { type: DocumentType; label: string }[]> = {
  quotation:       [{ type: "delivery_order", label: "สร้างใบส่งของ" }, { type: "invoice", label: "สร้างใบแจ้งหนี้" }],
  delivery_order:  [{ type: "invoice", label: "สร้างใบแจ้งหนี้" }, { type: "receipt", label: "สร้างใบเสร็จรับเงิน" }],
  delivery:        [{ type: "invoice", label: "สร้างใบแจ้งหนี้" }, { type: "receipt", label: "สร้างใบเสร็จรับเงิน" }],
  invoice:         [{ type: "receipt", label: "สร้างใบเสร็จรับเงิน" }],
  billing:         [{ type: "receipt", label: "สร้างใบเสร็จรับเงิน" }],
  purchase_order:  [{ type: "payment_voucher", label: "สร้างใบสำคัญจ่าย" }],
  workorder:       [{ type: "invoice", label: "สร้างใบแจ้งหนี้" }],
  payment_voucher: [{ type: "receipt", label: "สร้างใบเสร็จรับเงิน" }],
}

/** canonical company row (companies) — เฉพาะคอลัมน์ที่ยืนยันว่ามีจริงใน LIVE */
type CompanyRow = {
  id: string
  name: string | null
  phone: string | null
  address: string | null
  tax_id: string | null
}

/**
 * companies → DocumentCustomer (ผ่าน mapPartnerToCustomer ที่มีอยู่แล้ว)
 * ไม่ส่ง `contact_name` เลย เพราะ companies ไม่มีคอลัมน์นั้น (ไม่ใช้ email แทน)
 */
function companyToCustomer(c: CompanyRow) {
  return mapPartnerToCustomer({
    name: c.name ?? "",
    phone: c.phone,
    address: c.address,
    tax_id: c.tax_id,
  })
}


// ── buildDraftFromPartner ──────────────────────────────────────────────────────
// B-01: อ่าน `companies` (canonical company source) แทน `partners` ที่ไม่มีใน LIVE
// ดึงข้อมูลมา pre-fill ฟอร์มสร้างเอกสาร — signature และ draft contract เดิมไม่เปลี่ยน

export async function buildDraftFromPartner(
  partnerId: string,
  docType?: string,
  transactionId?: string,
): Promise<DocumentDraftInput | undefined> {
  try {
    const { data: company, error } = await supabase()
      .from("companies")
      .select("id, name, phone, address, tax_id")
      .eq("id", partnerId)
      .single()

    if (error || !company) return undefined

    const type = (docType as DocumentType) ?? "receipt"
    const draft = createEmptyDocumentDraft(type)
    draft.partnerId = company.id
    draft.customer = companyToCustomer(company as CompanyRow)
    draft.issueDate = new Date().toISOString().split("T")[0]
    if (transactionId) draft.transactionId = transactionId
    return draft
  } catch {
    return undefined
  }
}

// ── buildDraftFromDocument ─────────────────────────────────────────────────────
// B-02: อ่านเอกสารจริงตามชนิด — `standalone_documents` (ทุกชนิด) หรือ `invoices`
//   · เลขที่: document_no / invoice_no        · คู่ค้า: customer_company_id + embed companies
//   · ยอด: net_payable (basis ของ canonicalFinancials) → ถ้าไม่มีจึงใช้ total_amount
//   · transaction: customer_order_id (legacy transaction_id → transactions ที่ไม่มีแล้ว)
// ยังใช้จากหน้า create-document เมื่อกด "สร้างต่อจากเอกสาร" เหมือนเดิม

type CanonicalDocumentRow = {
  id: string
  documentNumber: string | null
  documentType: string
  counterpartyId: string | null
  orderId: string | null
  netPayable: number | null
  totalAmount: number | null
  company: CompanyRow | null
}

export async function buildDraftFromDocument(
  docId: string,
  newType?: string,
): Promise<DocumentDraftInput | undefined> {
  try {
    let doc: CanonicalDocumentRow | null = null

    const standalone = await supabase()
      .from("standalone_documents")
      .select(
        "id, document_no, document_type, customer_company_id, customer_order_id, net_payable, total_amount, companies!standalone_documents_customer_company_id_fkey(id, name, phone, address, tax_id)",
      )
      .eq("id", docId)
      .single()

    if (!standalone.error && standalone.data) {
      const d = standalone.data as Record<string, unknown>
      doc = {
        id: String(d.id),
        documentNumber: (d.document_no as string | null) ?? null,
        documentType: (d.document_type as string | null) ?? "",
        counterpartyId: (d.customer_company_id as string | null) ?? null,
        orderId: (d.customer_order_id as string | null) ?? null,
        netPayable: d.net_payable === null || d.net_payable === undefined ? null : Number(d.net_payable),
        totalAmount: d.total_amount === null || d.total_amount === undefined ? null : Number(d.total_amount),
        company: (d.companies as CompanyRow | null) ?? null,
      }
    } else {
      const invoice = await supabase()
        .from("invoices")
        .select(
          "id, invoice_no, customer_company_id, customer_order_id, net_payable, total_amount, companies!invoices_customer_company_id_fkey(id, name, phone, address, tax_id)",
        )
        .eq("id", docId)
        .single()

      if (!invoice.error && invoice.data) {
        const d = invoice.data as Record<string, unknown>
        doc = {
          id: String(d.id),
          documentNumber: (d.invoice_no as string | null) ?? null,
          documentType: "invoice",
          counterpartyId: (d.customer_company_id as string | null) ?? null,
          orderId: (d.customer_order_id as string | null) ?? null,
          netPayable: d.net_payable === null || d.net_payable === undefined ? null : Number(d.net_payable),
          totalAmount: d.total_amount === null || d.total_amount === undefined ? null : Number(d.total_amount),
          company: (d.companies as CompanyRow | null) ?? null,
        }
      }
    }

    if (!doc) return undefined

    const type = (newType as DocumentType) ?? "receipt"
    const draft = createEmptyDocumentDraft(type)

    draft.partnerId = doc.counterpartyId ?? ""
    if (doc.company) draft.customer = companyToCustomer(doc.company)
    draft.reference = doc.documentNumber ?? ""
    draft.issueDate = new Date().toISOString().split("T")[0]
    if (doc.orderId) draft.transactionId = doc.orderId

    // ถ้าเป็นการสร้างใบเสร็จจากใบแจ้งหนี้ ใส่ยอดเดิมไว้เป็นค่าเริ่มต้น
    // B-02: net_amount (legacy = gross − WHT) → net_payable ตาม canonical basis (fallback total_amount)
    const amount = doc.netPayable ?? doc.totalAmount
    if (type === "receipt" && amount) {
      draft.rows = [
        { description: `ชำระตาม ${doc.documentNumber ?? ""}`, qty: 1, unit: "รายการ", unitPrice: Number(amount) },
      ]
    }

    return draft
  } catch {
    return undefined
  }
}
