/**
 * Admin actor — the human who approves a payout.
 *
 * The business rule in engines/integration-gateway/workers/payout-worker.ts is
 * "payouts remain human-approved": PAYOUT_PENDING_APPROVAL -> human approve ->
 * PAYOUT_APPROVED -> executeApprovedPayout -> SETTLED.
 *
 * This actor looks for the route that human would call. If the deployment has
 * no such route, the 404 below is the finding.
 */
import { send } from "../http";
import { act, type ActorResult } from "./_shared";

const WATCHED = ["customer_orders", "payout_audit_log"];

/** The endpoint an approval console would call (documented shape of the API). */
export function approvalPath(orderId: string): string {
  return `/api/admin/orders/${orderId}/payout/approve`;
}

export async function approvePayout(input: { orderId: string; actor: string }): Promise<ActorResult> {
  const body = JSON.stringify({ approved: true, approved_by: input.actor, note: "sim approval" });
  return act(
    "admin",
    "approve the payout (human step)",
    {
      method: "POST",
      path: approvalPath(input.orderId),
      signed: false,
      signatureNote: "admin console call — no signature scheme in this codebase for admin routes",
      bodyPreview: body,
    },
    WATCHED,
    () =>
      send({
        method: "POST",
        path: approvalPath(input.orderId),
        body,
        headers: { "content-type": "application/json" },
      }),
  );
}

export async function readPayoutQueue(): Promise<ActorResult> {
  const path = "/api/admin/orders?status=PAYOUT_PENDING_APPROVAL";
  return act(
    "admin",
    "read the payout approval queue",
    { method: "GET", path, signed: false, signatureNote: "unauthenticated read probe" },
    WATCHED,
    () => send({ method: "GET", path }),
  );
}

export type { ActorResult };
