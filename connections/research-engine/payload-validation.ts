/**
 * หน้าที่: turn the real, untyped `/api/research/latest` JSON body into
 * `ResearchEngineLatestFields` — defensively, never throwing, matching
 * `../github/payload-validation.ts`'s own discipline of "typed `unknown` in,
 * a checked result out."
 *
 * Real observed shape (2026-08-16, live `curl` against
 * http://localhost:8787/api/research/latest — see ../README.md):
 *   { status, experiment_id, baseline: {...}, candidate: {...},
 *     candidate_warm_lifecycle?: {...} }
 * `candidate` is the model actually under evaluation (the challenger being
 * scored against `baseline`) — this adapter reports on `candidate` because
 * that is the row the Owner's task fields (safety_score, efficiency_score,
 * research_decision, ...) describe. `baseline` is not silently dropped: any
 * capability that later needs it can extend `ResearchEngineLatestFields`
 * explicitly — inventing a second unrequested field set here would be a
 * guess this round is not authorized to make.
 *
 * Input: `unknown` (a parsed JSON body).
 * Output: `ParseOutcome` — `{ ok: true; value }` or `{ ok: false; reason }`.
 * Dependency ที่อนุญาต: ./adapter-contract.ts (types only).
 * สิ่งที่ห้ามแตะ: ห้าม throw จากไฟล์นี้ในทุกกรณี — response ที่ผิดรูปแบบ
 * ต้องกลายเป็น `{ ok: false, reason }` เสมอ ไม่ใช่ exception ที่หลุดขึ้นไป.
 */

import type { ResearchEngineLatestFields } from "./adapter-contract";

export type ParseOutcome = { ok: true; value: ResearchEngineLatestFields } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** `formulas.<NAME>.value` is documented to be either a real number or the literal string "NOT_MEASURED"/"UNDEFINED" — both are passed through as-is, never coerced. */
function numberOrStringOrNull(value: unknown): number | string | null {
  return typeof value === "number" || typeof value === "string" ? value : null;
}

function recordOrNull(value: unknown): Readonly<Record<string, unknown>> | null {
  return isRecord(value) ? value : null;
}

function costFromExecution(execution: unknown): Readonly<Record<string, unknown>> | null {
  if (!isRecord(execution)) return null;
  const out: Record<string, unknown> = {};
  for (const key of [
    "input_tokens", "output_tokens", "cached_input_tokens", "cached_output_tokens",
    "reasoning_tokens", "total_tokens", "provider_cost_usd", "cost_usd",
    "cost_source", "pricing_version", "fx_rate_usd_thb", "fx_rate_source",
    "fx_rate_timestamp", "cost_thb",
  ]) out[key] = execution[key] ?? null;
  const metadata = recordOrNull(execution["metadata"]);
  if (metadata && recordOrNull(metadata["cost"])) out["metadata_cost"] = metadata["cost"];
  return out;
}

function processFromExecution(execution: unknown): Readonly<Record<string, unknown>> | null {
  if (!isRecord(execution)) return null;
  const metadata = recordOrNull(execution["metadata"]);
  const processMeasurement = metadata ? recordOrNull(metadata["process_measurement"]) : null;
  if (processMeasurement) return processMeasurement;
  return null;
}

function workIdFromExecution(execution: unknown): string | null {
  if (!isRecord(execution)) return null;
  const metadata = recordOrNull(execution["metadata"]);
  return metadata ? stringOrNull(metadata["work_id"]) : null;
}

/** Collects every key whose name contains "latency" (case-insensitive) out of the given objects, without assuming exact field names — see ./adapter-contract.ts's documented assumption on ResearchEngineLatestFields.latency. */
function collectLatencyFields(...sources: unknown[]): Record<string, unknown> {
  const collected: Record<string, unknown> = {};
  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (/latency/i.test(key)) collected[key] = value;
    }
  }
  return collected;
}

export function parseLatestResearchResult(raw: unknown): ParseOutcome {
  if (!isRecord(raw)) {
    return { ok: false, reason: "response body is not a JSON object" };
  }

  const experimentId = stringOrNull(raw["experiment_id"]);
  if (experimentId === null) {
    return { ok: false, reason: "missing or non-string top-level field: experiment_id" };
  }

  const candidate = isRecord(raw["candidate"]) ? raw["candidate"] : raw;
  if (!isRecord(candidate)) {
    return { ok: false, reason: "missing or non-object top-level field: candidate" };
  }

  const identity = candidate["identity"];
  if (!isRecord(identity)) {
    return { ok: false, reason: "missing or non-object field: candidate.identity" };
  }

  const runId = stringOrNull(candidate["run_id"]) ?? stringOrNull(identity["run_id"]);
  if (runId === null) {
    return { ok: false, reason: "missing run_id (checked both candidate.run_id and candidate.identity.run_id)" };
  }

  const provider = stringOrNull(identity["provider"]);
  const modelId = stringOrNull(identity["model_id"]);
  if (provider === null) {
    return { ok: false, reason: "missing or non-string field: candidate.identity.provider" };
  }
  if (modelId === null) {
    return { ok: false, reason: "missing or non-string field: candidate.identity.model_id" };
  }

  const metrics = isRecord(candidate["metrics"]) ? candidate["metrics"] : {};
  const formulas = isRecord(candidate["formulas"]) ? candidate["formulas"] : {};
  const lifecycle = isRecord(candidate["lifecycle"]) ? candidate["lifecycle"] : {};
  const decision = isRecord(candidate["decision"]) ? candidate["decision"] : null;

  const formulaValue = (name: string): number | string | null => {
    const entry = formulas[name];
    if (!isRecord(entry)) return null;
    return numberOrStringOrNull(entry["value"]);
  };

  const value: ResearchEngineLatestFields = {
    experiment_id: experimentId,
    run_id: runId,
    research_execution_id: stringOrNull(recordOrNull(raw["execution"])?.["execution_id"]),
    work_id: workIdFromExecution(raw["execution"]),
    provider,
    model_id: modelId,
    safety_score: formulaValue("SAFETY_SCORE"),
    efficiency_score: formulaValue("EFFICIENCY_SCORE"),
    value_gain: formulaValue("VALUE_GAIN"),
    resource_penalty: formulaValue("RESOURCE_PENALTY"),
    model_utility_score: formulaValue("MODEL_UTILITY_SCORE"),
    research_decision: decision !== null ? stringOrNull(decision["decision"]) : null,
    false_allow: numberOrNull(metrics["false_allow_rate"]),
    unknown_rate: numberOrNull(metrics["unknown_rate"]),
    malformed_rate: numberOrNull(metrics["malformed_rate"]),
    metrics,
    formulas,
    decision,
    cost: costFromExecution(raw["execution"]),
    process: processFromExecution(raw["execution"]),
    latency: collectLatencyFields(metrics, lifecycle),
  };

  return { ok: true, value };
}
