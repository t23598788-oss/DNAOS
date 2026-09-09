/**
 * หน้าที่: the capability's entry point — the one function
 * `../../control/command-router/router.ts` calls when it routes to
 * `capability_id: "research-engine"`. Always resolves to a
 * `ResearchEngineStepOutcome`, never throws, matching
 * `../github/github-adapter.ts`'s "never let a rejection or a network
 * failure escape as an exception" discipline.
 *
 * Order: health-check first (`GET /api/research/health`), THEN read
 * (`GET /api/research/latest`) — a command never reaches the read endpoint
 * of a service that just failed its own health check. Offline (transport
 * failure, timeout, non-2xx, or a failed health check) always resolves to
 * `status: BLOCKED` with the `RESEARCH_ENGINE_OFFLINE` warning — never a
 * synthesized/mocked research result (Owner requirement: no mock fallback).
 *
 * Input: none required — `{ baseUrl, timeoutMilliseconds }` optional,
 * defaulting to ./adapter-config.ts's real constants. Overridable so
 * ./tests/adapter.test.ts can point at a fake local server without
 * touching the default.
 * Output: `ResearchEngineStepOutcome` (../../contracts/command/capability-result.ts-shaped
 * minus task_id/capability_id — the router adds those, see
 * ../../control/command-router/router.ts).
 * Dependency ที่อนุญาต: ./adapter-contract.ts, ./adapter-config.ts,
 * ./research-read-api.ts, ./payload-validation.ts.
 * สิ่งที่ห้ามแตะ: ห้าม throw ออกจาก `fetchResearchEngineLatestResult` หรือ
 * `checkResearchEngineLiveHealth` ไม่ว่ากรณีใด — ทุก error path ต้องจบเป็น
 * ค่าที่ return, ไม่ใช่ exception. ห้าม synthesize ผลลัพธ์งานวิจัยปลอมเมื่อ
 * service offline.
 */

import { RESEARCH_ENGINE_ADAPTER_NAME, RESEARCH_ENGINE_MALFORMED_WARNING, RESEARCH_ENGINE_OFFLINE_WARNING, type ResearchEngineStepOutcome } from "./adapter-contract";
import { RESEARCH_ENGINE_BASE_URL, RESEARCH_ENGINE_REQUEST_TIMEOUT_MILLISECONDS } from "./adapter-config";
import { checkResearchEngineHealth, fetchResearchEngineLatest, fetchResearchEngineLatestLineage } from "./research-read-api";
import { parseLatestResearchResult } from "./payload-validation";

export interface FetchResearchEngineOptions {
  baseUrl?: string;
  timeoutMilliseconds?: number;
}

function evidence(note: string) {
  return { source: RESEARCH_ENGINE_ADAPTER_NAME, note };
}

function offlineOutcome(reason: string): ResearchEngineStepOutcome {
  return {
    status: "BLOCKED",
    evidenceEntries: [evidence(`unreachable: ${reason}`)],
    artifacts: [],
    warnings: [RESEARCH_ENGINE_OFFLINE_WARNING],
    summary: `research-engine is offline: ${reason}`,
  };
}

function malformedOutcome(reason: string): ResearchEngineStepOutcome {
  return {
    status: "FAILED",
    evidenceEntries: [evidence(`malformed response from /api/research/latest: ${reason}`)],
    artifacts: [],
    warnings: [RESEARCH_ENGINE_MALFORMED_WARNING],
    summary: `research-engine returned a malformed response: ${reason}`,
  };
}

/**
 * The single public entry point of `connections/research-engine/`. Always
 * resolves — never throws — to a `ResearchEngineStepOutcome`.
 */
export async function fetchResearchEngineLatestResult(options: FetchResearchEngineOptions = {}): Promise<ResearchEngineStepOutcome> {
  const baseUrl = options.baseUrl ?? RESEARCH_ENGINE_BASE_URL;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? RESEARCH_ENGINE_REQUEST_TIMEOUT_MILLISECONDS;

  const health = await checkResearchEngineHealth(baseUrl, timeoutMilliseconds);
  if (!health.healthy) {
    return offlineOutcome(health.reason ?? "health check failed for an unstated reason");
  }

  const lineage = await fetchResearchEngineLatestLineage(baseUrl, timeoutMilliseconds);
  const latest = lineage.kind === "ok" ? lineage : await fetchResearchEngineLatest(baseUrl, timeoutMilliseconds);
  if (latest.kind === "transport_error") return offlineOutcome(latest.reason);
  if (latest.kind === "http_error") return offlineOutcome(latest.reason);
  if (latest.kind === "invalid_json") return malformedOutcome(`response body was not valid JSON: ${latest.reason}`);

  const parsed = parseLatestResearchResult(latest.body);
  if (!parsed.ok) return malformedOutcome(parsed.reason);

  const f = parsed.value;
  return {
    status: "COMPLETED",
    evidenceEntries: [
      evidence(`experiment_id=${f.experiment_id} run_id=${f.run_id} provider=${f.provider} model_id=${f.model_id}`),
      evidence(`research_execution_id=${String(f.research_execution_id)} work_id=${String(f.work_id)}`),
      evidence(
        `safety_score=${String(f.safety_score)} efficiency_score=${String(f.efficiency_score)} value_gain=${String(f.value_gain)} resource_penalty=${String(f.resource_penalty)} model_utility_score=${String(f.model_utility_score)}`
      ),
      evidence(`research_decision=${String(f.research_decision)} false_allow=${String(f.false_allow)} unknown_rate=${String(f.unknown_rate)} malformed_rate=${String(f.malformed_rate)}`),
      evidence(`cost=${JSON.stringify(f.cost)}`),
      evidence(`process=${JSON.stringify(f.process)}`),
      evidence(`latency=${JSON.stringify(f.latency)}`),
    ],
    artifacts: [
      { kind: "research_run_id", ref: f.run_id },
      ...(f.research_execution_id ? [{ kind: "research_execution_id", ref: f.research_execution_id }] : []),
      ...(f.work_id ? [{ kind: "work_id", ref: f.work_id }] : []),
    ],
    warnings: [],
    summary: `research-engine latest result: experiment ${f.experiment_id}, run ${f.run_id} (${f.provider}/${f.model_id}), decision=${String(f.research_decision)}`,
  };
}

/**
 * Live health flag for a caller that only needs to know "is it up right
 * now" without paying for a full `/api/research/latest` read — used by
 * ../../control/command-router/ so a static registry `CONNECTED` (meaning
 * "adapter exists and is wired") never gets confused with "the real
 * service is reachable this instant" — see ../../control/command-router/ARCHITECTURE_DECISIONS.md.
 */
export async function checkResearchEngineLiveHealth(options: FetchResearchEngineOptions = {}): Promise<boolean> {
  const baseUrl = options.baseUrl ?? RESEARCH_ENGINE_BASE_URL;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? RESEARCH_ENGINE_REQUEST_TIMEOUT_MILLISECONDS;
  const health = await checkResearchEngineHealth(baseUrl, timeoutMilliseconds);
  return health.healthy;
}
