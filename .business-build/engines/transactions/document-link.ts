/**
 * Document ↔ Transaction Link Rules
 *
 * เมื่อเอกสารถูกสร้าง ระบบใช้ไฟล์นี้ตัดสินว่า:
 * 1. tx_type ที่เหมาะสมสำหรับ document type นี้คืออะไร
 * 2. state ของ transaction ควรจะถูก advance ไปถึงขั้นไหน
 *
 * ไม่ต้องกรอกข้อมูลใหม่ — ใช้ข้อมูล partner และ document type ที่เลือกแล้ว
 */

import { getWorkflow, getStepIndex, type TxWorkflow } from "./workflows"

export interface DocLinkRule {
  tx_type: string     // workflow ที่ควรใช้
  target_event: string  // state ที่ transaction ควรจะอยู่เมื่อเอกสารนี้ถูกสร้าง
  biz_event_type: string  // business_events.event_type ที่จะบันทึก
}

export interface PaymentDocumentLinkInput {
  /** Amount read from the incoming payment/slip event. */
  amount: number
  /** Current outstanding amount on the existing transaction. */
  transactionOutstanding: number
  transactionId?: string | null
  partnerName?: string
  reference?: string
  /** Step 4 supplies the real gateway token. */
  previewToken?: string
}

export interface PaymentDocumentLinkResult {
  kind: "full_payment" | "partial_payment"
  /** Partial payment must never carry the old transaction for close/advance. */
  transactionId: string | undefined
  targetEvent: "paid" | null
  document: {
    type: "receipt"
    title: "ใบรับเงินชำระบางส่วน" | "ใบรับเงิน"
    amount: number
    reference: string
    note: string
  }
  /** Passed unchanged to SecretaryChat.tsx / DocumentPreview.tsx by Step 4. */
  preview_token: string | undefined
}

function moneyInSatang(value: number): number {
  return Math.round(value * 100)
}

/**
 * Resolve a payment event without allowing a partial payment to close the
 * transaction that produced the original debt.
 *
 * This is intentionally a pure Step 3 decision. Persistence, preview-token
 * storage and rendering remain owned by the existing Step 4 gateway/UI.
 */
export function resolvePaymentDocumentLink(input: PaymentDocumentLinkInput): PaymentDocumentLinkResult {
  const amount = Math.max(0, Number(input.amount) || 0)
  const outstanding = Math.max(0, Number(input.transactionOutstanding) || 0)
  const isFullPayment = moneyInSatang(amount) === moneyInSatang(outstanding)
  const reference = input.reference?.trim() || (input.transactionId ? `Transaction ${input.transactionId}` : "")

  if (!isFullPayment) {
    return {
      kind: "partial_payment",
      // Critical rule: do not pass the old transaction into Step 4 as the
      // transaction to close. It may be kept as human-readable reference only.
      transactionId: undefined,
      targetEvent: null,
      document: {
        type: "receipt",
        title: "ใบรับเงินชำระบางส่วน",
        amount,
        reference,
        note: `รับชำระบางส่วน ${amount.toFixed(2)} บาท${input.partnerName ? ` จาก ${input.partnerName}` : ""}`,
      },
      preview_token: input.previewToken,
    }
  }

  return {
    kind: "full_payment",
    transactionId: input.transactionId ?? undefined,
    targetEvent: "paid",
    document: {
      type: "receipt",
      title: "ใบรับเงิน",
      amount,
      reference,
      note: `รับชำระเต็มจำนวน ${amount.toFixed(2)} บาท${input.partnerName ? ` จาก ${input.partnerName}` : ""}`,
    },
    preview_token: input.previewToken,
  }
}

// doc_type → rule — ถ้าไม่อยู่ใน map จะไม่ advance state
export const DOC_LINK_RULES: Record<string, DocLinkRule> = {
  quotation:       { tx_type: "sale",      target_event: "created",   biz_event_type: "quotation_sent" },
  boq:             { tx_type: "contract",  target_event: "created",   biz_event_type: "quotation_sent" },
  workorder:       { tx_type: "contract",  target_event: "started",   biz_event_type: "work_started" },
  delivery:        { tx_type: "sale",      target_event: "delivered",  biz_event_type: "delivery_made" },
  delivery_order:  { tx_type: "sale",      target_event: "delivered",  biz_event_type: "delivery_made" },
  invoice:         { tx_type: "sale",      target_event: "invoiced",   biz_event_type: "invoice_issued" },
  billing:         { tx_type: "sale",      target_event: "invoiced",   biz_event_type: "invoice_issued" },
  receipt:         { tx_type: "sale",      target_event: "paid",       biz_event_type: "payment_received" },
  purchase_order:  { tx_type: "purchase",  target_event: "confirmed",  biz_event_type: "po_received" },
  payment_voucher: { tx_type: "purchase",  target_event: "paid",       biz_event_type: "payment_received" },
  management_fee:  { tx_type: "service",   target_event: "invoiced",   biz_event_type: "invoice_issued" },
  debt_notice:     { tx_type: "sale",      target_event: "invoiced",   biz_event_type: "invoice_issued" },
}

/** ตรวจว่าควร advance state ไปหรือไม่ (ไปข้างหน้าเท่านั้น ไม่ถอยหลัง) */
export function shouldAdvance(
  workflow: TxWorkflow,
  currentEvent: string,
  targetEvent: string
): boolean {
  const currentIdx = getStepIndex(workflow, currentEvent)
  const targetIdx = getStepIndex(workflow, targetEvent)
  return targetIdx > currentIdx
}

/** ได้ workflow และ advance rule สำหรับ doc type นี้ */
export function getLinkRule(docType: string): DocLinkRule | undefined {
  return DOC_LINK_RULES[docType]
}

/** สร้าง title อัตโนมัติสำหรับ transaction ใหม่จากข้อมูลที่มีอยู่ */
export function buildAutoTitle(partnerName: string, txType: string): string {
  const labels: Record<string, string> = {
    sale: "งานขาย",
    purchase: "งานจัดซื้อ",
    contract: "งานรับจ้าง",
    service: "งานบริการ",
    rental: "งานเช่า",
    transport: "งานขนส่ง",
  }
  const today = new Date().toLocaleDateString("th-TH", { month: "short", day: "numeric" })
  return `${labels[txType] ?? txType} — ${partnerName} (${today})`
}
