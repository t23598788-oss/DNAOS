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

/** The three target columns of payment_allocations — DB CHECK requires exactly ONE non-null. */
export interface AllocationTargetIds {
  invoice_id: string | null;
  standalone_document_id: string | null;
  debt_event_id: string | null;
}

/**
 * Target ids for a write — **always clears the other two targets** so a move can never
 * leave a stale id behind (the bug that made anchor→invoice reallocation hit
 * `payment_allocations_one_target_chk`). Pure: no DB, no behaviour of its own.
 */
export function allocationTargetIds(target: AllocationTarget, anchorDebtEventId: string | null = null): AllocationTargetIds {
  switch (target.kind) {
    case "invoice":
      return { invoice_id: target.id, standalone_document_id: null, debt_event_id: null };
    case "standalone_document":
      return { invoice_id: null, standalone_document_id: target.id, debt_event_id: null };
    case "debt_event":
      return { invoice_id: null, standalone_document_id: null, debt_event_id: target.id };
    case "anchor":
      return { invoice_id: null, standalone_document_id: null, debt_event_id: requireAnchor(anchorDebtEventId) };
  }
}

export interface InvoiceAllocationGuardInput {
  requestedAmount: number;
  /** canonical outstanding (invoice_payment_summary) — null means it could not be read */
  invoiceOutstanding: number | null;
  invoiceStatus: string | null;
  receiptCompanyId: string | null;
  invoiceCompanyId: string | null;
}

/**
 * Invoice-level allocation guard — owner policy (2026-09-23), fail-closed:
 *   · overpayment of an invoice is NOT allowed (amount > outstanding ⇒ throw)
 *   · the amount is NEVER clamped, and the excess is NEVER rewritten as penalty,
 *     credit or another invoice
 *   · VOID invoices, mismatched companies and unreadable outstanding all throw
 *     instead of guessing. Pure: the caller does the canonical reads.
 */
export function assertInvoiceAllocationAllowed(g: InvoiceAllocationGuardInput): void {
  const requested = round2(Number(g.requestedAmount));
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error(`PAYMENT_AMOUNT_INVALID: ยอดจัดสรรต้องมากกว่าศูนย์ (ได้ ${g.requestedAmount})`);
  }
  if (g.invoiceStatus === "VOID") {
    throw new Error("PAYMENT_INVOICE_VOID: ห้ามจัดสรรเงินเข้าใบแจ้งหนี้ที่ถูกยกเลิก (VOID)");
  }
  if (!g.receiptCompanyId || !g.invoiceCompanyId) {
    throw new Error("PAYMENT_COMPANY_UNKNOWN: ต้องอ่านบริษัทของทั้ง receipt และ invoice ได้ก่อนจัดสรร");
  }
  if (g.receiptCompanyId !== g.invoiceCompanyId) {
    throw new Error(`PAYMENT_COMPANY_MISMATCH: receipt อยู่บริษัท ${g.receiptCompanyId} แต่ invoice อยู่บริษัท ${g.invoiceCompanyId}`);
  }
  if (g.invoiceOutstanding === null || g.invoiceOutstanding === undefined || !Number.isFinite(Number(g.invoiceOutstanding))) {
    throw new Error("PAYMENT_OUTSTANDING_UNKNOWN: อ่านยอดคงค้างของ invoice จาก canonical read ไม่ได้");
  }
  const outstanding = round2(Number(g.invoiceOutstanding));
  if (requested > outstanding) {
    throw new Error(
      `PAYMENT_OVERPAYMENT_NOT_ALLOWED: ขอจัดสรร ${requested} เกินยอดคงค้าง ${outstanding} — ` +
        "ต้องมีคำสั่งจัดสรรส่วนที่เหลืออย่างชัดเจน (ห้าม clamp / ห้ามเปลี่ยนเป็น penalty / ห้ามกระจายใบอื่นอัตโนมัติ)",
    );
  }
}

/**
 * Receipt-level money invariant: Σ allocations of one receipt ≤ receipt.amount.
 * Reallocation must subtract the row being MOVED before adding it back — moving money
 * is never new money (no double counting). Pure; caller supplies persisted totals.
 */
export function assertReceiptAllocationTotal(g: {
  receiptAmount: number | null;
  alreadyAllocatedTotal: number;
  requestedNetNew: number;
}): void {
  if (g.receiptAmount === null || g.receiptAmount === undefined || !Number.isFinite(Number(g.receiptAmount))) {
    throw new Error("PAYMENT_RECEIPT_AMOUNT_REQUIRED: receipt ไม่มียอดเงิน (canonical amount) — จัดสรรไม่ได้");
  }
  const limit = round2(Number(g.receiptAmount));
  const after = round2(round2(Number(g.alreadyAllocatedTotal) || 0) + round2(Number(g.requestedNetNew) || 0));
  if (after > limit) {
    throw new Error(`PAYMENT_RECEIPT_TOTAL_EXCEEDED: จัดสรรรวมของ receipt นี้ ${after} เกินยอด receipt ${limit}`);
  }
}

/** Canonical reads for the guard: outstanding/status from the canonical view + the invoices row. */
async function invoiceGuardFacts(invoiceId: string) {
  const db = supabaseAdmin();
  const [{ data: summary }, { data: inv }] = await Promise.all([
    db.from("invoice_payment_summary").select("invoice_id, outstanding, derived_status").eq("invoice_id", invoiceId).maybeSingle(),
    db.from("invoices").select("id, customer_company_id, invoice_status").eq("id", invoiceId).maybeSingle(),
  ]);
  if (!summary || !inv) {
    throw new Error(`PAYMENT_INVOICE_NOT_FOUND: ไม่พบใบแจ้งหนี้ ${invoiceId} ใน canonical read (invoice_payment_summary/invoices)`);
  }
  return {
    outstanding: summary.outstanding === null || summary.outstanding === undefined ? null : Number(summary.outstanding),
    invoiceCompanyId: (inv.customer_company_id as string) ?? null,
    invoiceStatus: inv.invoice_status === null || inv.invoice_status === undefined ? null : String(inv.invoice_status),
  };
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
  const { data: existingAllocs } = await db
    .from("payment_allocations")
    .select("amount")
    .eq("receipt_document_id", input.receipt_document_id);
  if ((existingAllocs ?? []).length > 0) {
    throw new Error("PAYMENT_ALREADY_ALLOCATED: สลิปนี้ถูกจัดสรรแล้ว — ใช้ payment.reallocated แทนการเขียนซ้ำ");
  }

  const totalAllocated = round2(input.allocations.reduce((s, a) => s + a.amount, 0));
  if (totalAllocated <= 0) throw new Error("PAYMENT_AMOUNT_INVALID: ยอดจัดสรรต้องมากกว่าศูนย์");

  // I2/I11 — Σ allocations of this receipt must never exceed the receipt's canonical amount.
  // The guard above proves nothing is allocated yet, so the net-new total is the whole sum.
  assertReceiptAllocationTotal({
    receiptAmount: receipt.amount === null || receipt.amount === undefined ? null : Number(receipt.amount),
    alreadyAllocatedTotal: 0,
    requestedNetNew: totalAllocated,
  });

  // I3/I4/I5 — invoice-level guards, read from canonical sources at write time (never from the caller).
  for (const a of input.allocations) {
    if (a.target.kind !== "invoice") continue;
    const facts = await invoiceGuardFacts(a.target.id);
    assertInvoiceAllocationAllowed({
      requestedAmount: a.amount,
      invoiceOutstanding: facts.outstanding,
      invoiceStatus: facts.invoiceStatus,
      receiptCompanyId: (receipt.customer_company_id as string) ?? null,
      invoiceCompanyId: facts.invoiceCompanyId,
    });
  }

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
    // exactly ONE target id per row (DB CHECK) — allocationTargetIds clears the other two
    ...allocationTargetIds(a.target, debtEventId),
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
  if (input.new_target.kind === "anchor") {
    // an anchor id only exists inside the same confirmPayment() call that creates it —
    // a standalone move can never invent one, so this fails closed instead of guessing.
    throw new Error("PAYMENT_TARGET_ANCHOR_NOT_ALLOWED: การย้าย allocation ต้องระบุเป้าหมายจริง (invoice / standalone_document / debt_event)");
  }

  const newAmount = input.new_amount === undefined ? round2(Number(allocation.amount ?? 0)) : round2(Number(input.new_amount));

  // Receipt-level invariant: moving money is NOT new money — subtract the row being moved first.
  const { data: receiptRow } = await db
    .from("receipt_documents")
    .select("amount, customer_company_id")
    .eq("id", allocation.receipt_document_id)
    .maybeSingle();
  const { data: allocRows } = await db
    .from("payment_allocations")
    .select("amount")
    .eq("receipt_document_id", allocation.receipt_document_id);
  const persistedTotal = round2((allocRows ?? []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount ?? 0), 0));
  assertReceiptAllocationTotal({
    receiptAmount: receiptRow?.amount === null || receiptRow?.amount === undefined ? null : Number(receiptRow.amount),
    alreadyAllocatedTotal: round2(persistedTotal - Number(allocation.amount ?? 0)),
    requestedNetNew: newAmount,
  });

  // Invoice-level guards against the DESTINATION invoice (canonical reads, never the caller's word).
  if (input.new_target.kind === "invoice") {
    const facts = await invoiceGuardFacts(input.new_target.id);
    assertInvoiceAllocationAllowed({
      requestedAmount: newAmount,
      invoiceOutstanding: facts.outstanding,
      invoiceStatus: facts.invoiceStatus,
      receiptCompanyId: (receiptRow?.customer_company_id as string) ?? null,
      invoiceCompanyId: facts.invoiceCompanyId,
    });
  }

  // Never leave a stale target id behind: exactly one target column stays non-null (DB CHECK).
  const patch = { ...allocationTargetIds(input.new_target), amount: newAmount };
  const { error } = await db.from("payment_allocations").update(patch).eq("id", input.allocation_id);
  if (error) throw new Error(`ย้ายการจัดสรรไม่สำเร็จ: ${error.message}`);

  // Refresh BOTH sides: the invoice money moved away from must lose this allocation too.
  const affected = [
    ...new Set([String(allocation.invoice_id ?? ""), String(patch.invoice_id ?? "")].filter(Boolean)),
  ];
  for (const id of affected) await refreshInvoiceProjection(id);
  await refreshReceiptAllocationState(String(allocation.receipt_document_id));

  await recordCanonicalAudit({
    action: "payment.reallocated",
    entity_type: "payment_allocation",
    entity_id: input.allocation_id,
    actor: input.actor,
    old_value: { invoice_id: allocation.invoice_id, standalone_document_id: allocation.standalone_document_id, debt_event_id: allocation.debt_event_id, amount: allocation.amount },
    new_value: patch,
    evidence: { reason: input.reason, receipt_document_id: allocation.receipt_document_id },
  });

  return { allocation_id: input.allocation_id, ...patch };
}

