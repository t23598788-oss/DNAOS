/**
 * Customer actor — a real LINE user sending a real webhook to the real ingress.
 *
 * We fabricate only what LINE would send: the JSON payload and the HMAC-SHA256
 * (base64) signature over the exact raw bytes. The signature is computed from
 * LINE_CHANNEL_SECRET when the local environment has it; when it does not, we
 * send the request WITHOUT a signature and say so. We never invent a secret,
 * because a fabricated secret would prove nothing about the system.
 */
import { createHmac } from "node:crypto";
import { secret, loadEnv } from "../env";
import { send } from "../http";
import { SIM_MARK } from "../db";
import { act, type ActorResult } from "./_shared";

loadEnv();

const WATCHED = ["integration_gateway_events", "customer_orders"];

export interface LineMessageInput {
  text: string;
  /** LINE account the message arrived through (destination). */
  destination?: string;
  /** Stable per-run id; becomes EVT-line-<id> in the event log. */
  webhookEventId?: string;
}

export function buildLinePayload(input: LineMessageInput): { body: string; webhookEventId: string } {
  const webhookEventId = input.webhookEventId ?? `${SIM_MARK}-line-${Date.now()}`;
  const payload = {
    destination: input.destination ?? "Udest-sim-unknown-account",
    events: [
      {
        type: "message",
        mode: "active",
        timestamp: Date.now(),
        webhookEventId,
        deliveryContext: { isRedelivery: false },
        source: { type: "user", userId: "Usim-customer-0001" },
        replyToken: "sim-reply-token-not-usable",
        message: { type: "text", id: `msg-${webhookEventId}`, text: input.text },
      },
    ],
  };
  return { body: JSON.stringify(payload), webhookEventId };
}

export async function sendLineMessage(input: LineMessageInput): Promise<ActorResult> {
  const { body, webhookEventId } = buildLinePayload(input);
  const channelSecret = secret("LINE_CHANNEL_SECRET");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (channelSecret) {
    headers["x-line-signature"] = createHmac("sha256", channelSecret).update(body).digest("base64");
  }
  return act(
    "customer",
    "line webhook: message text",
    {
      method: "POST",
      path: "/api/gateway/observe/line",
      signed: Boolean(channelSecret),
      signatureNote: channelSecret
        ? "x-line-signature = HMAC-SHA256(base64) over raw body"
        : "LINE_CHANNEL_SECRET is not set locally — request sent with NO signature",
      bodyPreview: input.text,
    },
    WATCHED,
    () => send({ method: "POST", path: "/api/gateway/observe/line", body, headers }),
  );
}

export type { ActorResult };
