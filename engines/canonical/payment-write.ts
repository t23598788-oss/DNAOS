/**
 * Canonical payment write service (Phase D4).
 *
 * `payment_allocations` is the ONLY source of truth for "how much of a payment went
 * to which claim". Confirming a payment therefore always writes:
 *
 *   receipt_documents (status) → payment_allocations → debt_events (ledger)
 *                              → projection refresh (receipt allocation_state,
 *                                invoices.paid_amount/invoice_status, debt_snapshots)
 *
 * Supports partial payment (several allocations per claim), one payment → many
 * claims, many payments → one claim. `paid_amount` is only ever a cached projection
 * recomputed from allocations — never typed as truth.
 */
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";
import { appendDebtEvent, refreshDebtSnapshotFromLedger } from "@/engines/canonical/debt-write";

export type AllocationTarget =
  | { kind: "invoice"; id: string }
  | { kind: "standalone_document"; id: string }
  | { kind: "debt_event"; id: string }
  /** the ledger row created by `debt_event_anchor` in the same call */
  | { kind: "anchor" };

export interface PaymentAllocationInput {
  target: AllocationTarget;
  allocation_kind: "principal" | "interest" | "penalty" | "other";
  amount: number;
  note?: string | null;
}

export interface ConfirmPaymentInput {
  receipt_document_id: string;
  allocations: PaymentAllocationInput[];
  actor: string;
  /** when the evidence side has no debt_event yet, the caller can anchor it on a real ledger row */
  debt_event_anchor?: { event_type: "receipt_received" | "interest_penalty_received"; amount: number; note?: string | null } | null;
}

export interface ConfirmPaymentResult {
  receipt_document_id: string;
  allocations_written: number;
  allocation_ids: string[];
  debt_event_id: string | null;
  refreshed: {
    receipt_allocation_state: "unallocated" | "partial" | "allocated";
    invoices: { invoice_id: string; paid_amount: number; invoice_status: string }[];
    debt_snapshot: Record<string, unknown> | null;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function requireAnchor(debtEventId: string | null): string {
  if (!debtEventId) throw new Error("PAYMENT_ANCHOR_REQUIRED: allocation แบบ anchor ต้องมี debt_event_anchor ในคำขอเดียวกัน");
  return debtEventId;
}

async function refreshInvoiceProjection(invoiceId: string) {
  const db = supabaseAdmin();
  const { data: allocs } = await db.from("payment_allocations").select("amount, allocation_kind").eq("invoice_id", invoiceId);
  const paid = round2((allocs ?? []).filter((a: Record<string, unknown>) => a.allocation_kind === "principal").reduce((s: number, a: Record<string, unknown>) => s + Number(a.amount ?? 0), 0));
  const { data: inv } = await db.from("invoices").select("invoice_status, net_payable, gross_amount, total_amount").eq("id", invoiceId).maybeSingle();
  const receivable = Number(inv?.net_payable ?? inv?.gross_amount ?? inv?.total_amount ?? 0);
  let status = String(inv?.invoice_status ?? "SENT");
  if (status !== "VOID") {
    status = paid >= receivable && receivable > 0 ? "PAID" : paid > 0 ? "PARTIALLY_PAID" : status;
  }
  const { error } = await db.from("invoices").update({ paid_amount: paid, invoice_status: status }).eq("id", invoiceId);
  if (error) throw new Error(`refresh projection ของใบแจ้งหนี้ไม่สำเร็จ: ${error.message}`);
  return { invoice_id: invoiceId, paid_amount: paid, invoice_status: status, receivable };
}

async function refreshReceiptAllocationState(receiptDocumentId: string) {
  const db = supabaseAdmin();
  const { data: receipt } = await db.from("receipt_documents").select("amount").eq("id", receiptDocumentId).maybeSingle();
  const { data: allocs } = await db.from("payment_allocations").select("amount").eq("receipt_document_id", receiptDocumentId);
  const total = round2((allocs ?? []).reduce((s: number, a: Record<string, unknown>) => s + Number(a.amount ?? 0), 0));
  const state = !allocs?.length ? "unallocated" : total >= Number(receipt?.amount ?? 0) ? "allocated" : "partial";
  const { error } = await db.from("receipt_documents").update({ allocation_state: state }).eq("id", receiptDocumentId);
  if (error) throw new Error(`refresh allocation_state ไม่สำเร็จ: ${error.message}`);
  return state as "unallocated" | "partial" | "allocated";
}

/**
 * Confirm a payment with real evidence: allocation rows + ledger rows + projections.
 * Refuses to write when the receipt is not payment evidence or is already allocated
 * (idempotency guard — the same money is never counted twice).
 */
export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  const db = supabaseAdmin();
  if (!input.allocations.length) throw new Error("PAYMENT_ALLOCATION_REQUIRED: ต้องระบุเป้าหมายการจัดสรรอย่างน้อย 1 รายการ");

  const { data: receipt, error: receiptErr } = await db
    .from("receipt_documents")
    .select("id, status, document_type, amount, customer_company_id, matched_debt_event_id, media_path")
    .eq("id", input.receipt_document_id)
    .maybeSingle();
  if (receiptErr || !receipt) throw new Error("RECEIPT_NOT_FOUND: ไม่พบหลักฐานการรับเงิน");
  if (!["transfer_slip", "payment_advice"].includes(String(receipt.document_type))) {
    throw new Error(`RECEIPT_NOT_PAYMENT_EVIDENCE: document_type=${receipt.document_type} ไม่ใช่หลักฐานการจ่าย (v1.1 §5)`);
  }
  const { count: existing } = await db
    .from("payment_allocations")
    .select("id", { count: "exact", head: true })
    .eq("receipt_document_id", input.receipt_document_id);
  if ((existing ?? 0) > 0) {
    throw new Error("PAYMENT_ALREADY_ALLOCATED: สลิปนี้ถูกจัดสรรแล้ว — ใช้ payment.reallocated แทนการเขียนซ้ำ");
  }

  const totalAllocated = round2(input.allocations.reduce((s, a) => s + a.amount, 0));
  if (totalAllocated <= 0) throw new Error("PAYMENT_AMOUNT_INVALID: ยอดจัดสรรต้องมากกว่าศูนย์");

  let debtEventId: string | null = null;
  if (input.debt_event_anchor && receipt.customer_company_id) {
    const ev = await appendDebtEvent({
      customer_company_id: String(receipt.customer_company_id),
      event_type: input.debt_event_anchor.event_type,
      amount: input.debt_event_anchor.amount,
      note: input.debt_event_anchor.note ?? null,
      source: "payment_confirmation",
      actor: input.actor,
      evidence: { receipt_document_id: input.receipt_document_id, media_path: receipt.media_path ?? null },
    });
    debtEventId = String(ev.id);
  }

  const rows = input.allocations.map((a) => ({
    receipt_document_id: input.receipt_document_id,
    invoice_id: a.target.kind === "invoice" ? a.target.id : null,
    standalone_document_id: a.target.kind === "standalone_document" ? a.target.id : null,
    debt_event_id:
      a.target.kind === "debt_event" ? a.target.id : a.target.kind === "anchor" ? requireAnchor(debtEventId) : null,
    allocation_kind: a.allocation_kind,
    amount: a.amount,
    allocated_by: input.actor,
    note: a.note ?? null,
  }));
  const { data: written, error } = await db.from("payment_allocations").insert(rows).select("id");
  if (error) throw new Error(`บันทึกการจัดสรรเงินไม่สำเร็จ: ${error.message}`);

  const invoiceIds = [
    ...new Set(input.allocations.filter((a) => a.target.kind === "invoice").map((a) => (a.target as { id: string }).id)),
  ];
  const invoices = [];
  for (const id of invoiceIds) invoices.push(await refreshInvoiceProjection(id));
  const state = await refreshReceiptAllocationState(input.receipt_document_id);

  const { error: stErr } = await db
    .from("receipt_documents")
    .update({ status: "confirmed", payment_verified: true, updated_at: new Date().toISOString() })
    .eq("id", input.receipt_document_id);
  if (stErr) throw new Error(`ยืนยันสลิปไม่สำเร็จ: ${stErr.message}`);

  let snapshot: Record<string, unknown> | null = null;
  if (receipt.customer_company_id) {
    const projection = await refreshDebtSnapshotFromLedger(String(receipt.customer_company_id), input.actor);
    snapshot = projection as unknown as Record<string, unknown>;
  }

  await recordCanonicalAudit({
    action: "payment.allocated",
    entity_type: "receipt_document",
    entity_id: input.receipt_document_id,
    actor: input.actor,
    company_id: (receipt.customer_company_id as string) ?? null,
    new_value: { allocations: input.allocations.length, total: totalAllocated, allocation_state: state },
    evidence: {
      allocation_ids: (written ?? []).map((w: Record<string, unknown>) => String(w.id)),
      debt_event_id: debtEventId,
      media_path: receipt.media_path ?? null,
    },
  });

  return {
    receipt_document_id: input.receipt_document_id,
    allocations_written: (written ?? []).length,
    allocation_ids: (written ?? []).map((w: Record<string, unknown>) => String(w.id)),
    debt_event_id: debtEventId,
    refreshed: { receipt_allocation_state: state, invoices, debt_snapshot: snapshot },
  };
}

/** Move an existing allocation to another target — evidence is appended, totals are re-projected. */
export async function reallocatePayment(input: {
  allocation_id: string;
  new_target: AllocationTarget;
  new_amount?: number;
  actor: string;
  reason: string;
}) {
  const db = supabaseAdmin();
  const { data: allocation } = await db.from("payment_allocations").select("*").eq("id", input.allocation_id).maybeSingle();
  if (!allocation) throw new Error("ALLOCATION_NOT_FOUND: ไม่พบรายการจัดสรรเดิม");
  if (!input.reason?.trim()) throw new Error("REALLOCATION_REASON_REQUIRED: ต้องระบุเหตุผล");

  const patch = {
    invoice_id: input.new_target.kind === "invoice" ? input.new_target.id : null,
    standalone_document_id: input.new_target.kind === "standalone_document" ? input.new_target.id : null,
    debt_event_id: input.new_target.kind === "debt_event" ? input.new_target.id : allocation.debt_event_id,
    amount: input.new_amount ?? allocation.amount,
  };
  const { error } = await db.from("payment_allocations").update(patch).eq("id", input.allocation_id);
  if (error) throw new Error(`ย้ายการจัดสรรไม่สำเร็จ: ${error.message}`);

  const affected = [
    ...new Set(
      [String(allocation.invoice_id ?? ""), input.new_target.kind === "invoice" ? input.new_target.id : ""].filter(Boolean),
    ),
  ];
  for (const id of affected) await refreshInvoiceProjection(id);
  await refreshReceiptAllocationState(String(allocation.receipt_document_id));

  await recordCanonicalAudit({
    action: "payment.reallocated",
    entity_type: "payment_allocation",
    entity_id: input.allocation_id,
    actor: input.actor,
    old_value: { invoice_id: allocation.invoice_id, standalone_document_id: allocation.standalone_document_id, amount: allocation.amount },
    new_value: patch,
    evidence: { reason: input.reason, receipt_document_id: allocation.receipt_document_id },
  });

  return { allocation_id: input.allocation_id, ...patch };
}

