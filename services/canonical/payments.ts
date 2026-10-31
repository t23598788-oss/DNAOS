/** Payment/debt relation helpers — read from the canonical projection views only. */
import { supabaseAdmin } from "@/services/supabase/queries";

export interface CanonicalPaymentAllocation {
  id: string;
  receipt_document_id: string;
  receipt_document_type: string | null;
  receipt_status: string | null;
  receipt_amount: number | null;
  media_path: string | null;
  allocation_state: string | null;
  allocation_kind: string | null;
  amount: number | null;
  allocated_at: string | null;
  allocated_by: string | null;
  note: string | null;
  invoice_id: string | null;
  standalone_document_id: string | null;
  debt_event_id: string | null;
  bank_statement_transaction_id: string | null;
  bank_amount: number | null;
}

interface AllocationRow {
  id: string;
  receipt_document_id: string;
  allocation_kind: string | null;
  amount: number | null;
  allocated_at: string | null;
  allocated_by: string | null;
  note: string | null;
  invoice_id: string | null;
  standalone_document_id: string | null;
  debt_event_id: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * All allocations pointing at a document (invoice | standalone) or a debt event,
 * hydrated with the inbound receipt, the original media path and the bank line
 * that matched the receipt. Reaches backwards to the money's real evidence.
 */
export async function getCanonicalAllocations(target: {
  invoiceId?: string | null;
  standaloneDocumentId?: string | null;
  debtEventId?: string | null;
}): Promise<CanonicalPaymentAllocation[]> {
  const db = supabaseAdmin();
  let q = db
    .from("payment_allocations")
    .select("id, receipt_document_id, allocation_kind, amount, allocated_at, allocated_by, note, invoice_id, standalone_document_id, debt_event_id");
  if (target.invoiceId) q = q.eq("invoice_id", target.invoiceId);
  else if (target.standaloneDocumentId) q = q.eq("standalone_document_id", target.standaloneDocumentId);
  else if (target.debtEventId) q = q.eq("debt_event_id", target.debtEventId);
  else return [];

  const { data, error } = await q.order("allocated_at", { ascending: true });
  if (error) throw new Error("canonical payment allocation query failed");
  if (!data?.length) return [];
  const rows = data as AllocationRow[];
  const receiptIds = [...new Set(rows.map((r) => r.receipt_document_id))];

  const { data: receipts, error: receiptsError } = await db
    .from("receipt_documents_bank_line")
    .select("receipt_document_id, document_type, receipt_status, receipt_amount, media_path, media_sha256, allocation_state, bank_statement_transaction_id, bank_amount")
    .in("receipt_document_id", receiptIds);
  if (receiptsError) throw new Error("canonical receipt allocation query failed");
  const byId = new Map((receipts ?? []).map((r: Record<string, unknown>) => [String(r.receipt_document_id), r]));

  return rows.map((r) => {
    const rc = byId.get(r.receipt_document_id) as Record<string, unknown> | undefined;
    return {
      id: r.id,
      receipt_document_id: r.receipt_document_id,
      receipt_document_type: (rc?.document_type as string) ?? null,
      receipt_status: (rc?.receipt_status as string) ?? null,
      receipt_amount: num(rc?.receipt_amount),
      media_path: (rc?.media_path as string) ?? null,
      allocation_state: (rc?.allocation_state as string) ?? null,
      allocation_kind: r.allocation_kind,
      amount: num(r.amount),
      allocated_at: r.allocated_at,
      allocated_by: r.allocated_by,
      note: r.note,
      invoice_id: r.invoice_id,
      standalone_document_id: r.standalone_document_id,
      debt_event_id: r.debt_event_id,
      bank_statement_transaction_id: (rc?.bank_statement_transaction_id as string) ?? null,
      bank_amount: num(rc?.bank_amount),
    };
  });
}

/** Ledger + cached snapshot projection for one company (owner of debt = debt_events). */
export async function getCanonicalCompanyDebt(companyId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin()
    .from("company_debt_current")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return data as Record<string, unknown>;
}

/**
 * Allocations for a set of documents (invoice | standalone) in one call.
 * Used by the transaction read model so a transaction shows every payment it has.
 */
export async function getCanonicalAllocationsForDocuments(
  documents: { document_kind: string; document_id: string }[],
): Promise<CanonicalPaymentAllocation[]> {
  const db = supabaseAdmin();
  const invoiceIds = documents.filter((d) => d.document_kind === "invoice").map((d) => d.document_id);
  const standaloneIds = documents.filter((d) => d.document_kind === "standalone_document").map((d) => d.document_id);
  if (!invoiceIds.length && !standaloneIds.length) return [];

  let q = db
    .from("payment_allocations")
    .select("id, receipt_document_id, allocation_kind, amount, allocated_at, allocated_by, note, invoice_id, standalone_document_id, debt_event_id");
  const filters: string[] = [];
  if (invoiceIds.length) filters.push(`invoice_id.in.(${invoiceIds.join(",")})`);
  if (standaloneIds.length) filters.push(`standalone_document_id.in.(${standaloneIds.join(",")})`);
  q = q.or(filters.join(","));

  const { data, error } = await q.order("allocated_at", { ascending: true });
  if (error || !data?.length) return [];
  const rows = data as AllocationRow[];
  const receiptIds = [...new Set(rows.map((r) => r.receipt_document_id))];

  const { data: receipts } = await db
    .from("receipt_documents_bank_line")
    .select("receipt_document_id, document_type, receipt_status, receipt_amount, media_path, media_sha256, allocation_state, bank_statement_transaction_id, bank_amount")
    .in("receipt_document_id", receiptIds);
  const byId = new Map((receipts ?? []).map((r: Record<string, unknown>) => [String(r.receipt_document_id), r]));

  return rows.map((r) => {
    const rc = byId.get(r.receipt_document_id) as Record<string, unknown> | undefined;
    return {
      id: r.id,
      receipt_document_id: r.receipt_document_id,
      receipt_document_type: (rc?.document_type as string) ?? null,
      receipt_status: (rc?.receipt_status as string) ?? null,
      receipt_amount: num(rc?.receipt_amount),
      media_path: (rc?.media_path as string) ?? null,
      allocation_state: (rc?.allocation_state as string) ?? null,
      allocation_kind: r.allocation_kind,
      amount: num(r.amount),
      allocated_at: r.allocated_at,
      allocated_by: r.allocated_by,
      note: r.note,
      invoice_id: r.invoice_id,
      standalone_document_id: r.standalone_document_id,
      debt_event_id: r.debt_event_id,
      bank_statement_transaction_id: (rc?.bank_statement_transaction_id as string) ?? null,
      bank_amount: num(rc?.bank_amount),
    };
  });
}
