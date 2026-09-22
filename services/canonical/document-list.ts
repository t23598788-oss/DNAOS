/**
 * Document list canonical rows (Phase C7) — READ ONLY.
 * Gives list endpoints the persisted canonical financials + version info for a
 * page of documents, without recomputing anything in the route.
 */
import { supabaseAdmin } from "@/services/supabase/queries";

export interface CanonicalListRow {
  document_kind: string;
  document_id: string;
  subtotal: number | null;
  discount_amount: number | null;
  vat_rate: number | null;
  vat_mode: string | null;
  vat_amount: number | null;
  gross_amount: number | null;
  total_amount: number | null;
  wht_rate: number | null;
  wht_amount: number | null;
  net_payable: number | null;
  paid_amount: number | null;
  outstanding: number | null;
  receivable_basis: string;
  data_completeness: "FULL" | "LEGACY_PARTIAL";
  current_version_no: number | null;
  version_status: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getCanonicalDocumentRows(ids: string[]): Promise<Map<string, CanonicalListRow>> {
  const out = new Map<string, CanonicalListRow>();
  if (!ids.length) return out;

  const db = supabaseAdmin();
  const { data: rows, error } = await db
    .from("document_canonical")
    .select("document_kind, document_id, subtotal, discount_amount, vat_rate, vat_mode, vat_amount, gross_amount, total_amount, wht_rate, wht_amount, net_payable, paid_amount, data_completeness, current_version_no, version_status")
    .in("document_id", ids);
  if (error || !rows?.length) return out;

  const invoiceIds = rows.filter((r: Record<string, unknown>) => r.document_kind === "invoice").map((r: Record<string, unknown>) => String(r.document_id));
  const { data: summaries } = invoiceIds.length
    ? await db.from("invoice_payment_summary").select("invoice_id, paid_amount, outstanding, receivable_basis, derived_status").in("invoice_id", invoiceIds)
    : { data: [] as Record<string, unknown>[] };
  const byInvoice = new Map((summaries ?? []).map((s: Record<string, unknown>) => [String(s.invoice_id), s]));

  for (const raw of rows as Record<string, unknown>[]) {
    const id = String(raw.document_id);
    const s = byInvoice.get(id);
    const netPayable = num(raw.net_payable);
    const gross = num(raw.gross_amount);
    const total = num(raw.total_amount);
    const receivable = netPayable ?? gross ?? total;
    const paid = num(s?.paid_amount ?? raw.paid_amount) ?? 0;
    out.set(id, {
      document_kind: String(raw.document_kind),
      document_id: id,
      subtotal: num(raw.subtotal),
      discount_amount: num(raw.discount_amount),
      vat_rate: num(raw.vat_rate),
      vat_mode: (raw.vat_mode as string) ?? null,
      vat_amount: num(raw.vat_amount),
      gross_amount: gross,
      total_amount: total,
      wht_rate: num(raw.wht_rate),
      wht_amount: num(raw.wht_amount),
      net_payable: netPayable,
      paid_amount: paid,
      outstanding: receivable === null ? null : Math.round((receivable - paid) * 100) / 100,
      receivable_basis: netPayable !== null ? "net_payable" : gross !== null ? "gross_amount (legacy: wht unknown)" : "total_amount (legacy)",
      data_completeness: raw.data_completeness === "FULL" ? "FULL" : "LEGACY_PARTIAL",
      current_version_no: num(raw.current_version_no),
      version_status: (raw.version_status as string) ?? null,
    });
  }
  return out;
}
