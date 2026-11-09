/**
 * Gateway Worker Scheduler — GET /api/cron/gateway-workers, the consumer the
 * Integration Gateway has been missing (2026-11-09).
 *
 * Before this route, order-translator / reconciler / order-dispatcher /
 * payout-worker existed but NOTHING called them outside tests:
 * integration_gateway_events accumulated rows with status='received' that no
 * process ever read, and paid orders sat with no truck job.
 *
 * The pipeline runs four phases, in this exact order:
 *
 *   1. translateLineMessageEvents()  — LINE message.received -> DRAFT order
 *   2. reconcileKBankPayments()      — DRAFT -> PAID when money arrives
 *   3. dispatchPendingOrders()       — PAID -> BROADCASTED truck job
 *   4. reconcilePayouts()            — PAID -> PAYOUT_PENDING_APPROVAL
 *
 * Why this order: trucks move goods first — an order that is paid and has no
 * truck is the failure the business actually feels. Payout approval is the
 * money step and stays last, on purpose.
 *
 * Deliberately NOT called here, and must stay that way:
 *   - cancellation-worker.cancelOrderWithRefund(): cancellation is a
 *     customer-triggered, fault-attributed action. A timer must never cancel
 *     an order or move refund money.
 *   - payout-worker.executeApprovedPayout(): payouts remain human-approved
 *     (PAID -> PAYOUT_PENDING_APPROVAL -> human approve -> PAYOUT_APPROVED ->
 *     SETTLED). Automating the executor would delete that invariant. Phase 4
 *     only ever *requests* approval; it never sends money.
 *   - dispatchOrder() is never called for a single order here, only the
 *     pool scan — one order at a time stays an explicit admin decision
 *     (POST /api/admin/orders/[orderId]/dispatch).
 *
 * Auth mirrors the established scheduler contract in this repo (see
 * app/api/cron/operations-loop/route.ts and app/api/cron/supabase-project-status/route.ts):
 * CRON_SECRET + `Authorization: Bearer <secret>`, fail-closed.
 *
 * Each phase is isolated: one failing worker never aborts the others, and the
 * response is always a JSON summary — never a bare 500.
 */

import { NextResponse } from "next/server";
import { translateLineMessageEvents } from "@/engines/integration-gateway/workers/order-translator";
import { reconcileKBankPayments } from "@/engines/integration-gateway/workers/reconciler";
import { dispatchPendingOrders } from "@/engines/integration-gateway/workers/order-dispatcher";
import { reconcilePayouts } from "@/engines/integration-gateway/workers/payout-worker";
import { supabaseAdmin } from "@/services/supabase/queries";

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const errors: string[] = [];

  // 1. LINE events -> DRAFT orders (and "ยืนยัน" -> SUBMITTED confirmations).
  let translated = 0;
  let confirmed = 0;
  try {
    // No options: each worker defaults to the service_role client itself.
    const result = await translateLineMessageEvents();
    translated = result.translated;
    confirmed = result.confirmed;
  } catch (err) {
    errors.push(`translateLineMessageEvents: ${describe(err)}`);
  }

  // 2. Payments -> PAID.
  let reconciled = 0;
  try {
    // reconcileKBankPayments defaults to supabaseAdmin() itself; passing one in
    // is a type error today (its option is declared `db?: typeof supabaseAdmin`).
    const result = await reconcileKBankPayments();
    reconciled = result.matched;
  } catch (err) {
    errors.push(`reconcileKBankPayments: ${describe(err)}`);
  }

  // 3. PAID orders -> truck job at BROADCASTED (never throws; reports per order).
  let dispatched = 0;
  let dispatchErrors: string[] = [];
  try {
    const result = await dispatchPendingOrders({ db: supabaseAdmin() });
    dispatched = result.dispatched;
    dispatchErrors = result.errors;
  } catch (err) {
    dispatchErrors = [describe(err)];
  }

  // 4. PAID orders -> PAYOUT_PENDING_APPROVAL (approval request only).
  let approvalRequested = 0;
  try {
    // Approval request only — this function never calls sendPayout().
    // Count from the per-order outcomes rather than `succeeded`, which the
    // worker increments even when an order was skipped.
    const result = await reconcilePayouts();
    approvalRequested = result.orders.filter((o) => o.status === "settled").length;
  } catch (err) {
    errors.push(`reconcilePayouts: ${describe(err)}`);
  }

  return NextResponse.json({
    ok: errors.length === 0 && dispatchErrors.length === 0,
    translated,
    confirmed,
    reconciled,
    dispatched,
    dispatchErrors,
    approvalRequested,
    errors,
  });
}
