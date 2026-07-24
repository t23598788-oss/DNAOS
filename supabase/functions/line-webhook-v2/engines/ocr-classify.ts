// Auto-classify receipt/bill photos (owner, 2026-07-17): "AI อ่านข้อมูล OCR
// → จำแนกเอกสาร → สร้าง Document Card อัตโนมัติ". Same Claude vision pattern
// auto-build-event.ts's text call uses (JSON-in-text-then-parse, not a
// separate OCR engine), via the shared claude-client.ts helper. AI reads
// and classifies; it never replaces the original image, which stays
// exactly as fetched by fetchAndStoreLineMedia (Human Reality Timeline law,
// TASK-001).

// Business Evidence, not "attachments" (owner, 2026-07-18): a generic ERP
// treats every incoming photo the same and guesses blind. Expanded from the
// original 7-type set to cover everything the owner named a LINE contact can
// realistically send (fuel receipt, toll bill, weighbridge slip, delivery
// order, payment advice, bank statement, product/site photos, government
// documents) — each with a fixed Document Profile below, not just a raw
// type string.
//
// Owner instruction (2026-07-25): "เขียน AI ที่กูเอามาผูกไว้ในระบบ (ChatGPT)
// ออกไปจากระบบให้ถาวรเลย" — swapped from OpenAI/gpt-4o-mini to Claude, via
// the shared claude-client.ts helper (same file all 3 LINE-webhook AI call
// sites now use).
import { callClaudeVision } from "./claude-client.ts"

const DOCUMENT_TYPES = [
  "receipt", "tax_invoice", "invoice", "fuel_bill", "toll_bill", "weight_slip",
  "delivery_order", "transfer_slip", "payment_advice", "bank_statement",
  "product_photo", "site_photo", "government_document", "other",
] as const

// Document Profile (owner, 2026-07-18): "ไม่ควรตอบแค่ว่า 'ใบแจ้งหนี้' แต่ควร
// ตอบ Business Category / Workflow / Need VAT / Need Approval / Can Auto
// Post" — a fixed business-rule lookup per type, same pattern as
// engines/debt/tracking.ts's DEBT_TYPE_DOCUMENT_TYPE (a business constant,
// not something the AI reasons about per-image). can_auto_post is true ONLY
// for types with zero financial impact (weight/delivery/product/site) — any
// type touching money stays need_approval=true/can_auto_post=false, per
// Rule 72/73/83 (AI must not change financial state) and the same
// human-confirmation gate the Payment Verification Engine (Rule 115) uses.
export interface DocumentProfile {
  business_category: string
  workflow: string
  need_vat: boolean
  need_approval: boolean
  can_auto_post: boolean
}

export const DOCUMENT_TYPE_PROFILE: Record<typeof DOCUMENT_TYPES[number], DocumentProfile> = {
  receipt:              { business_category: "expense",         workflow: "general",       need_vat: true,  need_approval: true,  can_auto_post: false },
  tax_invoice:           { business_category: "expense",         workflow: "accounts_payable", need_vat: true, need_approval: true, can_auto_post: false },
  invoice:               { business_category: "expense",         workflow: "accounts_payable", need_vat: true, need_approval: true, can_auto_post: false },
  fuel_bill:             { business_category: "expense",         workflow: "fleet",         need_vat: true,  need_approval: true,  can_auto_post: false },
  toll_bill:             { business_category: "expense",         workflow: "fleet",         need_vat: false, need_approval: true,  can_auto_post: false },
  weight_slip:           { business_category: "operations",      workflow: "fleet",         need_vat: false, need_approval: false, can_auto_post: true },
  delivery_order:        { business_category: "operations",      workflow: "fulfillment",   need_vat: false, need_approval: false, can_auto_post: true },
  transfer_slip:         { business_category: "incoming_payment", workflow: "debt_collection", need_vat: false, need_approval: true, can_auto_post: false },
  payment_advice:        { business_category: "incoming_payment", workflow: "debt_collection", need_vat: false, need_approval: true, can_auto_post: false },
  bank_statement:        { business_category: "incoming_payment", workflow: "reconciliation", need_vat: false, need_approval: true, can_auto_post: false },
  product_photo:         { business_category: "operations",      workflow: "none",          need_vat: false, need_approval: false, can_auto_post: true },
  site_photo:            { business_category: "operations",      workflow: "none",          need_vat: false, need_approval: false, can_auto_post: true },
  government_document:   { business_category: "compliance",      workflow: "legal",         need_vat: false, need_approval: true,  can_auto_post: false },
  other:                 { business_category: "uncategorized",   workflow: "none",          need_vat: false, need_approval: true,  can_auto_post: false },
}

const SYSTEM_PROMPT_BASE = `คุณคือระบบอ่านและจำแนกเอกสาร (บิล/ใบเสร็จ/หลักฐานทางธุรกิจ) จากรูปภาพที่ส่งเข้ามาทาง LINE
อ่านรูปแล้วตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น รูปแบบ:
{
  "document_type": "หนึ่งใน receipt|tax_invoice|invoice|fuel_bill|toll_bill|weight_slip|delivery_order|transfer_slip|payment_advice|bank_statement|product_photo|site_photo|government_document|other",
  "vendor_name": "ชื่อบริษัท/ร้านค้าที่ออกเอกสาร ถ้าอ่านไม่ได้ให้เป็น null",
  "amount": ตัวเลขยอดเงินรวม ถ้าอ่านไม่ได้ให้เป็น null (ไม่ใส่ comma/สกุลเงิน),
  "document_date": "YYYY-MM-DD ถ้าอ่านไม่ได้ให้เป็น null",
  "raw_ocr_text": "ข้อความทั้งหมดที่อ่านได้จากรูป",
  "confidence": ตัวเลข 0-1 ความมั่นใจว่าจำแนกประเภทถูกต้อง,
  "sender_name": "ชื่อผู้โอน (เฉพาะ transfer_slip/payment_advice) ถ้าไม่ใช่หรืออ่านไม่ได้ให้เป็น null",
  "sender_bank": "ชื่อธนาคารผู้โอน (เฉพาะ transfer_slip/payment_advice) ถ้าไม่ใช่หรืออ่านไม่ได้ให้เป็น null",
  "reference_number": "เลขที่อ้างอิงรายการโอน (เฉพาะ transfer_slip/payment_advice) ถ้าไม่มีหรืออ่านไม่ได้ให้เป็น null",
  "transaction_datetime": "วันเวลาที่โอนจริงตามสลิป รูปแบบ ISO 8601 (เฉพาะ transfer_slip/payment_advice) ถ้าไม่ใช่หรืออ่านไม่ได้ให้เป็น null"
}
ถ้ารูปไม่ใช่เอกสาร/บิลเลย ให้ document_type เป็น "product_photo" หรือ "site_photo" ตามความเหมาะสม (ไม่ใช่ "other" — "other" สงวนไว้เฉพาะกรณีจำแนกไม่ได้จริง ๆ)
ฟิลด์ sender_name/sender_bank/reference_number/transaction_datetime ใช้เฉพาะตอน document_type เป็น transfer_slip หรือ payment_advice เท่านั้น เอกสารประเภทอื่นให้เป็น null เสมอ`

export interface ClassifiedReceipt {
  document_type: typeof DOCUMENT_TYPES[number]
  vendor_name: string | null
  amount: number | null
  document_date: string | null
  raw_ocr_text: string | null
  confidence: number
  sender_name: string | null
  sender_bank: string | null
  reference_number: string | null
  transaction_datetime: string | null
  document_profile: DocumentProfile
}

// Role-aware context (owner, 2026-07-18): "AI ไม่ต้องเดาสุ่ม แต่ใช้บริบทของ
// ผู้ส่งมาช่วยจำแนก" — a driver's photo skews toward fuel/toll/weight
// slips, a customer's toward payment evidence, a supplier's toward tax
// invoices/delivery orders. This BIASES the classification prompt only; the
// AI still reads the actual image and can override it (e.g. a driver can
// still send a site photo) — never a hard rule, never silently assumed.
const ROLE_HINTS: Record<string, string> = {
  driver:     "ผู้ส่งมีบทบาทเป็นคนขับรถ — มีโอกาสสูงที่จะเป็นใบเสร็จน้ำมัน (fuel_bill), ใบชั่ง (weight_slip), หรือค่าทางด่วน (toll_bill)",
  customer:   "ผู้ส่งมีบทบาทเป็นลูกค้า — มีโอกาสสูงที่จะเป็นสลิปโอนเงิน (transfer_slip), Payment Advice (payment_advice), หรือหนังสือหัก ณ ที่จ่าย",
  supplier:   "ผู้ส่งมีบทบาทเป็นซัพพลายเออร์ — มีโอกาสสูงที่จะเป็นใบกำกับภาษี (tax_invoice), ใบแจ้งหนี้ (invoice), หรือใบส่งของ (delivery_order)",
  employee:   "ผู้ส่งเป็นพนักงานบริษัท",
  owner:      "ผู้ส่งเป็นเจ้าของรถ",
  contractor: "ผู้ส่งเป็นผู้รับเหมา",
  accountant: "ผู้ส่งเป็นฝ่ายบัญชี",
  manager:    "ผู้ส่งเป็นผู้จัดการ",
  admin:      "ผู้ส่งเป็นแอดมินภายใน",
}

export async function classifyReceiptImage(imageUrl: string, senderRole?: string | null): Promise<ClassifiedReceipt | null> {
  const roleHint = senderRole ? ROLE_HINTS[senderRole] : null
  const systemPrompt = roleHint
    ? `${SYSTEM_PROMPT_BASE}\n\nบริบทผู้ส่ง (ใช้ช่วยจำแนก ไม่ใช่กฎตายตัว — อ่านรูปจริงเป็นหลักเสมอ): ${roleHint}`
    : SYSTEM_PROMPT_BASE

  const text = await callClaudeVision(systemPrompt, "จำแนกเอกสารในรูปนี้", imageUrl, 500)
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[0])
    if (!DOCUMENT_TYPES.includes(parsed.document_type)) parsed.document_type = "other"
    parsed.document_profile = DOCUMENT_TYPE_PROFILE[parsed.document_type as typeof DOCUMENT_TYPES[number]]
    return parsed as ClassifiedReceipt
  } catch {
    return null
  }
}
