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
import { DOC_LABELS } from "./types";
import type { DocType, DocData } from "./types";

// Shared contract (DocType/DOC_LABELS/DocItem/DocEvent/DocData) now genuinely
// lives in ./types (owner, 2026-08-07, Foundation Cleanup Pass — see that
// file's header). Re-exported here unchanged so every existing consumer
// (13+ real files across app/api, components, gateway) keeps importing from
// "@/engines/documents/engine" with the exact same names/types/values.
export * from "./types";

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

  const shipping = data.shipping ?? 0;
  const serviceFee = data.serviceFee ?? 0;
  const discount = data.discount ?? 0;
  const paid = data.paidAmount ?? 0;

  let subtotal: number, vatRate: number, vat: number, total: number;

  if (data.precomputedSummary) {
    // Render-only path — see DocData.precomputedSummary's own comment.
    // NOT a second calculation: these are the exact figures the Business
    // Capability already computed, used verbatim.
    ({ subtotal, vatRate, vat, total } = data.precomputedSummary);
  } else {
    subtotal = data.items.reduce((s, i) => s + i.qty * i.unitPrice - (i.discount ?? 0), 0);
    vatRate = data.vatRate ?? 0;
    const beforeVat = subtotal + shipping + serviceFee - discount;
    vat = vatRate > 0 ? Math.round(beforeVat * vatRate * 100) / 100 : 0;
    total = beforeVat + vat;
  }

  const beforeVat = subtotal + shipping + serviceFee - discount;
  const remaining = total - paid;

  const summary = { subtotal, shipping, serviceFee, discount, beforeVat, vat, total, paid, remaining };
  const html = renderDocument({ data, label, summary: { ...summary, vatRate } });

  return { type: data.type, label, docNumber, html, summary };
}
