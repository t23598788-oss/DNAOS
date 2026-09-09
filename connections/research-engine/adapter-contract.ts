/**
 * หน้าที่: this adapter's own public contract — the intent it answers, the
 * fields it preserves out of a real `/api/research/latest` response, and
 * the step-outcome shape `../../control/command-router/router.ts` folds
 * into a `CapabilityResult`. Lives inside this capability folder on
 * purpose — Capability Folder Law ข้อ 3 — same reasoning as
 * `../github/adapter-contract.ts`.
 *
 * Input: none (pure type definitions + constants).
 * Output: the types/constants below.
 * Dependency ที่อนุญาต: `../../contracts/command/capability-result.ts`
 * (the shared result-shape contract every capability step maps into —
 * `ResearchEngineStepOutcome` below is deliberately field-for-field the
 * same shape `control/command-router/router.ts`'s own private `StepOutcome`
 * already uses for every other capability, so wiring this adapter in is a
 * straight passthrough, not a new mapping layer).
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ใดที่ทำให้ผลลัพธ์นี้พก credential หรือ
 * เขียนกลับไปที่ research engine — capability นี้เป็น GET-only เท่านั้น.
 */

import type { CapabilityResultArtifact, CapabilityResultEvidence, CapabilityResultStatus } from "../../contracts/command/capability-result";

/** Must equal this folder's own name — mirrors GITHUB_ADAPTER_NAME's role in ../github/adapter-contract.ts. */
export const RESEARCH_ENGINE_ADAPTER_NAME = "research-engine";

export const RESEARCH_ENGINE_INTENTS = {
  latestResults: "research-engine.latest_results",
} as const;
export type ResearchEngineIntent = (typeof RESEARCH_ENGINE_INTENTS)[keyof typeof RESEARCH_ENGINE_INTENTS];

/** The one warning string this capability emits when the real service cannot be reached — a fixed, greppable code, never a free-form sentence, so a caller can branch on it. */
export const RESEARCH_ENGINE_OFFLINE_WARNING = "RESEARCH_ENGINE_OFFLINE";

/** Emitted (alongside status FAILED) when `/api/research/latest` responds but its body is not the documented shape — this is distinct from "offline": the service IS up, its answer just could not be parsed. */
export const RESEARCH_ENGINE_MALFORMED_WARNING = "RESEARCH_ENGINE_MALFORMED_RESPONSE";

/**
 * Every field the Owner's task explicitly requires preserved out of a real
 * `/api/research/latest` response, extracted from its `candidate` object
 * (the model actually under evaluation — see ./payload-validation.ts for
 * why `candidate`, not `baseline`, is the row of record). Nothing here is
 * synthesized: a numeric field the server reports as the literal string
 * "NOT_MEASURED" (observed 2026-08-16 for VALUE_GAIN / RESOURCE_PENALTY /
 * MODEL_UTILITY_SCORE before enough samples exist) is passed through as
 * that same string, never coerced to 0 or null.
 */
export interface ResearchEngineLatestFields {
  experiment_id: string;
  run_id: string;
  research_execution_id: string | null;
  work_id: string | null;
  provider: string;
  model_id: string;
  safety_score: number | string | null;
  efficiency_score: number | string | null;
  value_gain: number | string | null;
  resource_penalty: number | string | null;
  model_utility_score: number | string | null;
  /** From `candidate.decision.decision` — e.g. "INSUFFICIENT_DATA", "ADOPT", "REJECT" (whatever the server reports; not re-interpreted here). `null` when the server reports no decision object at all. */
  research_decision: string | null;
  /** From `candidate.metrics.false_allow_rate` — see ./README.md "field-name mapping" for why this is a rename, not a drop. */
  false_allow: number | null;
  unknown_rate: number | null;
  malformed_rate: number | null;
  metrics: Readonly<Record<string, unknown>>;
  formulas: Readonly<Record<string, unknown>>;
  decision: Readonly<Record<string, unknown>> | null;
  cost: Readonly<Record<string, unknown>> | null;
  process: Readonly<Record<string, unknown>> | null;
  /**
   * ASSUMPTION (documented, not guessed): every key from
   * `candidate.metrics` and `candidate.lifecycle` whose name contains
   * "latency" (case-insensitive), collected without assuming exact names.
   * The real server observed 2026-08-16 returns
   * average_latency_ms/p50_latency_ms/p95_latency_ms/p99_latency_ms under
   * `metrics`, and cold_start_latency_ms/warm_latency_ms under
   * `lifecycle` — all six land here under their own original key names.
   */
  latency: Readonly<Record<string, unknown>>;
}

/**
 * What `fetchResearchEngineLatestResult` (./research-engine-adapter.ts)
 * always resolves to — never throws. Field-for-field the same shape
 * `control/command-router/router.ts`'s private `StepOutcome` type already
 * uses, so the router assigns `task_id`/`capability_id` and is done; no
 * capability-specific mapping code is needed in the router for this
 * capability, same as it needs none for `../github/`'s emitted event once
 * mapped by `runGithubStep`.
 */
export interface ResearchEngineStepOutcome {
  status: CapabilityResultStatus;
  evidenceEntries: CapabilityResultEvidence[];
  artifacts: CapabilityResultArtifact[];
  warnings: string[];
  summary: string;
}
