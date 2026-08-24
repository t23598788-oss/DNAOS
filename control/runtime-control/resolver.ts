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
 * Input: `ServiceId`, `Action`.
 * Output: `runOperation(serviceId, action): Promise<OperationEvidence>`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let `start`/`restart` report SUCCESS without both
 * a real post-action PID from launchd AND a real healthy HTTP response —
 * either one missing is a FAILED result with a stated reason. Never let a
 * duplicate listening PID on the target port pass as SUCCESS.
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
import type { Action, HealthCheckResult, OperationEvidence, ServiceId } from "./types";

const SETTLE_POLL_INTERVAL_MS = 500;
const SETTLE_MAX_WAIT_MS = 10_000;

async function waitForLaunchdSettle(label: string, wantRunning: boolean): Promise<void> {
  const deadline = Date.now() + SETTLE_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const state = getLaunchdState(label);
    const running = state.pid !== null;
    if (running === wantRunning) return;
    await sleep(SETTLE_POLL_INTERVAL_MS);
  }
}

export async function runOperation(serviceId: ServiceId, action: Action): Promise<OperationEvidence> {
  const def = SERVICES[serviceId];
  const operation_id = newOperationId();
  const timestamp_started = nowIso();

  const stateBefore = getLaunchdState(def.launchd_label);
  const healthBefore: HealthCheckResult = await httpHealthCheck(def.port, def.health_path);

  let mutationError: string | null = null;

  if (action === "start" || action === "restart") {
    if (!stateBefore.loaded) {
      const r = launchctlBootstrap(def.plist_path);
      if (!r.ok) mutationError = r.error;
    } else {
      const r = launchctlKickstart(def.launchd_label, true);
      if (!r.ok) mutationError = r.error;
    }
    await waitForLaunchdSettle(def.launchd_label, true);
  } else if (action === "stop") {
    if (stateBefore.loaded) {
      const r = launchctlBootout(def.launchd_label);
      if (!r.ok) mutationError = r.error;
      await waitForLaunchdSettle(def.launchd_label, false);
    }
    // Already unloaded: nothing to do, desired end-state already true.
  }
  // "health" and "status" issue no mutation at all.

  const stateAfter = getLaunchdState(def.launchd_label);
  const listeningPids = getListeningPids(def.port);
  const healthAfter: HealthCheckResult = await httpHealthCheck(def.port, def.health_path);
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
      failure_reason = `process is running (pid ${stateAfter.pid}) but health check failed: ${healthAfter.error ?? `http_status=${healthAfter.http_status}`}`;
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
    timestamp_started,
    timestamp_completed: nowIso(),
    result,
    failure_reason,
  };

  appendEvidence(evidence);
  return evidence;
}
