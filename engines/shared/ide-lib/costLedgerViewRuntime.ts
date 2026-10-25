/**
 * Cost Ledger View Runtime (owner, 2026-08-10, DigitalOcean AI Inference
 * Infrastructure Control & Billing Layer). Pure READ-side computation
 * over the real, already-existing, already-working
 * registry/COST_LEDGER.json (engines/shared/ide-lib/costGateRuntime.ts —
 * built 2026-08-09, Constitution Rule 257, written automatically for
 * every non-FREE Adapter, DigitalOcean included, with zero extra code —
 * see this session's own verification). This module adds NOTHING to
 * that write path — it only derives margin/THB/payable views from real,
 * already-recorded entries, so "every number must trace back to a real
 * usage event" (Owner's own instruction) holds by construction: every
 * derived number here carries its source entry_id.
 *
 * THB conversion reuses the real, live engines/bot-exchange-rate.ts
 * (Bank of Thailand rates) — never a hardcoded exchange rate. Honestly
 * null when BOT_API_KEY is absent or the rate isn't available, never a
 * guessed number.
 *
 * Service fee / margin: DEFAULT_MARGIN_RATE is 0 — no business margin
 * policy exists anywhere in this repo to reuse, and this build does not
 * invent one. customer_charge === provider_cost until the Owner sets a
 * real rate.
 */
import { listCostLedgerEntries, type CostLedgerEntry } from "./costGateRuntime";
import { getExchangeRateFor } from "@/engines/bot-exchange-rate";
import { listUsageEvents, type UsageEventRecord } from "./usageMeterRuntime";

export const DEFAULT_MARGIN_RATE = 0;

export interface CostLedgerEntryWithMargin {
  entryId: string;
  taskId: string;
  requestId: string | null;
  workerId: string;
  provider: string;
  model: string | null;
  timestamp: string;
  providerCost: number | null;
  currency: string;
  exchangeRateThb: number | null;
  exchangeRateSource: "BOT_API" | "UNAVAILABLE";
  providerCostThb: number | null;
  marginRate: number;
  dnaOsServiceFeeThb: number | null;
  customerChargeThb: number | null;
  grossMarginThb: number | null;
}

async function withMargin(entry: CostLedgerEntry, marginRate: number): Promise<CostLedgerEntryWithMargin> {
  const rate = await getExchangeRateFor(entry.currency).catch(() => null);
  const exchangeRateThb = rate?.midRate ?? null;
  const providerCostThb = entry.actual_cost !== null && exchangeRateThb !== null ? entry.actual_cost * exchangeRateThb : null;
  const dnaOsServiceFeeThb = providerCostThb !== null ? providerCostThb * marginRate : null;
  const customerChargeThb = providerCostThb !== null && dnaOsServiceFeeThb !== null ? providerCostThb + dnaOsServiceFeeThb : null;
  return {
    entryId: entry.entry_id, taskId: entry.task_id, requestId: entry.request_id ?? null, workerId: entry.worker_id, provider: entry.provider, model: entry.model, timestamp: entry.timestamp,
    providerCost: entry.actual_cost, currency: entry.currency,
    exchangeRateThb, exchangeRateSource: exchangeRateThb !== null ? "BOT_API" : "UNAVAILABLE",
    providerCostThb, marginRate, dnaOsServiceFeeThb, customerChargeThb,
    grossMarginThb: dnaOsServiceFeeThb,
  };
}

/** Real, traceable view — every row carries entryId back to the real,
 * unmodified registry/COST_LEDGER.json entry it was derived from. */
export async function listCostLedgerWithMargin(marginRate: number = DEFAULT_MARGIN_RATE): Promise<CostLedgerEntryWithMargin[]> {
  const entries = listCostLedgerEntries();
  return Promise.all(entries.map((e) => withMargin(e, marginRate)));
}

export interface UsageWithCost {
  requestId: string;
  provider: string;
  service: string;
  model: string | null;
  adapterId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  tokenSource: "PROVIDER_REPORTED" | "UNKNOWN";
  tokenUnknownReason: string | null;
  latencyMs: number;
  status: string;
  error: string | null;
  startedAt: string;
  completedAt: string;
  providerCost: number | null;
  currency: string | null;
  providerCostThb: number | null;
  /** ACTUAL = a real, matching Cost Ledger entry with a real actual_cost
   * was found for this exact request_id. NO_COST_RECORDED = honest
   * default (e.g. a FREE adapter, a NOT_CONFIGURED/FAILED call, or a
   * PAID call whose cost.kind wasn't ACTUAL) — never a guessed number. */
  costStatus: "ACTUAL" | "NO_COST_RECORDED";
}

/**
 * Real, per-request join of worker_usage_events (every call) with
 * registry/COST_LEDGER.json (only real ACTUAL-cost calls), by the real,
 * shared request_id both now carry (Owner's own instruction: "ทุกตัวเลข
 * ต้องย้อนกลับไปหา request_id เดียวกันได้"). Not a new storage layer — a
 * pure read-time join over the two already-real sources.
 */
export async function listUsageWithCost(limit = 100): Promise<UsageWithCost[]> {
  const [events, ledgerEntries] = await Promise.all([listUsageEvents({ limit }), Promise.resolve(listCostLedgerEntries())]);
  const ledgerByRequestId = new Map<string, CostLedgerEntry>();
  for (const e of ledgerEntries) if (e.request_id) ledgerByRequestId.set(e.request_id, e);

  const rows: UsageWithCost[] = [];
  for (const e of events) {
    const ledgerEntry = ledgerByRequestId.get(e.request_id);
    let providerCost: number | null = null;
    let currency: string | null = null;
    let providerCostThb: number | null = null;
    let costStatus: UsageWithCost["costStatus"] = "NO_COST_RECORDED";
    if (ledgerEntry && ledgerEntry.actual_cost !== null) {
      const withM = await withMargin(ledgerEntry, DEFAULT_MARGIN_RATE);
      providerCost = withM.providerCost;
      currency = withM.currency;
      providerCostThb = withM.providerCostThb;
      costStatus = "ACTUAL";
    }
    rows.push({
      requestId: e.request_id, provider: e.provider, service: e.service, model: e.model, adapterId: e.adapter_id,
      inputTokens: e.input_tokens, outputTokens: e.output_tokens, totalTokens: e.total_tokens,
      tokenSource: e.token_source, tokenUnknownReason: e.token_unknown_reason,
      latencyMs: e.latency_ms, status: e.status, error: e.error, startedAt: e.started_at, completedAt: e.completed_at,
      providerCost, currency, providerCostThb, costStatus,
    });
  }
  return rows;
}

export interface AccumulatedUsageSummary {
  provider: string;
  requestCount: number;
  successCount: number;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  unknownTokenRequestCount: number;
  totalProviderCostByCurrency: Record<string, number>;
  totalProviderCostThb: number | null;
  hasLiveUsage: boolean;
}

/**
 * Real, per-provider accumulated rollup — sums ONLY real, known values.
 * A provider with zero real usage events returns hasLiveUsage=false (the
 * UI renders NO_LIVE_USAGE for it, never a fabricated 0 dressed up as a
 * real measurement — 0 real requests and "not measured yet" are
 * different facts). Token sums exclude UNKNOWN rows entirely rather than
 * treating them as 0, and unknownTokenRequestCount discloses exactly how
 * many were excluded so the sum is never silently understated without
 * saying so.
 */
export async function getAccumulatedUsageSummary(): Promise<AccumulatedUsageSummary[]> {
  const rows = await listUsageWithCost(1000);
  const byProvider = new Map<string, UsageWithCost[]>();
  for (const r of rows) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r);
    byProvider.set(r.provider, list);
  }

  const summaries: AccumulatedUsageSummary[] = [];
  for (const [provider, providerRows] of byProvider) {
    const known = providerRows.filter((r) => r.tokenSource === "PROVIDER_REPORTED");
    const totalInputTokens = known.length > 0 ? known.reduce((s, r) => s + (r.inputTokens ?? 0), 0) : null;
    const totalOutputTokens = known.length > 0 ? known.reduce((s, r) => s + (r.outputTokens ?? 0), 0) : null;
    const totalTokens = known.length > 0 ? known.reduce((s, r) => s + (r.totalTokens ?? 0), 0) : null;

    const totalProviderCostByCurrency: Record<string, number> = {};
    let totalThb = 0;
    let anyThb = false;
    for (const r of providerRows) {
      if (r.providerCost !== null && r.currency) totalProviderCostByCurrency[r.currency] = (totalProviderCostByCurrency[r.currency] ?? 0) + r.providerCost;
      if (r.providerCostThb !== null) { totalThb += r.providerCostThb; anyThb = true; }
    }

    summaries.push({
      provider, requestCount: providerRows.length,
      successCount: providerRows.filter((r) => r.status === "SUCCEEDED" || r.status === "PARTIAL").length,
      totalInputTokens, totalOutputTokens, totalTokens,
      unknownTokenRequestCount: providerRows.filter((r) => r.tokenSource === "UNKNOWN").length,
      totalProviderCostByCurrency, totalProviderCostThb: anyThb ? totalThb : null,
      hasLiveUsage: providerRows.length > 0,
    });
  }
  return summaries;
}

export interface ProviderPayable {
  provider: string;
  entryCount: number;
  totalOwed: Record<string, number>; // keyed by real currency, e.g. {"USD": 1.23} — never merges currencies
  paymentStatus: "OWED_NOT_PAID";
  entryIds: string[];
}

/**
 * Provider Payable Ledger — a real, derived READ VIEW over
 * registry/COST_LEDGER.json grouped by provider, NOT a second, parallel
 * write-side ledger (checked first: supabase/migrations/
 * 20260727000003_owner_surface_and_partner_payable.sql's
 * partner_payable_requests table is real but models a different process
 * — human business-partner payables confirmed via LINE chat + bank slip
 * — not reused here since it doesn't fit an automated cloud provider's
 * billing shape). No payment execution anywhere in this module — every
 * entry is a static "owed, not yet paid" status, per the Owner's
 * explicit "ห้ามสร้างระบบชำระเงิน provider อัตโนมัติในรอบนี้".
 */
export function listProviderPayables(): ProviderPayable[] {
  const entries = listCostLedgerEntries();
  const byProvider = new Map<string, CostLedgerEntry[]>();
  for (const e of entries) {
    if (e.actual_cost === null) continue; // no real actual cost recorded — nothing owed to compute yet
    const list = byProvider.get(e.provider) ?? [];
    list.push(e);
    byProvider.set(e.provider, list);
  }
  const result: ProviderPayable[] = [];
  for (const [provider, providerEntries] of byProvider) {
    const totalOwed: Record<string, number> = {};
    for (const e of providerEntries) {
      totalOwed[e.currency] = (totalOwed[e.currency] ?? 0) + (e.actual_cost ?? 0);
    }
    result.push({ provider, entryCount: providerEntries.length, totalOwed, paymentStatus: "OWED_NOT_PAID", entryIds: providerEntries.map((e) => e.entry_id) });
  }
  return result;
}
