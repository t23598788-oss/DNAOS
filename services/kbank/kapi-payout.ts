// KBank Payout API Client.
//
// Endpoint: POST /v1/mpp/payout/v1/payout
// Base URL: process.env.KBANK_KGP_BASE_URL
//
// Body structure (per KBank K Pay API spec):
// {
//   "partnerBatchID": "Batch001",
//   "partnerShopID": "SHOP001",
//   "payments": [
//     {
//       "partnerPaymentID": "PAYMENT000000001",
//       "distribution": {
//         "shopAmount": "70.00",
//         "partners": [ { "partnerID": "0001", "amount": "30.00" } ]
//       }
//     }
//   ]
// }
//
// Required headers:
//   - Authorization: Bearer <access_token>
//   - Content-Type: application/json
//   - RequestID: <unique UUID>
//   - ProjectID: <project id>
//   - ProjectKey: <project key>
//   - PartnerID: <partner id>
//
// Plan: this is a sandbox-first client. Nothing here is production ready.
// Replace with the real KBank K Pay API client once the sandbox secret is
// provisioned (see TASK-061/063 owner notes).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getKBankAccessToken } from "./kapi-oauth";

/** The partner ID is resolved from the connected connector record. */
export type PartnerId = string;

/** A single distribution target inside one KBank payment entry. */
export interface DistributionPartner {
  /** KBank partner ID as integer string (e.g. "0001"). */
  partnerID: string;
  /** Amount in THB (e.g. "30.00"). */
  amount: string;
}

/** The distribution object of one KBank payment entry. */
export interface Distribution {
  /** The shop/fee amount in THB (e.g. "5.00"). */
  shopAmount: string;
  /** Partner shares (amount in THB). */
  partners: DistributionPartner[];
}

/** One payment entry in the KBank payout request. */
export interface KBankPaymentEntry {
  /** KBank partner payment ID supplied by the caller. */
  partnerPaymentID: string;
  distribution: Distribution;
}

/** The full KBank payout request body. */
export interface KBankPayoutPayload {
  partnerBatchID: string;
  partnerShopID: string;
  payments: KBankPaymentEntry[];
}

/** Options carried through the payout client. */
export interface PayoutOptions {
  slug?: string;
  /** Project id (ProjectID header). */
  projectId?: string;
  /** Project key (ProjectKey header). */
  projectKey?: string;
  /** Supabase client (used to resolve the partner id from the connector record). */
  db?: SupabaseClient;
}

/**
 * Build the KBank payout request body from a customer_order payout plan.
 *
 * Distribution rule (Phase 3, sandbox default): a fixed shop fee is taken
 * first and the remainder is passed to the partner:
 *   shopAmount    = shop fee (e.g. 5 THB)
 *   partner total = order amount - shop fee
 *
 * The partner row is resolved from the order's `customer_company_id` via the
 * connected KBank connector record (`partnerID` / `partnerShopID` / `partnerID`).
 * This is a plan: the real resolution is deferred to the owner-approved fix.
 */
export function buildPayoutPayload(
  options: PayoutOptions,
  orderId: string,
  orderAmount: string,
): KBankPayoutPayload {
  const shopFee = "5.00";
  const netAmount = String(Number(orderAmount) - Number(shopFee));
  const partnerAmount = Number(netAmount) > 0 ? netAmount : "0.00";

  // These are plan placeholders. The Owner must wire the real
  // connector/partner resolution (TASK-061/063) before any live payout.
  const partnerId = "0001"; // placeholder
  const partnerShopId = "SHOP001"; // placeholder
  const partnerBatchId = `BATCH-${orderId.slice(0, 8).toUpperCase()}`;
  const partnerPaymentId = `PAYOUT-${Date.now().toString(36).toUpperCase()}`;

  return {
    partnerBatchID: partnerBatchId,
    partnerShopID: partnerShopId,
    payments: [
      {
        partnerPaymentID: partnerPaymentId,
        distribution: {
          shopAmount: shopFee,
          partners: [{ partnerID: partnerId, amount: partnerAmount }],
        },
      },
    ],
  };
}

/**
 * POST the payout request to KBank K Pay.
 *
 * 1. Retrieve the access token via `getKBankAccessToken(slug)`.
 * 2. POST to `${KBANK_KGP_BASE_URL}/v1/mpp/payout/v1/payout`.
 * 3. Include the required headers (Authorization Bearer, Content-Type,
 *    RequestID/UUID, ProjectID, ProjectKey, PartnerID).
 * 4. Return the JSON response body.
 *
 * Throws on network/error; the caller is responsible for wrapping in try/catch.
 */
export async function sendPayout(
  slug: "kbiz" | "kplus" | "truemoney",
  payload: KBankPayoutPayload,
  options: PayoutOptions = {},
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
  };

  // Optional headers resolved from the connector record (via the injected
  // Supabase client) or from environment variables.
  if (options.projectId) headers.ProjectID = options.projectId;
  if (options.projectKey) headers.ProjectKey = options.projectKey;
  if (options.db) {
    // The projectKey/partnerID are resolved from the connected connector
    // record. This is a plan: the real accessor is deferred to the Owner.
    headers.ProjectID = options.projectId ?? "PROJECT001"; // placeholder
    headers.ProjectKey = options.projectKey ?? "KEY-PLACEHOLDER"; // placeholder
    headers.PartnerID = "0001"; // placeholder
  } else {
    headers.ProjectID = options.projectId ?? "PROJECT001"; // placeholder
    headers.ProjectKey = options.projectKey ?? "KEY-PLACEHOLDER"; // placeholder
    headers.PartnerID = "0001"; // placeholder
  }

  const res = await fetch(
    `${process.env.KBANK_KGP_BASE_URL}/v1/mpp/payout/v1/payout`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`KBank payout failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}
