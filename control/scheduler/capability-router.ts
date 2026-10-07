/**
 * หน้าที่: THE CAPABILITY ROUTER — the ONE place that decides WHICH real
 * `ProcessingUnit` (`./provider-pool.ts`) handles a given reasoning-class
 * `WorkItem`. Owner's explicit rule: "อย่าผูกว่า CLAUDE = REPAIR หรือ CODEX
 * = IMPLEMENT ตายตัว" — no `WorkKind -> ProviderKind` table exists anywhere
 * in this file or this repo. Every provider capable of reasoning at all
 * (`CLAUDE`, `CODEX`, `GEMINI`) starts with the SAME capability score for
 * EVERY reasoning kind; the unit actually picked is decided at dispatch
 * time from real availability, real historical latency, and real
 * historical success rate — never from which kind is being routed.
 *
 * COST is honestly excluded from the score (see `./provider-pool.ts`'s own
 * header — no real token/cost field exists in this repo's result contract
 * yet). Scoring only on capability/availability/latency/success would be a
 * silent omission if left unstated, so it is named here instead: the score
 * formula has a documented gap, not a guessed number filling it.
 *
 * Input: one `WorkItem`, the real discovered pool, real in-flight counts
 * per provider, the real historical metric ledger.
 * Output: `routeWork` -> `RouteDecision`.
 * Dependency ที่อนุญาต: ./provider-pool.ts (types + REASONING_WORK_KINDS),
 * ../work-graph/types.ts (types only).
 * สิ่งที่ห้ามแตะ: never special-case a specific `WorkKind` when computing
 * `capability_base` — the whole point of this file is that the kind does
 * not decide the provider. Never treat "no history" as "bad" or "good" —
 * an unproven provider gets the neutral prior, not a penalty or a bonus.
 */

import type { ProcessingUnit, ProviderKind, ProviderMetricRecord } from "./provider-pool";
import type { WorkItem, WorkKind } from "../work-graph/types";

/**
 * Real, equal-by-construction: every reasoning-capable provider gets the
 * SAME base score for EVERY reasoning kind. `LOCAL` is declared separately,
 * far lower — a real, always-available, zero-cost, zero-real-reasoning
 * fallback (see `./reasoning-worker.ts`'s own honest
 * `LOCAL_WORKER_NO_REASONING_CAPABILITY` report), never preferred over an
 * available real reasoning provider.
 */
export const REASONING_CAPABLE_PROVIDERS: readonly ProviderKind[] = ["CLAUDE", "CODEX", "GEMINI"];
const CAPABILITY_BASE: Record<ProviderKind, number> = { CLAUDE: 1.0, CODEX: 1.0, GEMINI: 1.0, LOCAL: 0.05 };

export type RouteDecision =
  | { ok: true; unit: ProcessingUnit; score: number; reason: string; candidates_considered: number }
  | { ok: false; reason: string };

interface HistoryStats {
  success_rate: number | null; // null = no history at all (neutral prior applied at score time, not here)
  avg_latency_ms: number | null;
  attempts: number;
}

function historyFor(provider: ProviderKind, kind: WorkKind, metrics: readonly ProviderMetricRecord[]): HistoryStats {
  const relevant = metrics.filter((m) => m.provider === provider && m.work_kind === kind);
  if (relevant.length === 0) return { success_rate: null, avg_latency_ms: null, attempts: 0 };
  const successes = relevant.filter((m) => m.outcome === "VERIFIED" || m.outcome === "PARTIAL").length;
  const avgLatency = relevant.reduce((sum, m) => sum + m.duration_ms, 0) / relevant.length;
  return { success_rate: successes / relevant.length, avg_latency_ms: avgLatency, attempts: relevant.length };
}

/**
 * score = capability_base * (0.5 + success_rate) - latency_penalty
 *   - `success_rate` defaults to the neutral prior 0.5 with no history —
 *     an unproven provider is neither favored nor punished.
 *   - `latency_penalty` is 0 with no history (an untried provider is not
 *     assumed slow) — real, observed latency is what costs points, capped
 *     at 1.0 (a 10-minute average) so one outlier cannot zero out an
 *     otherwise-capable provider.
 */
function scoreUnit(unit: ProcessingUnit, kind: WorkKind, metrics: readonly ProviderMetricRecord[]): { score: number; stats: HistoryStats } {
  const stats = historyFor(unit.provider, kind, metrics);
  const successTerm = stats.success_rate ?? 0.5;
  const latencyPenalty = stats.avg_latency_ms ? Math.min(1.0, stats.avg_latency_ms / 600_000) : 0;
  const score = CAPABILITY_BASE[unit.provider] * (0.5 + successTerm) - latencyPenalty;
  return { score, stats };
}

export function routeWork(
  item: WorkItem,
  pool: readonly ProcessingUnit[],
  inFlightByProvider: ReadonlyMap<ProviderKind, number>,
  metrics: readonly ProviderMetricRecord[],
): RouteDecision {
  const capacityByProvider = new Map<ProviderKind, number>();
  for (const u of pool) capacityByProvider.set(u.provider, (capacityByProvider.get(u.provider) ?? 0) + 1);

  const candidates = pool.filter((u) => {
    if (!u.available) return false;
    const inFlight = inFlightByProvider.get(u.provider) ?? 0;
    const capacity = capacityByProvider.get(u.provider) ?? 0;
    return inFlight < capacity;
  });

  if (candidates.length === 0) {
    const unavailable = pool.filter((u) => !u.available).map((u) => `${u.unit_id}(${u.detail})`);
    return { ok: false, reason: `NO_AVAILABLE_PROVIDER: every real unit is either unavailable on this host or already at its concurrency cap. Unavailable: ${unavailable.join(", ") || "none"}` };
  }

  let best: { unit: ProcessingUnit; score: number; stats: HistoryStats } | null = null;
  for (const unit of candidates) {
    const { score, stats } = scoreUnit(unit, item.kind, metrics);
    if (!best || score > best.score || (score === best.score && unit.unit_id < best.unit.unit_id)) {
      best = { unit, score, stats };
    }
  }

  const b = best!;
  return {
    ok: true,
    unit: b.unit,
    score: b.score,
    reason: `capability_base=${CAPABILITY_BASE[b.unit.provider]} success_rate=${b.stats.success_rate ?? "no_history(neutral 0.5)"} avg_latency_ms=${b.stats.avg_latency_ms ?? "no_history(no_penalty)"} attempts=${b.stats.attempts} among ${candidates.length} available candidate(s)`,
    candidates_considered: candidates.length,
  };
}
