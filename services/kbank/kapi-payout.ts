// Minimal stub for KBank payout adapter.
// The real implementation is not present in this repository; this module
// exists so the project type-checks and builds. Functions throw at runtime
// until a real adapter is provided.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PayoutOptions {
  slug?: string;
  projectId?: unknown;
  projectKey?: unknown;
  db?: SupabaseClient;
}

export type KBankPayoutPayload = Record<string, unknown>;

export function buildPayoutPayload(
  _options: PayoutOptions,
  _orderId: string,
  _orderAmount: string,
): KBankPayoutPayload {
  return {};
}

export async function sendPayout(
  _slug: string,
  _payload: KBankPayoutPayload,
  _options: PayoutOptions,
): Promise<Record<string, unknown>> {
  throw new Error("KBank payout adapter is not implemented");
}