/**
 * Cancellation policy — fault-based refund routing.
 *
 * Owner's rule (2026-11-09):
 * 1. Customer fault (changed mind, ordered wrong): customer pays the
 *    deduction based on truck stage. (Existing stage-based deduction logic.)
 * 2. Seller fault (wrong specs, wrong item, with proof): seller pays
 *    ALL costs (shipping + full refund to customer). Customer pays 0.
 * 3. DNA OS just routes the money and records the proof. No arbitration.
 *
 * `reasonType` parameter:
 *  - 'CUSTOMER_FAULT': use the stage-based deduction logic (which we built).
 *  - 'SELLER_FAULT': refund 100%, deduction 0. (Seller will be charged later.)
 */

export type CancellationReasonType = "CUSTOMER_FAULT" | "SELLER_FAULT";

/**
 * Truck delivery stage — determines how much the customer pays on a
 * CUSTOMER_FAULT cancellation (stage-based deduction).
 */
export type DeliveryStage =
  | "CANCELLED_BEFORE_DEPARTURE"
  | "CANCELLED_AT_DEPARTURE"
  | "CANCELLED_PICKED_UP"
  | "CANCELLED_IN_TRANSIT"
  | "CANCELLED_DELIVERED";

/**
 * Stage-based deduction percentages (customer pays this much of the order
 * amount on a CUSTOMER_FAULT cancellation). The deduction increases the
 * later the truck is, reflecting sunk logistics cost.
 *
 * Format: { stage, percent, deductionFlat }
 */
export interface StageDeduction {
  stage: DeliveryStage;
  percent: number;
  deductionFlat: number;
}

/**
 * Stage-based deduction table (customer pays the deduction).
 *
 * The deduction is applied AFTER the standard shop split. For a
 * CUSTOMER_FAULT cancellation at stage "PICKED_UP" the refund amount is:
 *
 *   refundAmount = (order.amount * refundPercent / 100) - deductionFlat
 *
 * with a floor of 0 (refund can never be negative).
 */
export const STAGE_DEDUCTIONS: readonly StageDeduction[] = [
  {
    stage: "CANCELLED_BEFORE_DEPARTURE",
    percent: 100,
    deductionFlat: 0,
  },
  {
    stage: "CANCELLED_AT_DEPARTURE",
    percent: 90,
    deductionFlat: 100,
  },
  {
    stage: "CANCELLED_PICKED_UP",
    percent: 70,
    deductionFlat: 500,
  },
  {
    stage: "CANCELLED_IN_TRANSIT",
    percent: 40,
    deductionFlat: 1200,
  },
  {
    stage: "CANCELLED_DELIVERED",
    percent: 10,
    deductionFlat: 500,
  },
];

/** Refund that the customer receives (refunded to customer). */
export interface RefundResult {
  /** The amount the customer should be refunded. */
  refundAmount: number;
  /** The stage deduction the customer pays (customer fault only). */
  deductionAmount: number;
  /** The order amount. */
  orderAmount: number;
  /** Stage of the deduction. */
  stage: DeliveryStage;
  /** The reason type. */
  reasonType: CancellationReasonType;
  /** Final order status after refund. */
  status: "CANCELLED_REFUNDED" | "CANCELLED_PARTIAL_REFUND";
}

/**
 * Compute the refund amount for a cancellation, routed by fault type.
 *
 * CUSTOMER_FAULT:
 *   Uses the existing stage-based deduction logic:
 *     refundAmount = (order.amount * refundPercent / 100) - deductionFlat
 *   Returns 0 if the result is negative (refund can't be negative).
 *
 * SELLER_FAULT:
 *   Uses the full refund (refundAmount = order.amount, deduction = 0),
 *   because the seller is liable for all costs.
 */
export function computeCancellationRefund(
  orderAmount: number,
  reasonType: CancellationReasonType,
  stage: DeliveryStage,
): RefundResult {
  const stageDeduction = STAGE_DEDUCTIONS.find((s) => s.stage === stage);
  if (!stageDeduction) {
    throw new Error(`Unknown delivery stage: ${stage}`);
  }

  if (reasonType === "CUSTOMER_FAULT") {
    // Existing stage-based deduction logic:
    //   refundAmount = (order.amount * refundPercent / 100) - deductionFlat
    // Here refundPercent equals the stage's percent (the percentage of the
    // order the customer is still entitled to at this stage).
    const refundAmount =
      (orderAmount * stageDeduction.percent) / 100 - stageDeduction.deductionFlat;
    const deductionAmount = Math.max(0, stageDeduction.deductionFlat);

    return {
      refundAmount: Math.max(0, refundAmount),
      deductionAmount,
      orderAmount,
      stage,
      reasonType,
      status: deductionAmount === 0 ? "CANCELLED_REFUNDED" : "CANCELLED_PARTIAL_REFUND",
    };
  }

  // SELLER_FAULT: full refund, deduction 0.
  return {
    refundAmount: orderAmount,
    deductionAmount: 0,
    orderAmount,
    stage,
    reasonType,
    status: "CANCELLED_REFUNDED",
  };
}
