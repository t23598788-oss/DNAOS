/**
 * Bank actor — KBank sending a payment webhook.
 *
 * Route:  POST /api/connectors/webhook/kbank
 * Gate:   app/api/connectors/webhook/[slug]/_lib/webhookGate.ts, fail-closed
 *         (connector must exist+connected+webhook, signing secret must be
 *          configured in the connector row, HMAC-SHA256 hex over raw bytes)
 *
 * NOTE: the signing secret for this gate lives in the connector ROW
 * (secret.signing_secret), not in the environment, and no KBANK connector
 * exists in the deployment. The actor therefore sends the request the bank
 * would send and reports the answer. It never invents a signing secret.
 */
import { createHmac } from "node:crypto";
import { secret, loadEnv } from "../env";
import { send } from "../http";
import { SIM_MARK } from "../db";
import { act, type ActorResult } from "./_shared";

loadEnv();

const WATCHED = ["integration_gateway_events", "kbank_webhook_events", "customer_orders"];

export interface PaymentInput {
  amount: number;
  /** what the bank echoes back so the system can find the order */
  reference: string;
  currency?: string;
}

export function buildKBankPayload(input: PaymentInput): { body: string; eventId: string } {
  const eventId = `${SIM_MARK}-kbank-${Date.now()}`;
  const payload = {
    destination: "sim-kbank-account",
    events: [
      {
        type: "payment.completed",
        id: eventId,
        status: "completed",
        timestamp: Date.now(),
        source: { type: "bank_account", id: "sim-kbank-account", account_id: "sim-kbank-account" },
        amount: input.amount,
        currency: input.currency ?? "THB",
        reference: input.reference,
        transaction_time: new Date().toISOString(),
      },
    ],
  };
  return { body: JSON.stringify(payload), eventId };
}

export async function sendPayment(input: PaymentInput): Promise<ActorResult> {
  const { body, eventId } = buildKBankPayload(input);
  const signingSecret = secret("KBANK_WEBHOOK_SECRET");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signingSecret) {
    headers["x-kbank-signature"] = createHmac("sha256", signingSecret).update(body).digest("hex");
  }
  const result = await act(
    "bank",
    `payment webhook ${input.amount} THB for ${input.reference}`,
    {
      method: "POST",
      path: "/api/connectors/webhook/kbank",
      signed: Boolean(signingSecret),
      signatureNote: signingSecret
        ? "x-kbank-signature = HMAC-SHA256(hex) over raw body"
        : "no KBANK signing secret in env and none in a connector row — sent unsigned",
      bodyPreview: `reference=${input.reference} amount=${input.amount} event=${eventId}`,
    },
    WATCHED,
    () => send({ method: "POST", path: "/api/connectors/webhook/kbank", body, headers }),
  );
  return result;
}

export type { ActorResult };
