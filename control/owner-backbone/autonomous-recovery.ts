/**
 * หน้าที่: the AUTONOMOUS runtime-recovery loop. A real machine fact goes
 * in; a resolved, executed, verified recovery comes out; every work item
 * that was waiting on that service is woken. No Owner prompt, no Agent
 * judgement, anywhere in the path.
 *
 *   real health probe (../runtime-control/)
 *     -> SystemEvent SERVICE_UNHEALTHY (./events.ts)
 *     -> deterministic policy: is this service DECLARED under the launchd
 *        authority?  (../runtime-control/#SERVICES)
 *     -> RESTART_EXISTING_SERVICE via ../work-session-state/#recoverRuntime
 *        (the EXISTING bounded recovery — not a restart written here)
 *     -> real process evidence (../machine-observation/)
 *     -> RE-PROBE THE ORIGINAL CONDITION (../runtime-control/, again)
 *     -> SERVICE_HEALTHY / REMEDIATION_FAILED
 *     -> DependencyEvent into ../work-continuation/ for every waiting
 *        work_id blocked on this service
 *
 * NOTHING HERE IS A NEW MECHANISM. There is no launchctl call, no kill, no
 * spawn, no supervision of processes, no second waiting store and no second
 * event path in this file. It is the sequencing that did not exist: every
 * piece above was already built and already proven, and nothing connected
 * "the machine says this is down" to "the system does the authorized thing
 * about it".
 *
 * WHY THE DECISION CANNOT BE AN AI'S: the policy is a lookup, not a
 * judgement — a service is either declared under the launchd authority or
 * it is not. When it is not, this file reports the missing capability by
 * name and stops. It never invents an action, and it never asks anyone to
 * choose one.
 *
 * Input: a service_id already declared in `../runtime-control/#SERVICES`.
 * Output: `runRecoveryCycle`, `startRecoverySupervisor`, `RecoveryCycle`.
 * Dependency ที่อนุญาต: ./events.ts, ./types.ts, ./gateway.ts,
 * ../runtime-control/contract.ts, ../work-session-state/contract.ts,
 * ../work-continuation/contract.ts, ../machine-observation/contract.ts,
 * ../agent-gateway/contract.ts.
 * สิ่งที่ห้ามแตะ: never decide the service is healthy from what the restart
 * returned — only the re-probe of the ORIGINAL condition decides that.
 * Never widen the action set without the Owner declaring the new action.
 * Never wake waiting work from here directly: the DependencyEvent goes to
 * `../work-continuation/`, and its evaluator alone decides who resumes.
 */

import { randomUUID } from "node:crypto";
import { runOperation, SERVICES } from "../runtime-control/contract";
import type { OperationEvidence, ServiceId } from "../runtime-control/types";
import { recoverRuntime } from "../work-session-state/contract";
import { currentWaiting } from "../work-continuation/contract";
import { listProcesses } from "../machine-observation/contract";
import { saveEvidence } from "../agent-gateway/contract";
import { emitSystemEvent } from "./events";
import {
  conditionIdFor, conditionState, openCondition, recordAttempt, recordCanonicalAction,
  closeCondition, blockCondition, digestOfTrigger, MAX_CONDITION_ATTEMPTS,
} from "./action-ledger";
import { resumeWorkOnDependency } from "./gateway";
import type { SystemEvent, SystemEventType } from "./types";

const SOURCE_MARKER = "control/owner-backbone/autonomous-recovery.ts";

/**
 * The provider mail this system actually receives operational events from,
 * proven live on 2026-08-26. Narrow on purpose: a broad query would pull the
 * whole inbox through a classifier that would honestly answer UNKNOWN to
 * most of it, which is noise, not observability.
 */
const DEFAULT_EMAIL_QUERIES: readonly string[] = [
  "from:notify.railway.app newer_than:2d",
  "from:supabase.com newer_than:7d",
];

/**
 * The ONLY recovery action this loop is authorized to choose, and the one
 * condition under which it may. Written as data so the authority is
 * readable rather than buried in a branch.
 */
/**
 * ตัวตนของผู้ขอสำหรับการกู้คืนอัตโนมัติ — `kind: "service"` ตามคำศัพท์เดิมของ
 * contracts/identity#EnvelopeIdentity ห้ามเปลี่ยนเป็น "human" หรือใช้ id ของ Owner
 * เพราะจะทำให้การรีสตาร์ทของเครื่องกับคำสั่งของคนแยกกันไม่ออกในหลักฐาน
 */
const RECOVERY_REQUESTER_IDENTITY = { identity_id: "identity-recovery-supervisor", kind: "service" } as const;

const AUTHORIZED_ACTIONS = [
  {
    action: "RESTART_EXISTING_SERVICE",
    /** Authorized only for a service the launchd authority already declares. */
    applies: (serviceId: string): boolean => Object.prototype.hasOwnProperty.call(SERVICES, serviceId),
    missing_capability: "control/runtime-control#SERVICES declaration + a LaunchAgent plist for this service",
  },
] as const;

export type RecoveryStage =
  | "INPUT" | "RESOLVE" | "DECIDE" | "DISPATCH" | "EXECUTE"
  | "OBSERVE" | "VERIFY" | "EMIT" | "RESUME_DEPENDENTS" | "FINAL";

/** One line of the live trace. Ids and facts only — never an agent's prose. */
export interface TraceLine {
  readonly at: string;
  readonly event_id: string | null;
  readonly work_id: string;
  readonly stage: RecoveryStage;
  readonly input: string;
  readonly decision: string;
  readonly next_action: string;
  readonly evidence_ref: string;
}

export interface RecoveryCycle {
  readonly work_id: string;
  /** (service, action, target state) — the thing being remediated, independent of who is waiting for it. */
  readonly condition_id: string;
  readonly action_id: string | null;
  readonly attempt: number;
  readonly retry_budget_remaining: number;
  readonly skipped_reason: string | null;
  readonly service_id: string;
  readonly fault_detected: boolean;
  readonly initial_condition: string;
  readonly action: string | null;
  readonly missing_capability: string | null;
  readonly pid_before: number | null;
  readonly pid_after: number | null;
  readonly execution_result: string;
  readonly observed_pids: readonly number[];
  readonly final_condition: string;
  readonly fault_cleared: boolean;
  readonly resumed_work_ids: readonly string[];
  readonly waiting_before: readonly string[];
  readonly events: readonly SystemEvent[];
  readonly trace: readonly TraceLine[];
  readonly duration_ms: number;
}

/** The dependency key a service's health satisfies. One spelling, used by both the parker and the waker. */
export function serviceHealthKey(serviceId: string): { namespace: string; value: string } {
  return { namespace: "runtime_state", value: `service:${serviceId}:healthy` };
}

function conditionOf(evidence: OperationEvidence): string {
  const health = evidence.health_after;
  return health.healthy === true
    ? `SERVICE_HEALTHY (HTTP ${String(health.http_status)})`
    : `SERVICE_DOWN (${health.error ?? `HTTP ${String(health.http_status)}`})`;
}

/**
 * One full cycle for one service. Safe to call when nothing is wrong: it
 * probes first and returns without emitting anything if the service is
 * healthy, so a supervisor tick over a healthy machine is silent.
 */
export async function runRecoveryCycle(serviceId: string): Promise<RecoveryCycle> {
  const startedAt = Date.now();
  const trace: TraceLine[] = [];
  const events: SystemEvent[] = [];
  const workId = `work-recovery-${serviceId}-${randomUUID().slice(0, 8)}`;
  const conditionId = conditionIdFor(serviceId, "RESTART_EXISTING_SERVICE", "SERVICE_HEALTHY");
  const priorState = conditionState(conditionId);

  const emit = async (
    event_type: SystemEventType,
    state: string,
    next_action: string,
    evidence_refs: readonly string[],
    stage: RecoveryStage,
    input: string,
    decision: string,
  ): Promise<SystemEvent> => {
    const result = await emitSystemEvent({
      command_id: null, work_id: workId, incident_id: null, event_type, state,
      source: SOURCE_MARKER, resource_ids: [serviceId], capability_ids: ["runtime-control"],
      evidence_refs, next_action,
    });
    events.push(result.event);
    trace.push({
      at: result.event.observed_at, event_id: result.event.event_id, work_id: workId, stage,
      input, decision, next_action, evidence_ref: evidence_refs[0] ?? "none",
    });
    return result.event;
  };

  // ===== [1] INPUT — a REAL probe of the real machine ======================
  const key = serviceHealthKey(serviceId);
  const before: OperationEvidence = await runOperation(serviceId as ServiceId, "health");
  const initialCondition = conditionOf(before);
  const pidBefore = before.pid_before;

  if (before.health_after.healthy === true) {
    // §7 REPLAY IDEMPOTENCY: an open condition whose target state is now
    // observed to hold is CLOSED here, which also releases its retry budget.
    // Nothing is executed on this path — closing is a record, not an action.
    if (priorState.open || priorState.blocked) {
      closeCondition({ condition_id: conditionId, service_id: serviceId, action: "RESTART_EXISTING_SERVICE", target_state: "SERVICE_HEALTHY", verified_state: "SERVICE_HEALTHY", evidence_ref: `runtime-control:${before.operation_id}`, detail: "the target state is observed to hold; the condition is resolved and its retry budget is released" });
    }

    // SATISFIED-DEPENDENCY SWEEP (added 2026-08-26 after a live miss). The
    // recovery cycle wakes the waiters it saw at the moment it detected the
    // fault — so work that parks a second LATER, while the recovery is
    // already running, would wait forever: the next tick sees a healthy
    // service and, without this, would do nothing about it.
    //
    // So every tick also asks the other question: is anything parked on a
    // condition that ALREADY holds? A dependency that is satisfied and a
    // waiter that is still waiting is a liveness bug, whatever the timing
    // was. This never executes a recovery — the state already holds.
    const satisfiedWaiters = currentWaiting()
      .filter((row) => row.status === "WAITING" && row.blocked_on.some((k) => k.includes(`service:${serviceId}:healthy`)))
      .map((row) => row.work_id);

    if (satisfiedWaiters.length > 0) {
      await emit("SERVICE_HEALTHY", "DEPENDENCY_SATISFIED", `${satisfiedWaiters.length} work item(s) are parked on a condition that already holds`, [`runtime-control:${before.operation_id}`, `condition:${conditionId}`], "EMIT", `health probe ${serviceId}`, "SERVICE_HEALTHY — wake the waiters");

      const swept: string[] = [];
      for (const waitingWorkId of satisfiedWaiters) {
        const outcome = await resumeWorkOnDependency({
          work_id: waitingWorkId, namespace: key.namespace, value: key.value,
          source: SOURCE_MARKER, evidence_ref: `runtime-control:${before.operation_id}`,
          condition_id: conditionId,
        });
        trace.push({ at: new Date().toISOString(), event_id: null, work_id: waitingWorkId, stage: "RESUME_DEPENDENTS", input: `${key.namespace}:${key.value} (already satisfied)`, decision: outcome.verdict, next_action: outcome.resumed ? "re-dispatched on the SAME work_id" : "stays blocked", evidence_ref: `runtime-control:${before.operation_id}` });
        if (outcome.resumed) swept.push(waitingWorkId);
      }

      return {
        work_id: workId, condition_id: conditionId, action_id: null, attempt: priorState.attempts,
        retry_budget_remaining: priorState.retry_budget_remaining, skipped_reason: null,
        service_id: serviceId, fault_detected: false, initial_condition: initialCondition,
        action: null, missing_capability: null, pid_before: pidBefore, pid_after: before.pid_after,
        execution_result: "NOT_REQUIRED", observed_pids: [], final_condition: initialCondition,
        fault_cleared: true, resumed_work_ids: swept, waiting_before: satisfiedWaiters,
        events, trace, duration_ms: Date.now() - startedAt,
      };
    }

    trace.push({ at: new Date().toISOString(), event_id: null, work_id: workId, stage: "INPUT", input: `health probe ${serviceId}`, decision: "NO_FAULT", next_action: "none", evidence_ref: `runtime-control:${before.operation_id}` });
    return {
      condition_id: conditionId, action_id: null, attempt: priorState.attempts, retry_budget_remaining: priorState.retry_budget_remaining, skipped_reason: null,
      work_id: workId, service_id: serviceId, fault_detected: false, initial_condition: initialCondition,
      action: null, missing_capability: null, pid_before: pidBefore, pid_after: before.pid_after,
      execution_result: "NOT_REQUIRED", observed_pids: [], final_condition: initialCondition, fault_cleared: true,
      resumed_work_ids: [], waiting_before: [], events, trace, duration_ms: Date.now() - startedAt,
    };
  }

  // §7 RETRY SAFETY, read from disk so it survives a process or machine
  // restart. A condition that has exhausted its budget is NOT retried, and
  // a blocked condition is not silently re-opened by the next tick.
  if (priorState.blocked) {
    trace.push({ at: new Date().toISOString(), event_id: null, work_id: workId, stage: "DECIDE", input: initialCondition, decision: `CONDITION_BLOCKED — ${priorState.blocker ?? "no further authorized action"}`, next_action: "owner decides; the loop does not retry this", evidence_ref: `condition:${conditionId}` });
    return {
      work_id: workId, condition_id: conditionId, action_id: null, attempt: priorState.attempts,
      retry_budget_remaining: 0, skipped_reason: `CONDITION_BLOCKED: ${priorState.blocker ?? "retry budget exhausted"}`,
      service_id: serviceId, fault_detected: true, initial_condition: initialCondition, action: null,
      missing_capability: null, pid_before: pidBefore, pid_after: null, execution_result: "NOT_ATTEMPTED",
      observed_pids: [], final_condition: initialCondition, fault_cleared: false, resumed_work_ids: [],
      waiting_before: [], events, trace, duration_ms: Date.now() - startedAt,
    };
  }

  if (!priorState.open) {
    openCondition({ condition_id: conditionId, service_id: serviceId, action: "RESTART_EXISTING_SERVICE", target_state: "SERVICE_HEALTHY", evidence_ref: `runtime-control:${before.operation_id}`, detail: initialCondition });
  }

  await emit("SERVICE_UNHEALTHY", "SERVICE_DOWN", "resolve the recovery authority for this service", [`runtime-control:${before.operation_id}`, `condition:${conditionId}`], "INPUT", `health probe ${serviceId}`, initialCondition);

  // ===== [2] RESOLVE — who has authority over this service? ================
  const declared = Object.prototype.hasOwnProperty.call(SERVICES, serviceId);
  const waitingBefore = currentWaiting()
    .filter((row) => row.status === "WAITING" && row.blocked_on.some((k) => k.includes(`service:${serviceId}:healthy`)))
    .map((row) => row.work_id);
  trace.push({ at: new Date().toISOString(), event_id: null, work_id: workId, stage: "RESOLVE", input: serviceId, decision: declared ? `DECLARED under control/runtime-control#SERVICES (launchd ${SERVICES[serviceId as ServiceId].launchd_label})` : "UNDECLARED", next_action: declared ? "choose an authorized action" : "report the missing capability", evidence_ref: `registry:runtime-control#SERVICES` });

  // ===== [3] DECIDE — a lookup, never a judgement =========================
  const authorized = AUTHORIZED_ACTIONS.find((candidate) => candidate.applies(serviceId));
  if (authorized === undefined) {
    const missing = AUTHORIZED_ACTIONS[0].missing_capability;
    await emit("OWNER_DECISION_REQUIRED", "NO_AUTHORIZED_ACTION", `missing capability: ${missing}`, [`policy:${SOURCE_MARKER}`], "DECIDE", initialCondition, "NO_AUTHORIZED_ACTION");
    blockCondition({ condition_id: conditionId, service_id: serviceId, action: "NONE", target_state: "SERVICE_HEALTHY", detail: `NO_AUTHORIZED_ACTION: ${missing}`, evidence_ref: `policy:${SOURCE_MARKER}` });
    return {
      work_id: workId, condition_id: conditionId, action_id: null, attempt: priorState.attempts,
      retry_budget_remaining: priorState.retry_budget_remaining, skipped_reason: null,
      service_id: serviceId, fault_detected: true, initial_condition: initialCondition,
      action: null, missing_capability: missing, pid_before: pidBefore, pid_after: null,
      execution_result: "NOT_ATTEMPTED", observed_pids: [], final_condition: initialCondition, fault_cleared: false,
      resumed_work_ids: [], waiting_before: waitingBefore, events, trace, duration_ms: Date.now() - startedAt,
    };
  }

  await emit("REMEDIATION_STARTED", "REMEDIATION_RESOLVED", `action=${authorized.action}`, [`policy:${SOURCE_MARKER}`], "DECIDE", initialCondition, `action=${authorized.action} (chosen by policy lookup, no Owner and no Agent)`);

  // ===== [4]+[5] DISPATCH + EXECUTE — through the canonical authority =====
  if (priorState.attempts >= MAX_CONDITION_ATTEMPTS) {
    blockCondition({ condition_id: conditionId, service_id: serviceId, action: authorized.action, target_state: "SERVICE_HEALTHY", detail: `retry budget exhausted (${priorState.attempts}/${MAX_CONDITION_ATTEMPTS}) — the loop stops retrying this condition`, evidence_ref: `runtime-control:${before.operation_id}` });
    await emit("REMEDIATION_FAILED", "RETRY_BUDGET_EXHAUSTED", `${priorState.attempts}/${MAX_CONDITION_ATTEMPTS} attempts made; no further automatic action for this condition`, [`condition:${conditionId}`], "DECIDE", initialCondition, "STOP_RETRYING");
    await emit("OWNER_DECISION_REQUIRED", "AUTO_RECOVERY_EXHAUSTED", "an Owner decides what happens to this service next", [`condition:${conditionId}`], "FINAL", initialCondition, "OWNER_DECISION_REQUIRED");
    return {
      work_id: workId, condition_id: conditionId, action_id: null, attempt: priorState.attempts,
      retry_budget_remaining: 0, skipped_reason: "RETRY_BUDGET_EXHAUSTED",
      service_id: serviceId, fault_detected: true, initial_condition: initialCondition, action: authorized.action,
      missing_capability: null, pid_before: pidBefore, pid_after: null, execution_result: "NOT_ATTEMPTED",
      observed_pids: [], final_condition: initialCondition, fault_cleared: false, resumed_work_ids: [],
      waiting_before: waitingBefore, events, trace, duration_ms: Date.now() - startedAt,
    };
  }

  const actionId = `action-${randomUUID()}`;
  recordAttempt({ condition_id: conditionId, service_id: serviceId, action: authorized.action, target_state: "SERVICE_HEALTHY", input_digest: digestOfTrigger({ condition: conditionId, observed: initialCondition, operation: before.operation_id }), detail: `attempt ${priorState.attempts + 1}/${MAX_CONDITION_ATTEMPTS}` });
  trace.push({ at: new Date().toISOString(), event_id: null, work_id: workId, stage: "DISPATCH", input: `${authorized.action} ${serviceId}`, decision: "control/work-session-state#recoverRuntime -> control/runtime-control#runOperation -> launchd", next_action: "execute", evidence_ref: actionId });

  // ผู้ขอของสายนี้คือ recovery-supervisor เอง ในฐานะ SERVICE ไม่ใช่ Owner และ
  // ไม่ใช่มนุษย์: การกู้คืนอัตโนมัติไม่ได้เกิดจากใครสั่ง จึงต้องแยกออกจากคำสั่ง
  // Owner ได้อย่างเด็ดขาดเมื่ออ่านหลักฐานย้อนหลัง ตัวตนนี้ตามแบบแผน
  // `identity-<capability>` ที่มีอยู่แล้ว (post-commit-verification,
  // deployable-artifact-readiness) การบันทึกตัวตนนี้ไม่ได้ให้อำนาจกำหนดสถานะ
  // ที่พึงเป็นแก่ผู้กู้คืน และไม่เปลี่ยนนโยบายการกู้คืนใด ๆ
  const recovery = await recoverRuntime(serviceId, {
    requested_by: RECOVERY_REQUESTER_IDENTITY,
    lineage: { work_id: workId, condition_id: conditionId, action_id: actionId },
  });
  await emit("SERVICE_RESTARTED", recovery.outcome, "observe the real machine — the restart's own report decides nothing", [recovery.evidence_ref ? `runtime-control:${recovery.evidence_ref}` : actionId], "EXECUTE", `${authorized.action} ${serviceId}`, `${recovery.outcome}: ${recovery.detail}`);

  // ===== [6] OBSERVE — the real machine, not the restart's claim ==========
  // launchd's OWN view of which pid now holds the job, read back through the
  // canonical read-only operation — then the kernel's process table for that
  // pid AND its children. The child is what actually binds the port (a Next
  // dev server's listener is a child of the job launchd started), so an
  // observation that stopped at the job pid would miss the process that
  // matters.
  const post: OperationEvidence = await runOperation(serviceId as ServiceId, "status");
  const jobPid = post.pid_after;
  const observedPids = jobPid === null
    ? []
    : listProcesses().filter((row) => row.pid === jobPid || row.ppid === jobPid).map((row) => row.pid);
  trace.push({ at: new Date().toISOString(), event_id: null, work_id: workId, stage: "OBSERVE", input: `launchd pid=${String(jobPid)} -> machine-observation#listProcesses`, decision: `${observedPids.length} real process(es) in the job's lineage: ${observedPids.join(", ") || "none"}`, next_action: "re-check the ORIGINAL condition", evidence_ref: `machine-observation:pids=${observedPids.join(",") || "none"}` });

  // ===== [7] VERIFY — re-ask the ORIGINAL question =======================
  const after: OperationEvidence = await runOperation(serviceId as ServiceId, "health");
  const finalCondition = conditionOf(after);
  const cleared = after.health_after.healthy === true;
  await emit(cleared ? "VERIFICATION_PASSED" : "VERIFICATION_FAILED", cleared ? "ORIGINAL_FAULT_CLEARED" : "ORIGINAL_FAULT_PERSISTS", cleared ? "wake anything waiting on this service" : "escalate", [`runtime-control:${after.operation_id}`], "VERIFY", `re-probe ${serviceId} — the SAME condition that opened this`, `${initialCondition.split(" ")[0]} -> ${finalCondition}`);

  // ===== [8] EMIT the terminal state =====================================
  if (!cleared) {
    // The bounded recovery already retried. Nothing further is authorized
    // here, so this terminates at the Owner rather than inventing an action.
    await emit("REMEDIATION_FAILED", "REMEDIATION_FAILED", `${authorized.action} ran and the original condition still holds — no further authorized action exists for this service`, [`runtime-control:${after.operation_id}`], "EMIT", finalCondition, "OWNER_DECISION_REQUIRED");
    await emit("OWNER_DECISION_REQUIRED", "AUTO_RECOVERY_EXHAUSTED", "an Owner decides what happens to this service next", [`runtime-control:${after.operation_id}`], "FINAL", finalCondition, "OWNER_DECISION_REQUIRED");
    return {
      work_id: workId, condition_id: conditionId, action_id: actionId, attempt: priorState.attempts + 1,
      retry_budget_remaining: Math.max(0, MAX_CONDITION_ATTEMPTS - (priorState.attempts + 1)), skipped_reason: null,
      service_id: serviceId, fault_detected: true, initial_condition: initialCondition,
      action: authorized.action, missing_capability: null, pid_before: pidBefore, pid_after: after.pid_after,
      execution_result: recovery.outcome, observed_pids: observedPids, final_condition: finalCondition,
      fault_cleared: false, resumed_work_ids: [], waiting_before: waitingBefore, events, trace,
      duration_ms: Date.now() - startedAt,
    };
  }

  // §6 THE ONE CANONICAL ACTION. Recorded before any waiter is woken, so
  // every waiter of this condition shares THIS evidence instead of causing
  // its own physical restart.
  recordCanonicalAction({
    condition_id: conditionId, action_id: actionId, service_id: serviceId,
    action: authorized.action, target_state: "SERVICE_HEALTHY", verified_state: "SERVICE_HEALTHY",
    evidence_ref: `runtime-control:${after.operation_id}`,
    detail: `${authorized.action} verified by a re-probe of the original condition; pid ${String(pidBefore)} -> ${String(after.pid_after)}`,
  });
  closeCondition({ condition_id: conditionId, service_id: serviceId, action: authorized.action, target_state: "SERVICE_HEALTHY", verified_state: "SERVICE_HEALTHY", evidence_ref: `runtime-control:${after.operation_id}`, detail: "original condition cleared" });

  await emit("SERVICE_HEALTHY", "SERVICE_HEALTHY", "wake anything waiting on this service", [`runtime-control:${after.operation_id}`, `condition:${conditionId}`, `action:${actionId}`], "EMIT", finalCondition, "resume dependents");

  // ===== [9] RESUME DEPENDENTS ===========================================
  // A DependencyEvent per waiting work item. work-continuation's evaluator —
  // not this file — decides which of them may actually resume.
  const resumed: string[] = [];
  for (const waitingWorkId of waitingBefore) {
    const outcome = await resumeWorkOnDependency({
      work_id: waitingWorkId,
      namespace: key.namespace,
      value: key.value,
      source: SOURCE_MARKER,
      evidence_ref: `runtime-control:${after.operation_id}`,
      // The waiter is told WHICH condition it is waking for, so its own
      // dispatch can share the canonical action rather than repeat it.
      condition_id: conditionId,
    });
    trace.push({ at: new Date().toISOString(), event_id: null, work_id: waitingWorkId, stage: "RESUME_DEPENDENTS", input: `${key.namespace}:${key.value}`, decision: outcome.verdict, next_action: outcome.resumed ? "re-dispatched on the SAME work_id" : "stays blocked", evidence_ref: `runtime-control:${after.operation_id}` });
    if (outcome.resumed) resumed.push(waitingWorkId);
  }

  await emit("WORK_COMPLETED", "RESOLVED", `recovered ${serviceId}; resumed ${resumed.length}/${waitingBefore.length} waiting work item(s)`, [`runtime-control:${after.operation_id}`], "FINAL", finalCondition, "none");

  const cycle: RecoveryCycle = {
    work_id: workId, condition_id: conditionId, action_id: actionId, attempt: priorState.attempts + 1,
    retry_budget_remaining: Math.max(0, MAX_CONDITION_ATTEMPTS - (priorState.attempts + 1)), skipped_reason: null,
    service_id: serviceId, fault_detected: true, initial_condition: initialCondition,
    action: authorized.action, missing_capability: null, pid_before: pidBefore, pid_after: after.pid_after,
    execution_result: recovery.outcome, observed_pids: observedPids, final_condition: finalCondition,
    fault_cleared: true, resumed_work_ids: resumed, waiting_before: waitingBefore, events, trace,
    duration_ms: Date.now() - startedAt,
  };

  saveEvidence({
    evidence_id: `recovery-${workId}`, task_id: workId, kind: "execution_output",
    source: SOURCE_MARKER, recorded_at: new Date().toISOString(), payload: cycle,
  });
  return cycle;
}

export interface SupervisorHandle {
  readonly stop: () => void;
  readonly cycles: readonly RecoveryCycle[];
  /** Ticks completed since start. Read by the liveness surface — a supervisor that never ticks is not alive. */
  readonly ticks: () => number;
  readonly lastTickAt: () => string | null;
}

/**
 * The thing that makes this autonomous: a periodic tick over the declared
 * services. It carries no state beyond the cycles it has run, so stopping
 * and starting it loses nothing — every fact it acts on is re-read from the
 * machine on the next tick.
 */
export function startRecoverySupervisor(options: {
  readonly services?: readonly string[];
  readonly intervalMs?: number;
  readonly maxCycles?: number;
  readonly onCycle?: (cycle: RecoveryCycle) => void;
  /** Set false only in a proof that is isolating service recovery. Production leaves it on. */
  readonly pollResources?: boolean;
  /** How often the provider inbox is drained. 0 disables it. Default 10 minutes. */
  readonly emailIntakeMs?: number;
  readonly emailQueries?: readonly string[];
}): SupervisorHandle {
  const services = options.services ?? (Object.keys(SERVICES) as string[]);
  const intervalMs = options.intervalMs ?? 30_000;
  const cycles: RecoveryCycle[] = [];
  let stopped = false;
  let running = false;
  let tickCount = 0;
  let lastTickAt: string | null = null;
  // Starts "long ago" so the first tick drains the inbox once, then backs off.
  let lastEmailIntakeMs = 0;

  const tick = async (): Promise<void> => {
    // Never overlap: a Next.js cold start outlasts a short interval, and a
    // second restart mid-readiness is how a healthy service gets recorded
    // as failed.
    if (running || stopped) return;
    running = true;
    try {
      for (const serviceId of services) {
        if (stopped) break;
        const cycle = await runRecoveryCycle(serviceId);
        // Surface any cycle that DID something — a recovery, or a sweep that
        // woke work parked on a condition that already held.
        if (cycle.fault_detected || cycle.resumed_work_ids.length > 0) {
          cycles.push(cycle);
          options.onCycle?.(cycle);
        }
        if (options.maxCycles !== undefined && cycles.length >= options.maxCycles) { stopped = true; break; }
      }

      // §9 — the same tick also asks whether any parked WAITING_FOR_RESOURCE
      // work can now move. Deterministic evidence only; it launches nothing.
      if (!stopped && options.pollResources !== false) {
        try {
          const { pollResourceAvailability } = await import("./resource-availability");
          await pollResourceAvailability();
        } catch { /* a resource poll failure must never stop service recovery */ }
      }

      // §1/§7 — the same tick also drains the provider inbox, on its OWN
      // much slower schedule. Bounded deliberately: this crosses the network
      // to a real provider, and an inbox is not a thing to poll every 30s.
      if (!stopped && options.emailIntakeMs !== 0) {
        const dueAt = lastEmailIntakeMs + (options.emailIntakeMs ?? 600_000);
        if (Date.now() >= dueAt) {
          lastEmailIntakeMs = Date.now();
          try {
            const { intakeProviderEmails } = await import("./event-intake");
            for (const query of options.emailQueries ?? DEFAULT_EMAIL_QUERIES) {
              await intakeProviderEmails(query, 5);
            }
          } catch { /* a provider being unreachable must never stop service recovery */ }
        }
      }

      tickCount += 1;
      lastTickAt = new Date().toISOString();
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => { void tick(); }, intervalMs);
  // Do not hold the process open on this timer alone.
  if (typeof timer.unref === "function") timer.unref();
  void tick();

  return { stop: () => { stopped = true; clearInterval(timer); }, cycles, ticks: () => tickCount, lastTickAt: () => lastTickAt };
}
