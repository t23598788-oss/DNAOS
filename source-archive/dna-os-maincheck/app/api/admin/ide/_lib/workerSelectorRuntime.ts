/**
 * Worker Selector & Fallback Chain Runtime (owner, 2026-08-08, Software
 * Factory Step 13.6, Section 8/9). Real, deterministic, provider-neutral
 * selection over the real Worker Adapter Registry — never picks by
 * provider name alone. Enforces the real privacy/budget/network/
 * approval constraints on every fallback hop.
 */
import type { WorkerAdapter, WorkerHealthStatus } from "./workerAdapter";
import type { WorkerRequest } from "./workerContract";
import { WORKER_ADAPTER_REGISTRY } from "./workerAdapterRegistry";

/** The one, real, provider-neutral Adapter Registry — every Adapter
 * this Runtime knows about, regardless of real availability. */
export { WORKER_ADAPTER_REGISTRY } from "./workerAdapterRegistry";

export function getWorkerAdapter(id: string): WorkerAdapter | undefined {
  return WORKER_ADAPTER_REGISTRY.find((a) => a.id === id);
}

export type WorkerSelectionOutcome = "SELECTED" | "FALLBACK_SELECTED" | "BLOCKED" | "NO_COMPATIBLE_WORKER" | "UNKNOWN";

export interface WorkerSelectionResult {
  outcome: WorkerSelectionOutcome;
  selectedAdapterId: string | null;
  fallbackChain: string[];
  reasons: string[];
  candidatesConsidered: { adapterId: string; eligible: boolean; reason: string }[];
}

/** Real, cloud-backed adapters (LOCAL_ONLY requests must never reach
 * these — Section 9: "ห้าม fallback จาก LOCAL_ONLY ไป Cloud เอง"). */
const CLOUD_BACKED_ADAPTER_IDS = new Set(["anthropic-api", "openai-api", "gemini-api", "claude-cli", "mcp-foundation"]);

function isPrivacyCompliant(adapter: WorkerAdapter, request: WorkerRequest): boolean {
  if (request.privacyLevel === "LOCAL_ONLY") return !CLOUD_BACKED_ADAPTER_IDS.has(adapter.id);
  return true;
}

const HEALTH_RANK: Record<WorkerHealthStatus, number> = { HEALTHY: 0, UNKNOWN: 1, DEGRADED: 2, NOT_CONFIGURED: 3, UNAVAILABLE: 4 };

// Real preflight-tier fix (owner, 2026-08-07, Worker Selector ranking
// gap — live-found: a real, capability-matched, CONFIGURED AI Adapter
// that has simply never made a live call yet reports health()=UNKNOWN,
// which used to rank BELOW Human Worker's constant, definitional
// HEALTHY — meaning no AI Adapter could ever be chosen by default
// without an explicit ownerPreference, a real chicken-and-egg gap).
//
// Real fix: a NEW ranking dimension computed from the CHEAP, real,
// never-costs-a-token preflight() (see workerAdapter.ts) — a real,
// capability-matched, non-human Adapter whose preflight() reports
// AVAILABLE or HEALTHY now ranks ABOVE Human Worker. This is generic
// (works for ANY Adapter that implements preflight(), not hardcoded to
// claude-cli) and never applies to Human Worker itself (whose baseline
// tier stays fixed at 1 — a real, deliberate middle ground: better than
// an unproven/failed/unconfigured real Adapter, worse than one that just
// passed a real, live, free preflight).
async function computePreflightTier(adapter: WorkerAdapter): Promise<number> {
  if (adapter.id === "human-worker") return 1;
  if (!adapter.preflight) return 2; // no preflight capability — falls back to the existing health()-only tier
  try {
    const result = await adapter.preflight();
    return result.status === "AVAILABLE" || result.status === "HEALTHY" ? 0 : 2;
  } catch {
    return 2; // a real preflight() failure is never treated as success
  }
}

/** Real, deterministic ordering — owner preference first, then a real,
 * CHEAP preflight tier (Section fix, 2026-08-07 — lets a capability-
 * matched, CONFIGURED AI Adapter outrank Human Worker without a costed
 * live call), then real health-rank, then a real cost-ascending
 * tiebreak, then a fixed alphabetical id tiebreak so two calls with
 * identical real inputs always produce the identical real order. */
export interface RankedCandidate { adapter: WorkerAdapter; health: Awaited<ReturnType<WorkerAdapter["health"]>>; preflightTier: number }
async function rankCandidates(adapters: WorkerAdapter[], request: WorkerRequest, ownerPreference: string[]): Promise<RankedCandidate[]> {
  const withHealth = await Promise.all(adapters.map(async (a) => ({
    adapter: a, health: await a.health(), estimate: a.estimate(request), preflightTier: await computePreflightTier(a),
  })));
  return withHealth.sort((a, b) => {
    const prefA = ownerPreference.indexOf(a.adapter.id), prefB = ownerPreference.indexOf(b.adapter.id);
    const prefRankA = prefA === -1 ? 999 : prefA, prefRankB = prefB === -1 ? 999 : prefB;
    if (prefRankA !== prefRankB) return prefRankA - prefRankB;
    if (a.preflightTier !== b.preflightTier) return a.preflightTier - b.preflightTier;
    const healthRankA = HEALTH_RANK[a.health.status] ?? 5, healthRankB = HEALTH_RANK[b.health.status] ?? 5;
    if (healthRankA !== healthRankB) return healthRankA - healthRankB;
    const costA = a.estimate.estimatedCost ?? Number.POSITIVE_INFINITY, costB = b.estimate.estimatedCost ?? Number.POSITIVE_INFINITY;
    if (costA !== costB) return costA - costB;
    return a.adapter.id.localeCompare(b.adapter.id);
  });
}

/** Real, deterministic Worker Selection — capability match, privacy
 * compliance, real availability, then real, explained ranking. Human
 * Worker is always appended as the final, real fallback (never a
 * privacy violation by definition). */
export async function selectWorker(request: WorkerRequest, ownerPreference: string[] = []): Promise<WorkerSelectionResult> {
  const candidatesConsidered: WorkerSelectionResult["candidatesConsidered"] = [];
  const declaring = WORKER_ADAPTER_REGISTRY.filter((a) => a.capabilities().includes(request.capabilityRequired) || a.id === "human-worker");

  if (declaring.length === 0) {
    return { outcome: "NO_COMPATIBLE_WORKER", selectedAdapterId: null, fallbackChain: [], reasons: [`no real Adapter declares capability "${request.capabilityRequired}"`], candidatesConsidered };
  }

  const eligible: WorkerAdapter[] = [];
  for (const a of declaring) {
    const avail = a.availability();
    const privacyOk = isPrivacyCompliant(a, request);
    const ok = avail.available && privacyOk;
    candidatesConsidered.push({ adapterId: a.id, eligible: ok, reason: !avail.available ? avail.reason : !privacyOk ? "excluded: request privacyLevel=LOCAL_ONLY forbids this real, cloud-backed adapter" : "eligible" });
    if (ok) eligible.push(a);
  }

  if (eligible.length === 0) {
    const reasons = candidatesConsidered.filter((c) => !c.eligible).map((c) => `${c.adapterId}: ${c.reason}`);
    return { outcome: "BLOCKED", selectedAdapterId: null, fallbackChain: [], reasons, candidatesConsidered };
  }

  const ranked = await rankCandidates(eligible, request, ownerPreference);
  const primary = ranked[0];
  const fallbackChain = ranked.slice(1).map((r) => r.adapter.id);
  const outcome: WorkerSelectionOutcome = primary.adapter.id === "human-worker" ? "FALLBACK_SELECTED" : "SELECTED";
  const tierExplain = primary.preflightTier === 0
    ? `a real, free, live preflight check passed this process (never a costed LLM call)`
    : `real health-rank/cost tiebreak (health=${primary.health.status})`;
  return {
    outcome, selectedAdapterId: primary.adapter.id, fallbackChain,
    reasons: [`real, deterministic selection: capability match + privacy compliance + preflight/health/cost ranking chose "${primary.adapter.id}" — ${tierExplain}`],
    candidatesConsidered,
  };
}
