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
