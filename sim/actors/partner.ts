/**
 * Partner actor — the supplier who must answer with a price / accept the order.
 *
 * The system has NO partner-facing API surface: everything under app/api that
 * mentions partners is /api/admin/partners/*, which is an operator console, not
 * a partner interface. So this actor sends the request a partner client would
 * send and records what the deployment actually answers. A 404 here is a real
 * finding, not a harness error.
 */
import { send } from "../http";
import { act, type ActorResult } from "./_shared";

const WATCHED = ["customer_orders", "integration_gateway_events"];

export async function replyPrice(input: { orderNo: string; amount: number }): Promise<ActorResult> {
  const body = JSON.stringify({
    order_no: input.orderNo,
    unit_price: input.amount,
    currency: "THB",
    partner_id: "sim-partner-0001",
    action: "quote",
  });
  return act(
    "partner",
    "reply a price for the order",
    {
      method: "POST",
      path: "/api/partner/quotes",
      signed: false,
      signatureNote: "no partner credential scheme exists in this repo (no /api/partner/** route)",
      bodyPreview: body,
    },
    WATCHED,
    () =>
      send({
        method: "POST",
        path: "/api/partner/quotes",
        body,
        headers: { "content-type": "application/json" },
      }),
  );
}

export type { ActorResult };
