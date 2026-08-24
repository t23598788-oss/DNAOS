/**
 * หน้าที่: the reporting side of `observability/joint-monitor/` —
 * `reportJoint`/`reportViolation`, the two functions
 * `control/command-router/router.ts` and `control/agent-gateway/gateway.ts`
 * (Pillar 1's two hook points) and `control/circuit-breaker/` call to
 * mirror a real event to the live dashboard. Both are `void`-fired by
 * every caller — this file's job is to make that safe: never throw,
 * never await-block the caller waiting on a dashboard that may not be
 * running, matching `../../dna-os-circuit/runtime/server.ts`'s
 * `handleSse`'s "a dropped client/dead sink must never break the real
 * caller" discipline.
 *
 * Input: `ReportJointInput`/`ReportViolationInput`.
 * Output: `Promise<void>` — resolves whether or not the POST actually
 * landed; callers that only want fire-and-forget should not even await
 * it (`void reportJoint(...)` at the call site).
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let a failed/timed-out POST reject — every path
 * through this file resolves, per the header above.
 */

import { hostPostJson, readEnvVar } from "./host-runtime";
import type { ReportJointInput, ReportViolationInput } from "./types";

// Moved off 5177 2026-08-22 — that port is DNA-LAB-PERMISSION-REASONER's
// real Research Monitor UI, not this repo's to claim (see start.ts's own
// header comment for the correction).
const DEFAULT_BASE_URL = "http://127.0.0.1:5178";
const REPORT_TIMEOUT_MS = 500;

function baseUrl(): string {
  return readEnvVar("JOINT_MONITOR_URL") ?? DEFAULT_BASE_URL;
}

export async function reportJoint(input: ReportJointInput): Promise<void> {
  await hostPostJson(`${baseUrl()}/joints`, input, REPORT_TIMEOUT_MS);
}

export async function reportViolation(input: ReportViolationInput): Promise<void> {
  await hostPostJson(`${baseUrl()}/violations`, input, REPORT_TIMEOUT_MS);
}
