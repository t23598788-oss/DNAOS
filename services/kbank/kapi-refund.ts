// KBank Refund API Client.
//
// Endpoint: POST /v1/mpp/refund/v1/refund
// Base URL: process.env.KBANK_KGP_BASE_URL
//
// Mirrors the payout client's shape (kapi-payout.ts): the payload is built
// from the order id + refund amount, and `sendRefund` POSTs it with the same
// KBank K Pay header contract.
//
// Plan: this is a sandbox-first client, exactly like the payout client. The
// real partner/endpoint resolution is deferred to the owner-approved fix.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getKBankAccessToken } from "./kapi-oauth";

/** One refund entry in the KBank refund request. */
export interface KBankRefundEntry {
  /** KBank partner payment ID supplied by the caller. */
  partnerPaymentID: string;
  /** Amount in THB (e.g. "6500.00"). */
  amount: string;
  /** Human-readable refund reason recorded with the request. */
  reason?: string;
}

/** The full KBank refund request body. */
export interface KBankRefundPayload {
  partnerBatchID: string;
  partnerShopID: string;
  refunds: KBankRefundEntry[];
}

/** Options carried through the refund client. */
export interface RefundOptions {
  slug?: string;
  /** Project id (ProjectID header). */
  projectId?: string;
  /** Project key (ProjectKey header). */
  projectKey?: string;
  /** Supabase client (used to resolve the partner id from the connector record). */
  db?: SupabaseClient;
}

/**
 * Build the KBank refund request body from an order id and refund amount.
 *
 * `refundAmount` is the amount the customer gets back — computed by the
 * cancellation policy (customer fault: stage deduction; seller fault: full).
 */
export function buildRefundPayload(
  orderId: string,
  refundAmount: string,
  reason?: string,
): KBankRefundPayload {
  const partnerBatchId = `REFUND-${orderId.slice(0, 8).toUpperCase()}`;
  const partnerPaymentId = `REFUND-${Date.now().toString(36).toUpperCase()}`;

  return {
    partnerBatchID: partnerBatchId,
    partnerShopID: "SHOP001", // placeholder — owner wires the real connector value
    refunds: [
      {
        partnerPaymentID: partnerPaymentId,
        amount: refundAmount,
        ...(reason ? { reason } : {}),
      },
    ],
  };
}

/**
 * POST the refund request to KBank K Pay.
 *
 * 1. Retrieve the access token via `getKBankAccessToken(slug)`.
 * 2. POST to `${KBANK_KGP_BASE_URL}/v1/mpp/refund/v1/refund`.
 * 3. Include the required headers (Authorization Bearer, Content-Type,
 *    RequestID/UUID, ProjectID, ProjectKey, PartnerID).
 * 4. Return the JSON response body.
 *
 * Throws on network/error; the caller is responsible for wrapping in try/catch.
 */
export async function sendRefund(
  slug: "kbiz" | "kplus" | "truemoney",
  payload: KBankRefundPayload,
  options: RefundOptions = {},
): Promise<Record<string, unknown>> {
  if (!process.env.KBANK_KGP_BASE_URL) {
    throw new Error("KBank base URL not configured: KBANK_KGP_BASE_URL");
  }

  const accessToken = await getKBankAccessToken(slug);

  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    RequestID: requestId,
    ProjectID: options.projectId ?? "PROJECT001", // placeholder
    ProjectKey: options.projectKey ?? "KEY-PLACEHOLDER", // placeholder
    PartnerID: "0001", // placeholder
  };

  const res = await fetch(
    `${process.env.KBANK_KGP_BASE_URL}/v1/mpp/refund/v1/refund`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KBank refund failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}
