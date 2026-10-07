/**
 * หน้าที่: the only file in this folder that actually calls the real
 * research engine HTTP API. GET-only, two endpoints — health and latest —
 * matching `../github/github-read-api.ts`'s role for GitHub's REST API.
 *
 * Input: base URL + timeout (never a default guessed inside this file —
 * always passed in by the caller, see ./research-engine-adapter.ts).
 * Output: `checkResearchEngineHealth`, `fetchResearchEngineLatest`.
 * Dependency ที่อนุญาต: ./adapter-config.ts (paths only, not the base URL
 * default — that stays a caller-supplied parameter here too, for
 * testability), ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม method อื่นนอกจาก GET เด็ดขาด — ไม่มี body
 * parameter ใน function ใดในไฟล์นี้.
 */

import { RESEARCH_ENGINE_HEALTH_PATH, RESEARCH_ENGINE_LATEST_PATH, RESEARCH_ENGINE_LINEAGE_LATEST_PATH } from "./adapter-config";
import { hostFetch } from "./host-runtime";

const JSON_ACCEPT_HEADERS: Record<string, string> = { Accept: "application/json" };

export interface HealthCheckOutcome {
  healthy: boolean;
  http_status: number | null;
  reason: string | null;
}

/**
 * `healthy: true` only on a real HTTP 200-299 response from
 * `/api/research/health`. Any transport failure, timeout, or non-2xx status
 * is `healthy: false` with a human-readable reason — never thrown.
 */
export async function checkResearchEngineHealth(baseUrl: string, timeoutMilliseconds: number): Promise<HealthCheckOutcome> {
  const outcome = await hostFetch(`${baseUrl}${RESEARCH_ENGINE_HEALTH_PATH}`, JSON_ACCEPT_HEADERS, timeoutMilliseconds);
  if (outcome.kind === "transport_error") {
    return { healthy: false, http_status: null, reason: outcome.reason };
  }
  if (!outcome.response.ok) {
    return { healthy: false, http_status: outcome.response.status, reason: `health endpoint returned HTTP ${outcome.response.status}` };
  }
  return { healthy: true, http_status: outcome.response.status, reason: null };
}

export type LatestFetchOutcome =
  | { kind: "ok"; http_status: number; body: unknown }
  | { kind: "http_error"; http_status: number; reason: string }
  | { kind: "transport_error"; reason: string }
  | { kind: "invalid_json"; reason: string };

/**
 * Fetches `/api/research/latest` and returns its parsed JSON body as
 * `unknown` — this file never assumes the shape; that is
 * ./payload-validation.ts's job. A non-2xx status and a JSON parse failure
 * are both reported as data, never thrown.
 */
export async function fetchResearchEngineLatest(baseUrl: string, timeoutMilliseconds: number): Promise<LatestFetchOutcome> {
  const outcome = await hostFetch(`${baseUrl}${RESEARCH_ENGINE_LATEST_PATH}`, JSON_ACCEPT_HEADERS, timeoutMilliseconds);
  if (outcome.kind === "transport_error") {
    return { kind: "transport_error", reason: outcome.reason };
  }
  if (!outcome.response.ok) {
    return { kind: "http_error", http_status: outcome.response.status, reason: `latest endpoint returned HTTP ${outcome.response.status}` };
  }
  try {
    const body = await outcome.response.json();
    return { kind: "ok", http_status: outcome.response.status, body };
  } catch (error) {
    return { kind: "invalid_json", reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fetches the read-only lineage slice when the Research Monitor API exposes
 * it. The adapter treats absence as data, not as permission to fabricate:
 * callers can fall back to `/api/research/latest`, but execution/cost/process
 * fields then remain null.
 */
export async function fetchResearchEngineLatestLineage(baseUrl: string, timeoutMilliseconds: number): Promise<LatestFetchOutcome> {
  const outcome = await hostFetch(`${baseUrl}${RESEARCH_ENGINE_LINEAGE_LATEST_PATH}`, JSON_ACCEPT_HEADERS, timeoutMilliseconds);
  if (outcome.kind === "transport_error") {
    return { kind: "transport_error", reason: outcome.reason };
  }
  if (!outcome.response.ok) {
    return { kind: "http_error", http_status: outcome.response.status, reason: `lineage endpoint returned HTTP ${outcome.response.status}` };
  }
  try {
    const body = await outcome.response.json();
    return { kind: "ok", http_status: outcome.response.status, body };
  } catch (error) {
    return { kind: "invalid_json", reason: error instanceof Error ? error.message : String(error) };
  }
}
