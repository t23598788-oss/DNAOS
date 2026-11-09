/**
 * Gateway Worker Scheduler — GET /api/cron/gateway-workers, the consumer the
 * Integration Gateway has been missing (2026-11-09).
 *
 * Before this route, order-translator / reconciler / payout-worker existed but
 * NOTHING called them outside tests: integration_gateway_events accumulated rows
 * with status='received' that no process ever read. This route is the real
 * consumer — it runs the three safe, repeatable phases on a schedule:
 *
 *   1. translateLineMessageEvents()  — LINE message.received -> customer_orders stub
 *   2. reconcileKBankPayments()      — kbank payment.completed -> order PAID
 *   3. reconcilePayouts()            — PAID -> PAYOUT_PENDING_APPROVAL (approval request only)
 *
 * Deliberately NOT called here, and must stay that way:
 *   - cancellation-worker.cancelOrderWithRefund(): cancellation is a
 *     customer-triggered, fault-attributed action. A timer must never cancel
 *     an order or move refund money.
 *   - payout-worker.executeApprovedPayout(): payouts remain human-approved
 *     (PAID -> PAYOUT_PENDING_APPROVAL -> human approve -> PAYOUT_APPROVED ->
 *     SETTLED). Automating the executor would delete that invariant.
 *
 * Auth mirrors the established scheduler contract in this repo (see
 * app/api/cron/operations-loop/route.ts and app/api/cron/supabase-project-status/route.ts):
 * CRON_SECRET + `Authorization: Bearer <secret>`, fail-closed.
 *
 * Each phase is isolated: one failing worker never aborts the other two, and
 * the response is always a JSON summary — never a bare 500.
 */

import { NextResponse } from "next/server";
import { translateLineMessageEvents } from "@/engines/integration-gateway/workers/order-translator";
import { reconcileKBankPayments } from "@/engines/integration-gateway/workers/reconciler";
import { reconcilePayouts } from "@/engines/integration-gateway/workers/payout-worker";

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

  let translated = 0;
  try {
    // No options: each worker defaults to the service_role client itself.
    const result = await translateLineMessageEvents();
    translated = result.translated;
  } catch (err) {
    errors.push(`translateLineMessageEvents: ${describe(err)}`);
  }

  let reconciled = 0;
  try {
    const result = await reconcileKBankPayments();
    reconciled = result.matched;
  } catch (err) {
    errors.push(`reconcileKBankPayments: ${describe(err)}`);
  }

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
    ok: errors.length === 0,
    translated,
    reconciled,
    approvalRequested,
    errors,
  });
}
