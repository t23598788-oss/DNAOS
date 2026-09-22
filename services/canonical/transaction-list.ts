/**
 * Transaction list money summary (Phase C7) — READ ONLY.
 * Aggregates document_canonical + invoice_payment_summary per customer_order_id so
 * the list endpoint stops returning nulls. Nothing is recomputed: persisted
 * canonical values are summed and the basis is reported by the detail model.
 */
import { supabaseAdmin } from "@/services/supabase/queries";

export interface TransactionMoneySummary {
  order_id: string;
  document_count: number;
  subtotal: number;
  vat_amount: number;
  gross_amount: number;
  paid_amount: number;
  outstanding: number;
  data_completeness: "FULL" | "LEGACY_PARTIAL";
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getTransactionMoneySummaries(orderIds: string[]): Promise<Map<string, TransactionMoneySummary>> {
  const out = new Map<string, TransactionMoneySummary>();
  if (!orderIds.length) return out;

  const db = supabaseAdmin();
  const { data: docs, error } = await db
    .from("document_canonical")
    .select("document_kind, document_id, customer_order_id, subtotal, vat_amount, gross_amount, total_amount, net_payable, data_completeness")
    .in("customer_order_id", orderIds);
  if (error || !docs?.length) return out;

  const invoiceIds = docs.filter((d: Record<string, unknown>) => d.document_kind === "invoice").map((d: Record<string, unknown>) => String(d.document_id));
  const { data: summaries } = invoiceIds.length
    ? await db.from("invoice_payment_summary").select("invoice_id, paid_amount, outstanding").in("invoice_id", invoiceIds)
    : { data: [] as Record<string, unknown>[] };
  const paidByInvoice = new Map((summaries ?? []).map((s: Record<string, unknown>) => [String(s.invoice_id), num(s.paid_amount) ?? 0]));

  for (const raw of docs as Record<string, unknown>[]) {
    const orderId = raw.customer_order_id ? String(raw.customer_order_id) : null;
    if (!orderId) continue;
    const acc =
      out.get(orderId) ??
      {
        order_id: orderId,
        document_count: 0,
        subtotal: 0,
        vat_amount: 0,
        gross_amount: 0,
        paid_amount: 0,
        outstanding: 0,
        data_completeness: "FULL" as "FULL" | "LEGACY_PARTIAL",
      };
    const gross = num(raw.gross_amount) ?? num(raw.total_amount) ?? 0;
    const receivable = num(raw.net_payable) ?? gross;
    const paid = raw.document_kind === "invoice" ? paidByInvoice.get(String(raw.document_id)) ?? 0 : 0;

    acc.document_count += 1;
    acc.subtotal = round2(acc.subtotal + (num(raw.subtotal) ?? 0));
    acc.vat_amount = round2(acc.vat_amount + (num(raw.vat_amount) ?? 0));
    acc.gross_amount = round2(acc.gross_amount + gross);
    acc.paid_amount = round2(acc.paid_amount + paid);
    acc.outstanding = round2(acc.outstanding + (receivable - paid));
    if (raw.data_completeness !== "FULL") acc.data_completeness = "LEGACY_PARTIAL";
    out.set(orderId, acc);
  }
  return out;
}
