// Integration Gateway — Fault-based Cancellation Worker (2026-11-09).
//
// Owner's rule: DNA OS is a Tool, not a Judge. It routes the money and
// records the proof — it does not arbitrate who is right.
//
//   1. CUSTOMER_FAULT (changed mind, ordered wrong):
//        customer pays the stage-based deduction.
//        refundAmount = (order.amount * refundPercent / 100) - deductionFlat
//        status -> CANCELLED_PARTIAL_REFUND (or CANCELLED_REFUNDED at 0 deduction)
//
//   2. SELLER_FAULT (wrong specs, wrong item, with proof):
//        seller pays ALL costs — full refund, customer pays 0.
//        proofUrl is REQUIRED. status -> CANCELLED_REFUNDED.
//
// Both paths issue the refund via the KBank refund client (`sendRefund`) and
// record the decision — including the seller's liability — in
// `cancellation_evidence`.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCancellationRefund,
  type CancellationReasonType,
  type DeliveryStage,
  type RefundResult,
} from "@/services/finance/cancellation-policy";
import { buildRefundPayload, sendRefund } from "@/services/kbank/kapi-refund";

/** Options carried through the cancellation worker. */
export interface CancellationWorkerOptions {
  /** Supabase service_role client (injected for testability). */
  db?: SupabaseClient;
  /** KBank app slug used for the refund call. Defaults to "kbiz". */
  slug?: "kbiz" | "kplus" | "truemoney";
  /** ProjectID header for the refund call. */
  projectId?: string;
  /** ProjectKey header for the refund call. */
  projectKey?: string;
}

/** One row of `public.cancellation_evidence`. */
export interface CancellationEvidenceRow {
  id: string;
  order_id: string;
  reason_type: CancellationReasonType;
  proof_url: string | null;
  reason_text: string | null;
  created_at: string;
}

/**
 * Cancel an order and route the fault-based refund.
 *
 * @param orderId     customer_orders.id
 * @param reasonType  'CUSTOMER_FAULT' | 'SELLER_FAULT'
 * @param proofUrl    REQUIRED for SELLER_FAULT
 * @param reasonText  human-readable reason (recorded as evidence)
 * @param stage       truck stage that decides the customer-fault deduction
 * @param options     db client + KBank refund options
 *
 * @throws "Proof required for seller fault" when SELLER_FAULT has no proofUrl
 */
export async function cancelOrderWithRefund(
  orderId: string,
  reasonType: CancellationReasonType,
  proofUrl?: string,
  reasonText?: string,
  stage: DeliveryStage = "CANCELLED_PICKED_UP",
  options: CancellationWorkerOptions = {},
): Promise<RefundResult> {
  const db = options.db;
  if (!db) {
    throw new Error("cancelOrderWithRefund: a Supabase client is required");
  }

  // 1. Seller fault is only actionable with proof — fail before touching money.
  if (reasonType === "SELLER_FAULT" && !proofUrl) {
    throw new Error("Proof required for seller fault");
  }

  // 2. Fetch the order.
  const { data: order, error: fetchError } = await db
    .from("customer_orders")
    .select("id, order_no, order_amount, status")
    .eq("id", orderId)
    .single();

  if (fetchError || !order) {
    throw new Error(
      `cancelOrderWithRefund: order ${orderId} not found: ${fetchError?.message ?? "unknown"}`,
    );
  }

  const orderAmount = Number(order.order_amount ?? 0);
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
    throw new Error(
      `cancelOrderWithRefund: order ${orderId} has invalid order_amount: ${order.order_amount}`,
    );
  }

  // 3. Compute the refund by fault type (customer: stage deduction, seller: full).
  const refund = computeCancellationRefund(orderAmount, reasonType, stage);

  const recordReason =
    reasonText ??
    (reasonType === "SELLER_FAULT"
      ? "Seller fault — cancellation with proof submitted"
      : "Customer fault — cancellation after changed mind or wrong order");

  // 4. Route the money: issue the KBank refund for the computed amount.
  const payload = buildRefundPayload(
    order.id,
    refund.refundAmount.toFixed(2),
    recordReason,
  );

  const refundResponse = await sendRefund(options.slug ?? "kbiz", payload, {
    slug: options.slug ?? "kbiz",
    projectId: options.projectId,
    projectKey: options.projectKey,
    db,
  });

  // 5. Update the order status (only a PAID order can be refunded).
  const { error: updateError } = await db
    .from("customer_orders")
    .update({
      status: refund.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "PAID");

  if (updateError) {
    throw new Error(
      `cancelOrderWithRefund: failed to mark ${order.order_no} ${refund.status}: ${updateError.message}`,
    );
  }

  // 6. Record the evidence — including the seller's liability for SELLER_FAULT.
  const { error: evidenceError } = await db.from("cancellation_evidence").insert({
    order_id: order.id,
    reason_type: reasonType,
    proof_url: proofUrl ?? null,
    reason_text: recordReason,
    created_at: new Date().toISOString(),
  });

  if (evidenceError) {
    throw new Error(
      `cancelOrderWithRefund: failed to record cancellation evidence: ${evidenceError.message}`,
    );
  }

  console.log(
    `[cancelOrderWithRefund] ${order.order_no} (${reasonType}) refunded ${refund.refundAmount} of ${refund.orderAmount} -> ${refund.status}` +
      (reasonType === "SELLER_FAULT" ? " (seller liable for full amount)" : ""),
  );

  void refundResponse;
  return refund;
}
