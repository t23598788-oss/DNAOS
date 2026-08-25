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
 * Input: `ReportJointInput`/`ReportViolationInput`; env `JOINT_MONITOR_URL`
 * (where to report) and `JOINT_MONITOR_SHARED_SECRET` (the secret the
 * target server checks — sent as `Bearer <secret>`, omitted entirely when
 * unset, matching ./server.ts#requireSharedSecret's own "no secret
 * configured -> accept" branch).
 * Output: `Promise<void>` — resolves whether or not the POST actually
 * landed; callers that only want fire-and-forget should not even await
 * it (`void reportJoint(...)` at the call site).
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let a failed/timed-out POST reject — every path
 * through this file resolves, per the header above.
 */

import { hostPostJson, hostRandomId, nowIso, readEnvVar } from "./host-runtime";
import type { OccurrenceStamp, ReportJointInput, ReportViolationInput } from "./types";

// Moved off 5177 2026-08-22 — that port is DNA-LAB-PERMISSION-REASONER's
// real Research Monitor UI, not this repo's to claim (see start.ts's own
// header comment for the correction).
const DEFAULT_BASE_URL = "http://127.0.0.1:5178";
const REPORT_TIMEOUT_MS = 500;
// A remote (Railway) joint-monitor is reached over the public internet,
// not loopback — 500ms is a loopback budget. Raised only for the remote
// case so the local Mac path keeps its original, proven timing.
const REMOTE_REPORT_TIMEOUT_MS = 3000;

function baseUrl(): string {
  return readEnvVar("JOINT_MONITOR_URL") ?? DEFAULT_BASE_URL;
}

function isRemote(url: string): boolean {
  return !url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost") && !url.startsWith("http://[::1]");
}

function timeoutFor(url: string): number {
  return isRemote(url) ? REMOTE_REPORT_TIMEOUT_MS : REPORT_TIMEOUT_MS;
}

/**
 * The `Authorization` value this reporter sends, or `undefined` when no
 * secret is configured (today's real local Mac case — a loopback
 * joint-monitor with no JOINT_MONITOR_SHARED_SECRET set accepts writes
 * unauthenticated, see ./server.ts#requireSharedSecret). Same env var
 * name the server reads, so one value configures both ends.
 */
function authorizationHeader(): string | undefined {
  const secret = readEnvVar("JOINT_MONITOR_SHARED_SECRET");
  return secret && secret.length > 0 ? `Bearer ${secret}` : undefined;
}

/**
 * EVENT_OCCURRED_ORDER, stamped here — inside the reporting process, at
 * the moment the real call site fired, BEFORE the POST is handed to the
 * network (2026-08-26, Owner).
 *
 * This is the whole ordering fix. `control/agent-gateway/gateway.ts`'s
 * `persistStatus` fires `void reportJoint(...)` without awaiting, five
 * times in a row for one task, so five POSTs are in flight at once; over
 * a real network they land in arbitrary order, and the collector's
 * arrival stamp then reports that arbitrary order as if it were the
 * task's real history (proven live: a real task displayed FAILED before
 * VERIFYING). Nothing about that concurrency is wrong — it is what keeps
 * a dashboard from blocking a real Owner command — so the emission order
 * is captured before it can be lost, instead of trying to serialise the
 * sends.
 *
 * `RUN_ID` scopes the counter to this one process: two reporters each
 * counting from 1 must never be compared as if they shared a sequence,
 * so consumers order by (occurred_at, reporter_run_id, occurred_seq).
 */
const RUN_ID = hostRandomId();
let occurredSeq = 0;

function nextOccurrenceStamp(): OccurrenceStamp {
  occurredSeq += 1;
  return { occurred_at: nowIso(), occurred_seq: occurredSeq, reporter_run_id: RUN_ID };
}

export async function reportJoint(input: ReportJointInput): Promise<void> {
  const stamp = nextOccurrenceStamp();
  const url = baseUrl();
  await hostPostJson(`${url}/joints`, { ...input, ...stamp }, timeoutFor(url), authorizationHeader());
}

export async function reportViolation(input: ReportViolationInput): Promise<void> {
  const stamp = nextOccurrenceStamp();
  const url = baseUrl();
  await hostPostJson(`${url}/violations`, { ...input, ...stamp }, timeoutFor(url), authorizationHeader());
}
