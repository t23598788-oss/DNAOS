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
  const db = paymentWriteClient();
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

// ── B-04R3 · RPC adapter ─────────────────────────────────────────────────────
//
// The final monetary commit happens in PostgreSQL (confirm_payment_allocation /
// reallocate_payment_allocation). This writer stays the canonical business authority:
// it normalises input, runs the fail-fast application guards and maps the RPC result
// back to the same contract callers already use. It performs NO monetary write itself
// and has NO fallback path — if the RPC is missing or refuses, the call fails closed.

type PaymentWriteClient = ReturnType<typeof supabaseAdmin>;

let injectedClient: PaymentWriteClient | null = null;

/**
 * Internal seam for the adapter tests (B-04R3): lets a test observe the exact RPC
 * payload and prove that nothing outside the RPC writes a monetary row.
 * Production code never calls it — the writer always uses supabaseAdmin().
 */
export function __setPaymentWriteClientForTest(client: PaymentWriteClient | null): void {
  injectedClient = client;
}

function paymentWriteClient(): PaymentWriteClient {
  return injectedClient ?? supabaseAdmin();
}

/**
 * Deterministic RPC-error → canonical PAYMENT_* mapping. PostgREST surfaces the
 * `raise exception` text verbatim, so a stable prefix match is enough; anything
 * unrecognised fails closed as PAYMENT_RPC_FAILED (never silently retried).
 */
const PAYMENT_RPC_ERRORS: Record<string, string> = {
  actor_required: "AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor",
  receipt_not_found: "RECEIPT_NOT_FOUND: ไม่พบหลักฐานการรับเงิน",
  receipt_not_eligible: "RECEIPT_NOT_PAYMENT_EVIDENCE: เอกสารนี้ไม่ใช่หลักฐานการจ่าย (transfer_slip/payment_advice)",
  receipt_amount_required: "PAYMENT_RECEIPT_AMOUNT_REQUIRED: receipt ไม่มียอดเงิน (canonical amount) — จัดสรรไม่ได้",
  receipt_already_allocated: "PAYMENT_ALREADY_ALLOCATED: สลิปนี้ถูกจัดสรรแล้ว — ใช้ payment.reallocated แทนการเขียนซ้ำ",
  allocation_required: "PAYMENT_ALLOCATION_REQUIRED: ต้องระบุเป้าหมายการจัดสรรอย่างน้อย 1 รายการ",
  allocation_kind_invalid: "PAYMENT_AMOUNT_INVALID: allocation_kind ต้องเป็น principal/interest/penalty/other",
  allocation_amount_invalid: "PAYMENT_AMOUNT_INVALID: ยอดจัดสรรต้องมากกว่าศูนย์",
  target_invalid: "PAYMENT_TARGET_INVALID: เป้าหมายการจัดสรรไม่ถูกต้อง",
  anchor_required: "PAYMENT_ANCHOR_REQUIRED: allocation แบบ anchor ต้องมี debt_event_anchor ในคำขอเดียวกัน",
  anchor_amount_required: "PAYMENT_ANCHOR_REQUIRED: ยอด anchor ต้องมากกว่าศูนย์",
  anchor_event_type_invalid: "PAYMENT_ANCHOR_REQUIRED: event_type ของ anchor ไม่ถูกต้อง",
  invoice_not_found: "PAYMENT_INVOICE_NOT_FOUND: ไม่พบใบแจ้งหนี้ใน canonical read",
  invoice_void: "PAYMENT_INVOICE_VOID: ห้ามจัดสรรเงินเข้าใบแจ้งหนี้ที่ถูกยกเลิก (VOID)",
  company_mismatch: "PAYMENT_COMPANY_MISMATCH: บริษัทของ receipt ไม่ตรงกับบริษัทของ invoice",
  receipt_total_exceeded: "PAYMENT_RECEIPT_TOTAL_EXCEEDED: จัดสรรรวมของ receipt นี้เกินยอด receipt",
  overpayment_not_allowed: "PAYMENT_OVERPAYMENT_NOT_ALLOWED: ขอจัดสรรเกินยอดคงค้างของ invoice — ต้องมีคำสั่งจัดสรรส่วนที่เหลืออย่างชัดเจน",
  allocation_not_found: "ALLOCATION_NOT_FOUND: ไม่พบรายการจัดสรรเดิม",
  reallocation_reason_required: "REALLOCATION_REASON_REQUIRED: ต้องระบุเหตุผล",
};

export function mapPaymentRpcError(raw: string): string {
  const text = String(raw ?? "");
  const hit = Object.keys(PAYMENT_RPC_ERRORS).find((code) => text.includes(code));
  return hit ? PAYMENT_RPC_ERRORS[hit] : `PAYMENT_RPC_FAILED: ${text || "ไม่ทราบสาเหตุ"}`;
}

/**
 * Confirm a payment with real evidence: allocation rows + ledger rows + projections.
 * Refuses to write when the receipt is not payment evidence or is already allocated
 * (idempotency guard — the same money is never counted twice).
 */
/**
 * Confirm a payment with real evidence.
 *
 * Fail-fast guards run first (reads only, so a caller gets an immediate, specific
 * error), then the SINGLE monetary commit goes through the atomic RPC
 * `confirm_payment_allocation` — allocation rows, ledger event, invoice projection,
 * receipt state, snapshot and audit all commit in one transaction. Nothing here
 * writes a monetary row, and there is no fallback: an unavailable or refusing RPC
 * fails closed.
 */
export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  const db = paymentWriteClient();
  if (!input.allocations.length) throw new Error("PAYMENT_ALLOCATION_REQUIRED: ต้องระบุเป้าหมายการจัดสรรอย่างน้อย 1 รายการ");
  if (!input.actor?.trim()) throw new Error("AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor");

  // ── fail-fast application guards (reads only — never the final authority) ──
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
  assertReceiptAllocationTotal({
    receiptAmount: receipt.amount === null || receipt.amount === undefined ? null : Number(receipt.amount),
    alreadyAllocatedTotal: 0,
    requestedNetNew: totalAllocated,
  });

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

  // ── the ONLY monetary commit: one atomic RPC call (fail closed) ────────────
  const { data, error } = await db.rpc("confirm_payment_allocation", {
    p_receipt_document_id: input.receipt_document_id,
    p_allocations: input.allocations.map((a) => ({
      target_kind: a.target.kind,
      target_id: a.target.kind === "anchor" ? null : a.target.id,
      allocation_kind: a.allocation_kind,
      amount: a.amount,
      note: a.note ?? null,
    })),
    p_actor: input.actor,
    p_debt_event_anchor: input.debt_event_anchor?.event_type ?? null,
  });
  if (error) throw new Error(mapPaymentRpcError(error.message));

  const result = (data ?? {}) as Record<string, unknown>;

  // read-only projection read so the result contract stays exactly what it was
  // (the RPC already refreshed the snapshot inside the transaction)
  let snapshot: Record<string, unknown> | null = null;
  if (receipt.customer_company_id) {
    const { data: snap } = await db
      .from("debt_snapshots")
      .select("*")
      .eq("customer_company_id", String(receipt.customer_company_id))
      .maybeSingle();
    snapshot = (snap as Record<string, unknown>) ?? null;
  }

  return {
    receipt_document_id: String(result.receipt_document_id ?? input.receipt_document_id),
    allocations_written: Number(result.allocations_written ?? input.allocations.length),
    allocation_ids: Array.isArray(result.allocation_ids) ? (result.allocation_ids as string[]) : [],
    debt_event_id: (result.debt_event_id as string) ?? null,
    refreshed: {
      receipt_allocation_state: (result.receipt_allocation_state as ConfirmPaymentResult["refreshed"]["receipt_allocation_state"]) ?? "partial",
      invoices: Array.isArray(result.invoices)
        ? (result.invoices as ConfirmPaymentResult["refreshed"]["invoices"])
        : [],
      debt_snapshot: snapshot,
    },
  };
}

/** Move an existing allocation to another target — evidence is appended, totals are re-projected. */
/**
 * Move an existing allocation to another target — RPC-backed.
 *
 * Fail-fast guards (reads only) then the single atomic commit via
 * `reallocate_payment_allocation`: exactly one target id survives, the moved row is
 * never copied, the receipt total never grows, both invoices are re-projected and the
 * historical debt_event is left untouched (attribution change, not history rewrite).
 */
export async function reallocatePayment(input: {
  allocation_id: string;
  new_target: AllocationTarget;
  new_amount?: number;
  actor: string;
  reason: string;
}) {
  const db = paymentWriteClient();
  if (!input.reason?.trim()) throw new Error("REALLOCATION_REASON_REQUIRED: ต้องระบุเหตุผล");
  if (!input.actor?.trim()) throw new Error("AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor");
  if (input.new_target.kind === "anchor") {
    // an anchor id exists only inside the confirmPayment() call that creates it
    throw new Error("PAYMENT_TARGET_ANCHOR_NOT_ALLOWED: การย้าย allocation ต้องระบุเป้าหมายจริง (invoice / standalone_document / debt_event)");
  }

  // ── fail-fast guards (reads only) ──────────────────────────────────────────
  const { data: allocation } = await db
    .from("payment_allocations")
    .select("*")
    .eq("id", input.allocation_id)
    .maybeSingle();
  if (!allocation) throw new Error("ALLOCATION_NOT_FOUND: ไม่พบรายการจัดสรรเดิม");

  const newAmount = input.new_amount === undefined ? round2(Number(allocation.amount ?? 0)) : round2(Number(input.new_amount));
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

  // ── the ONLY monetary commit: one atomic RPC call (fail closed) ────────────
  const { data, error } = await db.rpc("reallocate_payment_allocation", {
    p_allocation_id: input.allocation_id,
    p_target_kind: input.new_target.kind,
    p_target_id: input.new_target.id,
    p_amount: newAmount,
    p_actor: input.actor,
    p_reason: input.reason,
  });
  if (error) throw new Error(mapPaymentRpcError(error.message));

  const result = (data ?? {}) as Record<string, unknown>;
  return {
    allocation_id: input.allocation_id,
    ...allocationTargetIds(input.new_target),
    amount: round2(Number(result.amount ?? newAmount)),
  };
}
