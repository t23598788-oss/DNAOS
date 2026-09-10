/**
 * หน้าที่: `runOperation()` — the one real orchestration function of this
 * capability. Issues at most one `launchctl` mutation per call (never a
 * loop of mutations), then polls read-only facts (`launchctl list`,
 * `lsof`, one HTTP probe) with a bounded wait until they settle or a
 * timeout is reached — never an unbounded retry. Builds `OperationEvidence`
 * only from what `./host-runtime.ts` actually observed, per the Owner's
 * explicit rule: launchd's own state and the process's real runtime health
 * are two separate facts, and neither may be reported as the other. A
 * service is never called healthy merely because launchd reports it
 * loaded/running.
 *
 * Input: `ServiceId`, `Action`, และ `RuntimeOperationRequest` ที่เป็น optional.
 * Output: `runOperation(serviceId, action, request?): Promise<OperationEvidence>`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts,
 * ../agent-physical-scope/contract.ts (coding-agent runtime deny only).
 * สิ่งที่ห้ามแตะ: never let `start`/`restart` report SUCCESS without both
 * a real post-action PID from launchd AND a real healthy HTTP response —
 * either one missing is a FAILED result with a stated reason. Never let a
 * duplicate listening PID on the target port pass as SUCCESS. ห้ามอนุมานตัวตน
 * ผู้ขอจาก action/stack/ชื่อไฟล์/ชื่อบริการ/เวลา และห้ามใส่ค่าแทนผู้ขอที่ไม่มี.
 */

import {
  SERVICES,
  getLaunchdState,
  launchctlBootstrap,
  launchctlBootout,
  launchctlKickstart,
  getListeningPids,
  httpHealthCheck,
  nowIso,
  newOperationId,
  appendEvidence,
  sleep,
} from "./host-runtime";
import { buildRequesterProvenance } from "./requester";
import type { RuntimeOperationRequest } from "./requester";
import type { Action, HealthCheckResult, OperationEvidence, ServiceId } from "./types";
import { denyProtectedRuntimeIfAgent } from "../agent-physical-scope/contract";

const SETTLE_POLL_INTERVAL_MS = 500;
const SETTLE_MAX_WAIT_MS = 10_000;
const READINESS_POLL_INTERVAL_MS = 500;

/**
 * WHY THIS EXISTS (Owner, 2026-08-26). `waitForLaunchdSettle` waits for launchd
 * to report a PID — which happens almost instantly, because launchd reports the
 * PID the moment it forks, long before the process has compiled its modules and
 * bound its port. The single health probe that followed therefore fired at
 * roughly t+0.2s and, for any service with a real cold start, always found
 * nothing listening. The operation was then recorded FAILED even though the
 * restart had worked: `machine-observer` was answering 200 one second after
 * that verdict was written, every time.
 *
 * That is an evidence record contradicting the machine it describes, which is
 * worse than a slow restart: every downstream reader — state, reports, any
 * future automation — inherits the lie.
 *
 * The fix keeps the rule this file was built on: a service is still never
 * called healthy on launchd's say-so, and the wait is still bounded and still
 * never an unbounded retry. It only stops sampling the health fact once at the
 * wrong instant, and polls it to the service's own declared readiness bound.
 * A service that genuinely never answers still fails — after its real deadline,
 * with the waited duration on the record.
 */
async function waitForReadiness(
  port: number,
  path: string,
  deadlineMs: number,
): Promise<{ health: HealthCheckResult; waited_ms: number }> {
  const startedAt = Date.now();
  let health = await httpHealthCheck(port, path);
  while (!health.healthy && Date.now() - startedAt < deadlineMs) {
    await sleep(READINESS_POLL_INTERVAL_MS);
    health = await httpHealthCheck(port, path);
  }
  return { health, waited_ms: Date.now() - startedAt };
}

async function waitForLaunchdSettle(label: string, wantRunning: boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const state = getLaunchdState(label);
    const running = state.pid !== null;
    if (running === wantRunning) return;
    await sleep(SETTLE_POLL_INTERVAL_MS);
  }
}

/**
 * ผู้ขอต้องมาถึงที่นี่อย่างชัดแจ้งเท่านั้น
 *
 * ไฟล์นี้จะไม่อนุมานผู้ขอจาก action, stack trace, ชื่อไฟล์, ชื่อบริการ หรือเวลา
 * เด็ดขาด — การเดาผู้ขอเขียนลงหลักฐานแล้วแยกไม่ออกจากผู้ขอที่วัดได้จริง
 * `request` เป็น optional เพื่อไม่ทำให้ผู้เรียกเดิมพัง และการไม่ส่งมาแปลว่า
 * NOT_MEASURED ไม่ใช่ค่าเริ่มต้นที่เป็น OWNER หรือ SYSTEM
 */
export async function runOperation(serviceId: ServiceId, action: Action, request?: RuntimeOperationRequest): Promise<OperationEvidence> {
  const def = SERVICES[serviceId];
  const operation_id = newOperationId();
  const timestamp_started = nowIso();

  const stateBefore = getLaunchdState(def.launchd_label);
  const healthBefore: HealthCheckResult = await httpHealthCheck(def.port, def.health_path);

  let mutationError: string | null = null;
  const agentRuntime = denyProtectedRuntimeIfAgent({ service_id: serviceId, action, env: process.env });
  if (!agentRuntime.ok) mutationError = agentRuntime.detail;

  if (mutationError === null && (action === "start" || action === "restart")) {
    if (!stateBefore.loaded) {
      const r = launchctlBootstrap(def.plist_path);
      if (!r.ok) mutationError = r.error;
    } else {
      const r = launchctlKickstart(def.launchd_label, true);
      if (!r.ok) mutationError = r.error;
    }
    await waitForLaunchdSettle(def.launchd_label, true);
  } else if (mutationError === null && action === "stop") {
    if (stateBefore.loaded) {
      const r = launchctlBootout(def.launchd_label);
      if (!r.ok) mutationError = r.error;
      await waitForLaunchdSettle(def.launchd_label, false);
    }
    // Already unloaded: nothing to do, desired end-state already true.
  }
  // "health" and "status" issue no mutation at all.

  const stateAfter = getLaunchdState(def.launchd_label);

  // Readiness is polled ONLY for the actions that are supposed to leave a
  // service answering. `stop` must not wait for health — a stopped service
  // answering nothing is the desired outcome, not a timeout — and `health` /
  // `status` are single-sample reads by definition.
  let healthAfter: HealthCheckResult;
  let readiness_wait_ms = 0;
  const readiness_deadline_ms = mutationError === null && (action === "start" || action === "restart") ? def.readiness_timeout_ms : 0;
  if (readiness_deadline_ms > 0) {
    const ready = await waitForReadiness(def.port, def.health_path, readiness_deadline_ms);
    healthAfter = ready.health;
    readiness_wait_ms = ready.waited_ms;
  } else {
    healthAfter = await httpHealthCheck(def.port, def.health_path);
  }

  // Read the port AFTER readiness, not before: probing for listeners while the
  // process is still binding reports an empty set and would make a real
  // duplicate invisible.
  const listeningPids = getListeningPids(def.port);
  const duplicate_detected = listeningPids.length > 1;

  let result: "SUCCESS" | "FAILED" = "SUCCESS";
  let failure_reason: string | null = null;

  if (mutationError) {
    result = "FAILED";
    failure_reason = mutationError;
  } else if (action === "start" || action === "restart") {
    if (stateAfter.pid === null) {
      result = "FAILED";
      failure_reason = "no PID reported by launchd after start/restart";
    } else if (!healthAfter.healthy) {
      result = "FAILED";
      failure_reason = `process is running (pid ${stateAfter.pid}) but did not answer ${def.health_path} within its declared readiness bound of ${readiness_deadline_ms}ms (waited ${readiness_wait_ms}ms): ${healthAfter.error ?? `http_status=${healthAfter.http_status}`}`;
    }
  } else if (action === "stop") {
    if (stateAfter.pid !== null) {
      result = "FAILED";
      failure_reason = `process still running (pid ${stateAfter.pid}) after stop`;
    }
  }

  if (duplicate_detected && result === "SUCCESS") {
    result = "FAILED";
    failure_reason = `duplicate listening processes on port ${def.port}: ${listeningPids.join(", ")}`;
  }

  const evidence: OperationEvidence = {
    operation_id,
    service_id: serviceId,
    launchd_label: def.launchd_label,
    requested_action: action,
    port: def.port,
    pid_before: stateBefore.pid,
    pid_after: stateAfter.pid,
    launchd_loaded_before: stateBefore.loaded,
    launchd_loaded_after: stateAfter.loaded,
    health_before: healthBefore,
    health_after: healthAfter,
    duplicate_check: { listening_pids: listeningPids, duplicate_detected },
    readiness_wait_ms,
    readiness_deadline_ms,
    timestamp_started,
    timestamp_completed: nowIso(),
    result,
    failure_reason,
    // ผู้ขอมาจากบริบทที่ส่งเข้ามาเท่านั้น ส่วน executed_by ถูกกำหนดโดย
    // buildRequesterProvenance ไม่ใช่โดยผู้เรียก — ผู้เรียกทับผู้ลงมือไม่ได้
    ...buildRequesterProvenance(request),
  };

  appendEvidence(evidence);
  return evidence;
}
