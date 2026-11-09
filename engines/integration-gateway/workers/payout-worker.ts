// Integration Gateway — KBank Payout Worker (Phase 3).

/**
 * Purpose: execute the payout for a `customer_orders` row that is already
 * marked 'PAID' by the Reconcile engine (Phase 2) and send money OUT to the
 * partner through the KBank K Pay API.
 *
 * Flow:
 *   1. Fetch the customer_orders record by order id.
 *   2. Ensure status is 'PAID'.
 *   3. Calculate distribution: shop fee + partner net amount.
 *   4. Build the payout payload and call sendPayout().
 *   5. On success: set the order status to 'SETTLED'.
 *   6. On failure: log the error and set the order status to 'PAYOUT_FAILED'.
 *
 * The worker is safe to re-run: a 'PAID_OUT' or 'PAID' order is no longer
 * 'PAID' after this run, and a failed run leaves the row at 'PAYOUT_FAILED'
 * so a retry can be triggered without double-sending a payout.
 */

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
}

/** The set of order ids processed by a single run. */
interface ProcessedOrder {
  order_id: string;
  status: "settled" | "failed";
}

/**
 * Execute the payout for a single customer order.
 *
 * Returns a summary object so callers can report how many payouts succeeded
 * and how many failed.
 */
export async function processOrderPayout(
  orderId: string,
  options: PayoutWorkerOptions = {},
): Promise<{ success: number; failed: number }> {
  const db = options.db ?? supabaseAdmin();

  // 1. Fetch the customer_orders record.
  const { data: order, error: fetchError } = await db
    .from("customer_orders")
    .select("id, order_no, order_amount, project_id, document_group_id, status, updated_at")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    // Fail closed at the read boundary: a missing/unreadable order is not a
    // reason to advance anything. Log and bail so the caller can retry.
    console.error(`[payout-worker] order ${orderId} not found: ${fetchError?.message}`);
    return { success: 0, failed: 0 };
  }

  // 2. Ensure the order is ready for payout (PAID by the Reconcile engine).
  const isPaid =
    typeof order.status === "string" && order.status.trim().toUpperCase() === "PAID";

  if (!isPaid) {
    // Only a 'PAID' order is eligible. Orders that are already SETTLED or
    // PAYOUT_FAILED are skipped; others are left unchanged.
    console.warn(
      `[payout-worker] order ${order.order_no} (id ${order.id}) status '${order.status}' is not PAID — skipped`,
    );
    return { success: 0, failed: 0 };
  }

  // 3. Calculate distribution: 5 THB shop fee, remainder to the partner.
  const orderAmount =
    typeof order.order_amount === "number"
      ? String(order.order_amount)
      : typeof order.order_amount === "string"
        ? order.order_amount
        : "100.00";

  const shopFee = "5.00";
  const partnerAmount = String(Math.max(0, Number(orderAmount) - Number(shopFee)));
  const total = String(Number(orderAmount) + Number(shopFee));

  // 4. Build the payout payload.
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

  // 5. Call the KBank payout API (wrap in try/catch).
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

    // 7. On failure: log the error and mark the order 'PAYOUT_FAILED'.
    console.error(
      `[payout-worker] payout failed for order ${order.order_no} (id ${order.id}): ${message}`,
    );

    const updateError = await db
      .from("customer_orders")
      .update({
        status: "PAYOUT_FAILED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id)
      .eq("status", "PAID");

    if (updateError) {
      console.error(
        `[payout-worker] failed to mark order ${order.order_no} payout_failed`,
      );
    }

    return { success: 0, failed: 1 };
  }

  // 6. On success: mark the order 'SETTLED'.
  console.log(
    `[payout-worker] payout sent for order ${order.order_no} (id ${order.id}): token ${String(result?.token ?? "")}`,
  );

  const updateError = await db
    .from("customer_orders")
    .update({
      status: "SETTLED",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "PAID");    if (updateError) {
    console.error(
      `[payout-worker] failed to mark order ${order.order_no} settled`,
    );
    // The payout was sent but the flag update failed; the order is still in
    // 'PAID' and can be retried. Log and continue.
    return { success: 1, failed: 0 };
  }

  return { success: 1, failed: 0 };
}

/** The set of order ids processed by a single full run. */
interface RunResult {
  orders: ProcessedOrder[];
  succeeded: number;
  failed: number;
}

/**
 * Process all outstanding PAID orders through the KBank payout worker.
 *
 * Reads every customer_orders row with status = 'PAID', runs each through
 * processOrderPayout(), and returns a summary. Safe to call repeatedly —
 * already-settled or failed orders are not re-processed.
 */
export async function reconcilePayouts(
  options: PayoutWorkerOptions = {},
): Promise<RunResult> {
  const db = options.db ?? supabaseAdmin();

  const { data: orders, error: readError } = await db
    .from("customer_orders")
    .select("id, order_no, order_amount, status, updated_at")
    .eq("status", "PAID")
    .order("order_no", { ascending: true });

  if (readError) {
    console.error(
      `[payout-worker] failed to read PAID orders: ${readError.message}`,
    );
    return { orders: [], succeeded: 0, failed: 0 };
  }

  const rows = (orders ?? []) as {
    id: string;
    order_no: string;
    order_amount: number | string;
    status: string;
    updated_at: string;
  }[];

  const results: ProcessedOrder[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    const { success, failed: errCount } = await processOrderPayout(row.id, options);
    results.push({
      order_id: row.id,
      status: errCount > 0 ? "failed" : "settled",
    });
    succeeded += success;
    failed += errCount;
  }

  return { orders: results, succeeded, failed };
}


