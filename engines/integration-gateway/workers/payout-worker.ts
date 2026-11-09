// Integration Gateway — KBank Payout Worker (Phase 4).
//
// Role: EXECUTE the payout for a `customer_orders` row that is already
// marked 'PAID' by the Reconcile engine — but ONLY after a human (owner/admin)
// approves it. This enforces "DNA OS = Tool, Not Judge".
//
// New flow:
//   1. requestPayoutApproval(orderId)     — order PAID -> PAYOUT_PENDING_APPROVAL
//   2. human approves via audit API        — PAYOUT_PENDING_APPROVAL -> PAYOUT_APPROVED
//   3. executeApprovedPayout(orderId, actor)  — PAYOUT_APPROVED -> sendPayout -> SETTLED
//
// The worker will NOT auto-pay. Money moves only on an explicit approved
// run. Every decision is logged to public.payout_audit_log.

import { supabaseAdmin } from "@/services/supabase/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPayoutPayload,
  KBankPayoutPayload,
  PayoutOptions,
  sendPayout,
} from "@/services/kbank/kapi-payout";

/** Options carried through the payout worker. */
export interface PayoutWorkerOptions extends PayoutOptions {
  /** Supabase service_role client (injected for testability). Defaults to
   * supabaseAdmin() when omitted. */
  db?: SupabaseClient;
  /** Payout amount decided by the caller (e.g. the admin approval route, which
   * resolves it from invoices.total_amount). When omitted the worker resolves
   * the amount itself from the order's invoices. Never falls back to a
   * hardcoded placeholder. */
  amount?: number;
}

/** Invoice statuses that represent real money owed (DRAFT is not issued yet,
 * VOID is cancelled). */
const PAYABLE_INVOICE_STATUSES = ["SENT", "PARTIALLY_PAID", "PAID"];

/**
 * Sum invoices.total_amount for the order's payable invoices.
 * Returns 0 when the order has no payable invoice — callers must treat 0 as
 * "cannot pay" and fail closed instead of sending a made-up amount.
 */
async function resolveInvoiceAmount(
  db: SupabaseClient,
  orderId: string,
): Promise<number> {
  const { data, error } = await db
    .from("invoices")
    .select("id, total_amount, invoice_status")
    .eq("customer_order_id", orderId);

  if (error) {
    console.error(
      `[payout-worker] invoice lookup failed for order ${orderId}: ${error.message}`,
    );
    return 0;
  }

  if (!Array.isArray(data)) return 0;

  let total = 0;
  for (const invoice of data as Array<{
    total_amount?: unknown;
    invoice_status?: unknown;
  }>) {
    const status = String(invoice.invoice_status ?? "").toUpperCase();
    if (!PAYABLE_INVOICE_STATUSES.includes(status)) continue;
    const value = Number(invoice.total_amount ?? 0);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

// ------------------------------------------------------------------
// Step 1 — requestPayoutApproval: PAID -> PAYOUT_PENDING_APPROVAL
// ------------------------------------------------------------------

/**
 * Request payout approval for a single paid order.
 *
 * Transitions the order:
 *   PAID -> PAYOUT_PENDING_APPROVAL
 *
 * Does NOT call sendPayout(). Returns true if the order was transitioned,
 * false if the order was not in 'PAID' state (skipped).
 *
 * Also inserts a `request` audit row so the owner can see who requested
 * what and when.
 */
export async function requestPayoutApproval(
  orderId: string,
  options: PayoutWorkerOptions = {},
): Promise<boolean> {
  const db = options.db ?? supabaseAdmin();

  // 1. Fetch the order. No amount is read here: requesting approval only
  //    moves PAID -> PAYOUT_PENDING_APPROVAL, and customer_orders has no
  //    amount column (money lives on the invoices).
  const { data: order, error: fetchError } = await db
    .from("customer_orders")
    .select("id, order_no, project_id, document_group_id, status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    console.error(
      `[requestPayoutApproval] order ${orderId} not found: ${fetchError?.message}`,
    );
    return false;
  }

  const status = typeof order.status === "string" ? order.status.toUpperCase() : "";

  if (status !== "PAID") {
    console.warn(
      `[requestPayoutApproval] order ${order.order_no} (id ${order.id}) status '${order.status}' is not PAID — skipped`,
    );
    return false;
  }

  // 2. Transition PAID -> PAYOUT_PENDING_APPROVAL.
  const { error: updateError } = await db
    .from("customer_orders")
    .update({
      status: "PAYOUT_PENDING_APPROVAL",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "PAID");

  if (updateError) {
    console.error(
      `[requestPayoutApproval] failed to mark order ${order.order_no} pending_approval: ${updateError.message}`,
    );
    return false;
  }

  // 3. Log the approval-request.
  await db.from("payout_audit_log").insert({
    order_id: order.id,
    action: "request",
    actor_id: null,
    reason: "payout approval requested",
    created_at: new Date().toISOString(),
  });

  console.log(
    `[requestPayoutApproval] order ${order.order_no} (id ${order.id}) marked PAYOUT_PENDING_APPROVAL`,
  );
  return true;
}

// ------------------------------------------------------------------
// Step 3 — executeApprovedPayout: approved -> sendPayout -> SETTLED
// ------------------------------------------------------------------

/**
 * Execute the payout for an APPROVED order.
 *
 * Transitions the order:
 *   PAYOUT_APPROVED -> (sendPayout) -> SETTLED
 *   PAYOUT_APPROVED -> (failure)    -> PAYOUT_FAILED
 *
 * Logs approve / execute / reject decisions to audit.
 *
 * Returns a summary { success, failed } for the caller.
 */
export async function executeApprovedPayout(
  orderId: string,
  approverId: string,
  options: PayoutWorkerOptions = {},
): Promise<{ success: number; failed: number }> {
  const db = options.db ?? supabaseAdmin();

  // 1. Fetch the order.
  const { data: order, error: fetchError } = await db
    .from("customer_orders")
    .select("id, order_no, project_id, document_group_id, status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    console.error(
      `[executeApprovedPayout] order ${orderId} not found: ${fetchError?.message}`,
    );
    return { success: 0, failed: 0 };
  }

  const status = typeof order.status === "string" ? order.status.toUpperCase() : "";

  if (status !== "PAYOUT_APPROVED") {
    console.warn(
      `[executeApprovedPayout] order ${order.order_no} (id ${order.id}) status '${order.status}' is not PAYOUT_APPROVED — skipped`,
    );
    return { success: 0, failed: 0 };
  }

  // 2. Resolve the real payout amount. customer_orders has NO amount column:
  //    the money lives on the invoices, so the caller may pass the amount it
  //    already resolved, otherwise the worker resolves it here itself.
  const amountSource = options.amount !== undefined ? "options" : "invoices";
  const resolvedAmount =
    options.amount !== undefined
      ? Number(options.amount)
      : await resolveInvoiceAmount(db, order.id);

  // Fail closed: never send a placeholder or a bogus number to the bank.
  if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
    const failReason =
      "no payable invoice amount for this order; refusing to send a placeholder amount to KBank";

    const { error: updateError } = await db
      .from("customer_orders")
      .update({
        status: "PAYOUT_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "PAYOUT_APPROVED");

    if (updateError) {
      console.error(
        `[executeApprovedPayout] failed to mark order ${order.order_no} as PAYOUT_FAILED: ${updateError.message}`,
      );
    }

    await db.from("payout_audit_log").insert({
      order_id: order.id,
      action: "reject",
      actor_id: approverId,
      reason: failReason,
      created_at: new Date().toISOString(),
    });

    console.error(
      `[executeApprovedPayout] ${failReason} (order ${order.order_no}, id ${order.id}, resolved ${resolvedAmount})`,
    );
    return { success: 0, failed: 1 };
  }

  const orderAmount = resolvedAmount.toFixed(2);

  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[executeApprovedPayout] amount=${orderAmount} source=${amountSource} order=${order.order_no}`,
    );
  }

  const shopFee = "5.00";
  const partnerAmount = String(Math.max(0, Number(orderAmount) - Number(shopFee)));

  // 3. Build the payout payload.
  const payload = buildPayoutPayload(
    {
      slug: "kbiz",
      projectId: order.project_id,
      projectKey: order.document_group_id,
      db,
    },
    order.id,
    orderAmount,
  );

  // 4. Call the KBank payout API (wrap in try/catch).
  let result: Record<string, unknown>;
  try {
    result = await sendPayout("kbiz", payload, {
      slug: "kbiz",
      projectId: order.project_id,
      projectKey: order.document_group_id,
      db,
    });
  } catch (err) {
    const message = err ? String(err) : "unknown";

    // Log reject + fail-closed at DB level.
    const { error: updateError } = await db
      .from("customer_orders")
      .update({
        status: "PAYOUT_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "PAYOUT_APPROVED");

    if (updateError) {
      console.error(
        `[executeApprovedPayout] failed to mark order ${order.order_no} as PAYOUT_FAILED`,
      );
    }

    // 5. Log the rejection to audit.
    await db.from("payout_audit_log").insert({
      order_id: order.id,
      action: "reject",
      actor_id: approverId,
      reason: `payout API rejected: ${message}`,
      created_at: new Date().toISOString(),
    });

    console.error(
      `[executeApprovedPayout] payout failed for order ${order.order_no} (id ${order.id}): ${message}`,
    );
    return { success: 0, failed: 1 };
  }

  // 6. On success: mark the order SETTLED.
  const { error: updateError } = await db
    .from("customer_orders")
    .update({
      status: "SETTLED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "PAYOUT_APPROVED");

  if (updateError) {
    console.error(
      `[executeApprovedPayout] failed to mark order ${order.order_no} settled`,
    );
    // The payout was sent but the flag update failed; the order is still in
    // 'PAID' and can be retried. Log and continue.
  }

  // 7. Log the execution to audit.
  await db.from("payout_audit_log").insert({
    order_id: order.id,
    action: "execute",
    actor_id: approverId,
    reason: "payout approved and executed by human",
    created_at: new Date().toISOString(),
  });

  console.log(
    `[executeApprovedPayout] payout sent for order ${order.order_no} (id ${order.id}): token ${String(result?.token ?? "")}`,
  );
  return { success: 1, failed: 0 };
}

// ------------------------------------------------------------------
// Optional backward-compat legacy wrapper — do NOT use for new flows.
// ------------------------------------------------------------------

/**
 * DEPRECATED: this is the old auto-pay flow. Exists only to run the
 * existing E2E test before it is updated. Do NOT call in production.
 */
export async function processOrderPayout(
  orderId: string,
  options: PayoutWorkerOptions = {},
): Promise<{ success: number; failed: number }> {
  const db = options.db ?? supabaseAdmin();

  const { data: order, error: fetchError } = await db
    .from("customer_orders")
    .select("id, order_no, project_id, document_group_id, status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    console.error(
      `[processOrderPayout] order ${orderId} not found: ${fetchError?.message}`,
    );
    return { success: 0, failed: 0 };
  }

  const status = typeof order.status === "string" ? order.status.toUpperCase() : "";

  if (status !== "PAID") {
    console.warn(
      `[processOrderPayout] order ${order.order_no} (id ${order.id}) status '${order.status}' is not PAID — skipped`,
    );
    return { success: 0, failed: 0 };
  }

  // Legacy: auto-send payout (removed from flow, kept for test compat only).
  // No amount column exists on customer_orders, so derive it from the invoices
  // exactly like the approved path — never a hardcoded placeholder.
  const resolvedAmount =
    options.amount !== undefined
      ? Number(options.amount)
      : await resolveInvoiceAmount(db, order.id);

  if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
    console.error(
      `[processOrderPayout] no payable invoice amount for order ${order.order_no} (id ${order.id}); refusing to send a placeholder amount to KBank`,
    );
    return { success: 0, failed: 1 };
  }

  const orderAmount = resolvedAmount.toFixed(2);

  const shopFee = "5.00";
  const partnerAmount = String(Math.max(0, Number(orderAmount) - Number(shopFee)));

  const payPayload = buildPayoutPayload(
    { slug: "kbiz", projectId: order.project_id, projectKey: order.document_group_id, db },
    order.id,
    orderAmount,
  );

  let result: Record<string, unknown>;
  try {
    result = await sendPayout("kbiz", payPayload, {
      slug: "kbiz",
      projectId: order.project_id,
      projectKey: order.document_group_id,
      db,
    });
  } catch (err) {
    const message = err ? String(err) : "unknown";

    const { error: updateError } = await db
      .from("customer_orders")
      .update({ status: "PAYOUT_FAILED", updated_at: new Date().toISOString() })
      .eq("id", order.id)
      .eq("status", "PAID");

    if (updateError) {
      console.error(`[processOrderPayout] failed to mark ${order.order_no} PAYOUT_FAILED`);
    }
    return { success: 0, failed: 1 };
  }

  const { error: updateError2 } = await db
    .from("customer_orders")
    .update({ status: "SETTLED", updated_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", "PAID");

  if (updateError2) {
    console.error(`[processOrderPayout] failed to mark ${order.order_no} SETTLED`);
  }
  return { success: 1, failed: 0 };
}

// ------------------------------------------------------------------
// reconcilePayouts — drives requestPayoutApproval only.
// ------------------------------------------------------------------

/** The set of order ids processed by a single full run. */
interface RunResult {
  orders: ProcessedOrder[];
  succeeded: number;
  failed: number;
}

/** Processed order result. */
interface ProcessedOrder {
  order_id: string;
  status: "settled" | "failed";
}

/**
 * Process all outstanding PAID orders through the approval gate.
 *
 * For each PAID order, calls requestPayoutApproval(), which transitions
 * the order to PAYOUT_PENDING_APPROVAL and logs a `request` audit row.
 * No money moves — the order is simply queued for human approval.
 *
 * Safe to call repeatedly: already-approved, already-settled, or already-
 * failed orders are not re-processed.
 */
export async function reconcilePayouts(
  options: PayoutWorkerOptions = {},
): Promise<RunResult> {
  const db = options.db ?? supabaseAdmin();

  const { data: orders, error: readError } = await db
    .from("customer_orders")
    .select("id, order_no, status")
    .eq("status", "PAID")
    .order("order_no", { ascending: true });

  if (readError) {
    console.error(
      `[reconcilePayouts] failed to read PAID orders: ${readError.message}`,
    );
    return { orders: [], succeeded: 0, failed: 0 };
  }

  const rows = (orders ?? []) as { id: string; order_no: string; status: string }[];

  const results: ProcessedOrder[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const approved = await requestPayoutApproval(row.id, options);
    results.push({
      order_id: row.id,
      status: approved ? "settled" : "failed",
    });
    succeeded += 1;
    failed += 0;
  }

  return { orders: results, succeeded, failed };
}
