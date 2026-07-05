/**
 * Draft Builders
 *
 * สร้าง DocumentDraftInput จากข้อมูลที่มีอยู่แล้วในระบบ
 * ใช้ใน Server Components (create-document/page.tsx) เพื่อ pre-fill form
 * ไม่มีการกรอกข้อมูลใหม่ — ดึงจาก partner DB หรือเอกสารที่มีอยู่แล้ว
 */

import { supabase } from "@/lib/supabase/queries"
import {
  createEmptyDocumentDraft,
  mapPartnerToCustomer,
  type DocumentDraftInput,
  type DocumentType,
} from "@/lib/documents/document-editor"

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

// ── buildDraftFromPartner ──────────────────────────────────────────────────────
// ดึงข้อมูล partner จาก DB มา pre-fill ฟอร์มสร้างเอกสาร
// ไม่ต้องกรอก ชื่อ / เลขภาษี / ที่อยู่ / เบอร์โทร ใหม่

export async function buildDraftFromPartner(
  partnerId: string,
  docType?: string,
  transactionId?: string,
): Promise<DocumentDraftInput | undefined> {
  try {
    const { data: partner, error } = await supabase()
      .from("partners")
      .select("id, name, phone, address, tax_id, contact_name")
      .eq("id", partnerId)
      .is("deleted_at", null)
      .single()

    if (error || !partner) return undefined

    const type = (docType as DocumentType) ?? "receipt"
    const draft = createEmptyDocumentDraft(type)
    draft.partnerId = partner.id
    draft.customer = mapPartnerToCustomer(partner as Parameters<typeof mapPartnerToCustomer>[0])
    draft.issueDate = new Date().toISOString().split("T")[0]
    if (transactionId) draft.transactionId = transactionId
    return draft
  } catch {
    return undefined
  }
}

// ── buildDraftFromDocument ─────────────────────────────────────────────────────
// ดึงข้อมูล partner และ reference จากเอกสารที่มีอยู่แล้ว
// เช่น กด "สร้างใบเสร็จ" จากหน้า DO → form มีข้อมูลพาร์ทเนอร์ + เลขอ้างอิงครบ

export async function buildDraftFromDocument(
  docId: string,
  newType?: string,
): Promise<DocumentDraftInput | undefined> {
  try {
    const { data: doc, error } = await supabase()
      .from("documents")
      .select("id, document_type, document_number, partner_id, party_name, party_tax_id, party_address, party_contact, party_tel, net_amount, transaction_id, partners(id, name, phone, address, tax_id, contact_name)")
      .eq("id", docId)
      .is("deleted_at", null)
      .single()

    if (error || !doc) return undefined

    const partner = doc.partners as unknown as { id: string; name: string; phone?: string; address?: string; tax_id?: string; contact_name?: string } | null
    const type = (newType as DocumentType) ?? "receipt"
    const draft = createEmptyDocumentDraft(type)

    draft.partnerId = doc.partner_id ?? ""
    draft.customer = partner
      ? mapPartnerToCustomer(partner)
      : {
          name: doc.party_name ?? "",
          tax: doc.party_tax_id ?? "",
          addr: doc.party_address ?? "",
          contact: doc.party_contact ?? "",
          tel: doc.party_tel ?? "",
        }
    draft.reference = doc.document_number ?? ""
    draft.issueDate = new Date().toISOString().split("T")[0]
    if (doc.transaction_id) draft.transactionId = doc.transaction_id

    // ถ้าเป็นการสร้างใบเสร็จจากใบแจ้งหนี้ ใส่ยอดเดิมไว้เป็นค่าเริ่มต้น
    if (type === "receipt" && doc.net_amount) {
      draft.rows = [{ description: `ชำระตาม ${doc.document_number}`, qty: 1, unit: "รายการ", unitPrice: Number(doc.net_amount) }]
    }

    return draft
  } catch {
    return undefined
  }
}
