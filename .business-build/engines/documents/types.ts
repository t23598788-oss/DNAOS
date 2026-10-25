/**
 * DNA OS Document Engine — Shared Types (owner, 2026-08-07, Foundation
 * Cleanup Pass — real circular dependency fix).
 *
 * Root cause of the real engine.ts <-> template.ts cycle: DocType/
 * DocData/DocItem/DocEvent/DOC_LABELS are genuinely shared data
 * contracts between the calculation engine (engine.ts) and the renderer
 * (template.ts) — neither module conceptually "owns" them more than the
 * other. They previously lived in engine.ts, forcing template.ts to
 * import from engine.ts (a real, if type-only, back-reference) while
 * engine.ts also imports renderDocument (a real, value-level import)
 * from template.ts — a genuine cycle in the static import graph.
 *
 * Fix: extract the shared contract here, a neutral module neither engine
 * imports FROM the other. engine.ts re-exports everything below
 * unchanged, so no existing external consumer (13+ real files across
 * app/api, components, gateway) needs to change its import path.
 */

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

  // One Business Calculation, Many Renderers (owner, 2026-07-17, Invoice
  // Consistency Fix). When a Business Capability (e.g. business.calculate_tax)
  // has already computed the real subtotal/vat/total, pass it here — generateDoc()
  // renders these exact values verbatim and does NOT recompute VAT/totals
  // itself. Without this, generateDoc falls back to its own vatRate*subtotal
  // math (unchanged, for callers with no upstream business calculation yet —
  // e.g. the manual document builder UI).
  precomputedSummary?: { subtotal: number; vatRate: number; vat: number; total: number };
}
