/**
 * DNA OS Document Engine — STRICT RENDER MODE
 *
 * Types + Summary Calculation
 * Template อยู่ใน template.ts แยกต่างหาก
 *
 * COMPLIANCE POLICY v1.0 — LOCKED
 * ห้ามลายเซ็น / QR / PromptPay
 * Payment แสดงเฉพาะ paymentRequired=true
 */

import { renderDocument } from "./template";

export type DocType =
  | "quotation" | "boq" | "workorder" | "delivery" | "delivery_order"
  | "invoice" | "billing" | "receipt" | "purchase_order" | "payment_voucher"
  | "debt_notice" | "management_fee" | "requisition"
  | "job_summary" | "monthly_summary";

export const DOC_LABELS: Record<DocType, { th: string; en: string; prefix: string }> = {
  quotation:       { th: "ใบเสนอราคา",      en: "QUOTATION",        prefix: "QUO" },
  boq:             { th: "ใบประมาณปริมาณงาน", en: "BILL OF QUANTITIES", prefix: "BOQ" },
  workorder:       { th: "ใบสั่งงาน",        en: "WORK ORDER",       prefix: "WO" },
  delivery:        { th: "ใบส่งของ",         en: "DELIVERY ORDER",   prefix: "DO" },
  delivery_order:  { th: "ใบส่งสินค้า",      en: "DELIVERY ORDER",   prefix: "DO" },
  invoice:         { th: "ใบแจ้งหนี้",       en: "INVOICE",          prefix: "INV" },
  billing:         { th: "ใบวางบิล",         en: "BILLING NOTE",     prefix: "BN" },
  receipt:         { th: "ใบรับเงิน",        en: "RECEIPT",          prefix: "REC" },
  purchase_order:  { th: "ใบสั่งซื้อ",       en: "PURCHASE ORDER",   prefix: "PO" },
  payment_voucher: { th: "ใบสำคัญจ่าย",      en: "PAYMENT VOUCHER",  prefix: "PV" },
  debt_notice:     { th: "ใบติดตามหนี้",     en: "DEBT NOTICE",      prefix: "DEM" },
  management_fee:  { th: "ใบค่าบริหาร",      en: "MANAGEMENT FEE",   prefix: "MGT" },
  requisition:     { th: "ใบเบิก",          en: "REQUISITION",      prefix: "REQ" },
  job_summary:     { th: "ใบสรุปงาน",       en: "JOB SUMMARY",      prefix: "JS" },
  monthly_summary: { th: "ใบสรุปรายเดือน",   en: "MONTHLY SUMMARY",  prefix: "MS" },
};

export interface DocItem {
  description: string;
  detail?: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount?: number;
}

export interface DocEvent {
  date: string;
  action: string;
}

export interface DocData {
  type: DocType;

  // Header — ต้องส่งมาจาก DB
  company?: { name?: string; taxId?: string };
  docNumber?: string;
  date?: string;
  status?: string;

  // Customer — แสดงเฉพาะที่ส่งมา
  customer?: { name?: string; taxId?: string; contact?: string; address?: string; phone?: string };

  // Project/Reference — แสดงเฉพาะที่ส่งมา
  project?: string;
  reference?: string;

  // Items — ต้องมีอย่างน้อย 1 รายการ
  items: DocItem[];

  // Summary
  shipping?: number;
  serviceFee?: number;
  discount?: number;
  vatRate?: number;
  paidAmount?: number;

  // Events — timeline ของเอกสาร
  events?: DocEvent[];

  // Payment — แสดงเฉพาะ paymentRequired=true
  paymentRequired?: boolean;
  payment?: { bank?: string; account?: string; accountName?: string; branch?: string; dueDate?: string };

  // Debt — แสดงเฉพาะที่ส่งมา
  debt?: { principal: number; fee: number; daysOverdue: number; interestRate: number; interestAccrued: number; penalty?: number; defaultDate?: string };

  notes?: string;
}

export interface DocResult {
  type: DocType;
  label: { th: string; en: string };
  docNumber: string;
  html: string;
  summary: { subtotal: number; shipping: number; serviceFee: number; discount: number; beforeVat: number; vat: number; total: number; paid: number; remaining: number };
}

export function generateDoc(data: DocData): DocResult {
  const label = DOC_LABELS[data.type];
  const docNumber = data.docNumber ?? "";
  const vatRate = data.vatRate ?? 0;

  const subtotal = data.items.reduce((s, i) => s + i.qty * i.unitPrice - (i.discount ?? 0), 0);
  const shipping = data.shipping ?? 0;
  const serviceFee = data.serviceFee ?? 0;
  const discount = data.discount ?? 0;
  const beforeVat = subtotal + shipping + serviceFee - discount;
  const vat = vatRate > 0 ? Math.round(beforeVat * vatRate * 100) / 100 : 0;
  const total = beforeVat + vat;
  const paid = data.paidAmount ?? 0;
  const remaining = total - paid;

  const summary = { subtotal, shipping, serviceFee, discount, beforeVat, vat, total, paid, remaining };
  const html = renderDocument({ data, label, summary: { ...summary, vatRate } });

  return { type: data.type, label, docNumber, html, summary };
}
