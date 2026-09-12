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
import type { OccurrenceStamp, ReportJointInput, ReportViolationInput, JointReport, ViolationReport } from "./types";
import {
  ensureRuntimeEndpointsLoaded,
  resolveRuntimeEndpoint,
} from "../../control/runtime-endpoint-registry/contract";

// Moved off 5177 2026-08-22 — that port is DNA-LAB-PERMISSION-REASONER's
// real Research Monitor UI, not this repo's to claim (see start.ts's own
// header comment for the correction).
const REPORT_TIMEOUT_MS = 500;
const REMOTE_REPORT_TIMEOUT_MS = 3000;

function baseUrl(): string {
  const configured = readEnvVar("JOINT_MONITOR_URL");
  if (configured && configured.length > 0) return configured;
  ensureRuntimeEndpointsLoaded();
  const resolved = resolveRuntimeEndpoint({ query: "endpoint://joint-monitor/local", purpose: "execute" });
  if (resolved.ok) return resolved.endpoint.address;
  return "";
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

/**
 * DELIVERY RESULT (2026-08-26). Returned `void` while
 * `./host-runtime.ts#hostPostJson` catches every error and returns
 * `{ ok: false }` — so a caller could not tell a real report from a dead
 * channel. Same fix already applied to `reportViolation`. Returning a value
 * instead of `void` is backward compatible: callers ignoring it are
 * unaffected.
 */
export type JointListener = (report: JointReport) => void;
export type ViolationListener = (report: ViolationReport) => void;
const jointListeners = new Set<JointListener>();
const violationListeners = new Set<ViolationListener>();

/**
 * PRODUCER-TIME subscription (Owner, CONNECTION 2)
 *
 * SSE ยังคงเป็น "ทางออกเชิงสังเกต" ของ joint-monitor เหมือนเดิมและไม่ถูกใช้เป็น
 * ทางควบคุม — hook นี้เป็นคนละทาง ยิงที่จุดผลิตก่อนออกเน็ตเวิร์ก จึงไม่ขึ้นกับ
 * ว่า collector จะรับได้หรือไม่ และไม่ใช่การอ่าน store กลับ
 *
 * อ่านอย่างเดียว: ค่าที่คืนถูกทิ้ง ผู้ฟังที่ throw ถูกกลืน — การรายงาน joint ต้อง
 * ไม่พังเพราะผู้บริโภคปลายทาง
 */
export function onJoint(listener: JointListener): () => void {
  jointListeners.add(listener);
  return () => { jointListeners.delete(listener); };
}

export function onViolation(listener: ViolationListener): () => void {
  violationListeners.add(listener);
  return () => { violationListeners.delete(listener); };
}

export async function reportJoint(input: ReportJointInput): Promise<{ ok: boolean }> {
  const stamp = nextOccurrenceStamp();
  const url = baseUrl();
  const report: JointReport = { ...input, ...stamp };
  for (const listener of jointListeners) {
    try { listener(report); } catch { /* ผู้ฟังพังต้องไม่ทำให้การรายงานพัง */ }
  }
  if (!url) return { ok: false };
  return hostPostJson(`${url}/joints`, report, timeoutFor(url), authorizationHeader());
}

/**
 * DELIVERY RESULT (2026-08-26). This returned `void` while
 * `./host-runtime.ts#hostPostJson` catches every error and returns
 * `{ ok: false }` — so a caller could not tell a real report from a dead
 * channel, and a wrapper awaiting it would report success against an
 * unreachable monitor. It now propagates the real result. Returning a
 * value instead of `void` is backward compatible: existing callers that
 * ignore it are unaffected.
 */
export async function reportViolation(input: ReportViolationInput): Promise<{ ok: boolean }> {
  const stamp = nextOccurrenceStamp();
  const url = baseUrl();
  const report: ViolationReport = { ...input, ...stamp };
  for (const listener of violationListeners) {
    try { listener(report); } catch { /* ผู้ฟังพังต้องไม่ทำให้การรายงานพัง */ }
  }
  if (!url) return { ok: false };
  return hostPostJson(`${url}/violations`, report, timeoutFor(url), authorizationHeader());
}
