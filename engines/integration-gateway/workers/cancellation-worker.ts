/**
 * Cancellation worker — fault-based refund routing.
 *
 * Owner's rule (2026-11-09):
 * 1. Customer fault (changed mind, ordered wrong): customer pays the
 *    deduction based on truck stage.  Applied via the existing stage-based
 *    deduction logic in the cancellation policy.
 * 2. Seller fault (wrong specs, wrong item, with proof): seller pays
 *    ALL costs (shipping + full refund to customer). Customer pays 0.
 * 3. DNA OS just routes the money and records the proof. No arbitration.
 *
 * `cancelOrderWithRefund(orderId, reasonType, proofUrl?, reasonText?)`:
 *
 *   If reasonType === 'CUSTOMER_FAULT':
 *     - Apply existing logic: refundAmount = (order.amount * refundPercent / 100) - deductionFlat
 *     - Update order status to CANCELLED_REFUNDED or CANCELLED_PARTIAL_REFUND
 *
 *   If reasonType === 'SELLER_FAULT':
 *     - Validate proofUrl is provided. If not, throw error "Proof required for seller fault".
 *     - Set refundAmount = order.amount (full refund).
 *     - Record the seller's liability (insert into cancellation_evidence table).
 *     - Update order status to CANCELLED_REFUNDED.
 *
 * The KBank refund API call is deferred to the caller (the refund is issued
 * through the KBank refund client, `sendRefund`). This worker only computes
 * the refund amount, validates proof, updates the order status, and records
 * the cancellation evidence. DNA OS routes the money; it does not arbitrate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeCancellationRefund,
  type CancellationReasonType,
  type DeliveryStage,
  type RefundResult,
} from "@/services/finance/cancellation-policy";

/** Options carried through the cancellation worker. */
export interface CancellationWorkerOptions {
  /** Supabase service_role client (injected for testability). */
  db?: SupabaseClient;
}

/**
 * Final cancellation order statuses after refund.
 *
 *   CANCELLED_REFUNDED      — full or partial refund issued
 *   CANCELLED_PARTIAL_REFUND — partial refund (only used for CUSTOMER_FAULT)
 */
export type CancellationStatus =
  | "CANCELLED_REFUNDED"
  | "CANCELLED_PARTIAL_REFUND";

/**
 * Cancellation evidence — records why the order was cancelled and the proof.
 *
 * Table: `cancellation_evidence`
 *   id         uuid  (PK)
 *   order_id   text  (FK → customer_orders.id)
 *   reason_type text  ('CUSTOMER_FAULT' | 'SELLER_FAULT')
 *   proof_url  text
 *   reason_text text
 *   created_at timestamptz
 */
export interface CancellationEvidenceRow {
  id: string;
  order_id: string;
  reason_type: "CUSTOMER_FAULT" | "SELLER_FAULT";
  proof_url: string;
  reason_text: string;
  created_at: string;
}

/**
 * Cancel an order with a fault-based refund.
 *
 * @param orderId — the customer order id
 * @param reasonType — 'CUSTOMER_FAULT' or 'SELLER_FAULT'
 * @param proofUrl — required for SELLER_FAULT (seller's proof of fault)
 * @param reasonText — optional human-readable reason
 * @param stage — delivery stage for CUSTOMER_FAULT deduction
 * @param db — (optional) Supabase client
 *
 * @returns the refund result with the computed refund amount
 *
 * @throws {Error} if SELLER_FAULT and proofUrl is missing: "Proof required for seller fault"
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
    throw new Error("Cancellation worker requires a Supabase client");
  }

  // 1. Fetch the order (id, order_amount, status).
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
  if (!orderAmount || orderAmount < 0) {
    throw new Error(
      `cancelOrderWithRefund: order ${orderId} has invalid order_amount: ${order.order_amount}`,
    );
  }

  // 2. Compute the refund amount based on fault type.
  const refundResult = computeCancellationRefund(orderAmount, reasonType, stage);

  // 3. SELLER_FAULT: proof is required before processing.
  if (reasonType === "SELLER_FAULT") {
    if (!proofUrl) {
      throw new Error("Proof required for seller fault");
    }
    if (!reasonText) {
      reasonText = "Seller fault — cancellation with proof submitted";
    }
  } else {
    // CUSTOMER_FAULT: no proof needed, default reason.
    if (!reasonText) {
      reasonText = "Customer fault — cancellation after changed mind or wrong order";
    }
    // CUSTOMER_FAULT partial refunds (CANCELLED_PARTIAL_REFUND) go to CANCELLED_REFUNDED.
    // Full refunds (stage 0 deduction, e.g. before departure) go to CANCELLED_REFUNDED.
    if (refundResult.deductionAmount === 0) {
      refundResult.status = "CANCELLED_REFUNDED" as const;
    } else {
      refundResult.status = "CANCELLED_PARTIAL_REFUND" as const;
    }
  }

  // 4. Update the order status.
  const { error: updateError } = await db
    .from("customer_orders")
    .update({
      status: refundResult.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "PAID"); // only refund when paid (same as payout flow)

  if (updateError) {
    throw new Error(
      `cancelOrderWithRefund: failed to update status for ${order.order_no}: ${updateError.message}`,
    );
  }

  // 5. Record the cancellation evidence (seller fault requires proof; always record).
  const evidence = await db.from("cancellation_evidence").insert({
    order_id: order.id,
    reason_type: reasonType,
    proof_url: proofUrl ?? null,
    reason_text: reasonText,
    created_at: new Date().toISOString(),
  });

  if (evidence.error) {
    throw new Error(
      `cancelOrderWithRefund: failed to record evidence: ${evidence.error.message}`,
    );
  }

  return refundResult;
}
