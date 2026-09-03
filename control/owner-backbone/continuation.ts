/**
 * หน้าที่: §3's `WAITING_FOR_DEPENDENCY` branch, wired to the REAL
 * continuation engine — `../work-continuation/`. No second waiting store, no
 * second evaluator, no polling loop.
 *
 *   park:   backbone work -> `#appendWaiting` (the existing journal)
 *   arrive: a fact -> `DependencyEvent` -> `#evaluate` (the existing rules)
 *   resume: the SAME work_id, never a new one
 *
 * WHY THIS FILE EXISTS AT ALL: work-continuation speaks `WaitingWork` /
 * `DependencyEvent`; the backbone speaks `OwnerCommandEnvelope` /
 * `SystemEvent`. This is the translation between them and nothing else —
 * every rule about WHETHER work may resume stays in `../work-continuation/`.
 *
 * LEAF MODULE ON PURPOSE: it must not import `./gateway.ts`. The gateway
 * imports this; re-dispatch after a resume is the gateway's decision, made
 * with the verdict this file returns. Importing back would form a cycle and,
 * worse, would let the translator decide execution.
 *
 * Input: a work_id + what it is blocked on; later, an arriving fact.
 * Output: `parkWorkForDependency`, `deliverDependencyFact`, `waitingRowFor`,
 * `recordResumeOutcome`.
 * Dependency ที่อนุญาต: ../work-continuation/contract.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never mint a work_id here, never write a resume verdict
 * this file computed itself, and never treat a missing waiting row as
 * "nothing was waiting" — that is UNKNOWN_WORK and is reported as such.
 */

import {
  appendWaiting,
  currentWaiting,
  dependencyKey,
  evaluate,
  satisfiedKeysFrom,
} from "../work-continuation/contract";
import type { DependencyEvent, Evaluation, WaitingWork } from "../work-continuation/types";

const SOURCE_MARKER = "control/owner-backbone/continuation.ts";

export interface ParkResult {
  readonly work_id: string;
  readonly blocked_on: readonly string[];
  readonly parked: true;
  readonly detail: string;
}

/**
 * Park backbone work in the EXISTING waiting journal. `blockedOn` are raw
 * `namespace:value` pairs; `dependencyKey` normalises them exactly as every
 * other producer does, so the reverse index finds them.
 */
export function parkWorkForDependency(input: {
  readonly work_id: string;
  readonly namespace: string;
  readonly values: readonly string[];
  readonly next_action: string;
  readonly resolved_work_context_ref: string | null;
  readonly resolution_digest: string | null;
  readonly required_worker_class: string | null;
  /**
   * WHAT KIND of thing is missing. `RUNTIME_STATE` is a service/state wait;
   * `RESOURCE` is "no execution resource is available", which
   * `WaitingWork.status` spells `WAITING_FOR_RESOURCE`. Keeping them apart
   * is the whole reason those buckets are separate — a reader must be able
   * to see whether the system is waiting on the world or on capacity.
   */
  readonly kind?: "RUNTIME_STATE" | "RESOURCE";
  readonly path?: string;
}): ParkResult {
  const keys = input.values.map((v) => dependencyKey(input.namespace, v));
  // LOOP SAFETY. Work can be parked AGAIN — a claimed dependency that
  // reality disagrees with re-blocks the same work. Re-parking must CARRY
  // the retry counters forward: appending a fresh row with zeroed counters
  // would reset the bounded-retry rule and let one repeating trigger wake
  // the same work forever.
  const previous = waitingRowFor(input.work_id, input.path);
  const kind = input.kind ?? "RUNTIME_STATE";
  const row: WaitingWork = {
    work_id: input.work_id,
    current_phase: kind === "RESOURCE" ? "WAITING_FOR_RESOURCE" : "WAITING_FOR_DEPENDENCY",
    status: kind === "RESOURCE" ? "WAITING_FOR_RESOURCE" : "WAITING",
    blocked_on: keys,
    required_evidence: [],
    required_resources: kind === "RESOURCE" ? keys : [],
    required_capabilities: [],
    required_runtime_state: kind === "RESOURCE" ? [] : keys,
    required_external_state: [],
    resume_condition: "ALL_AVAILABLE",
    exact_state: null,
    next_action: input.next_action,
    resolved_work_context_ref: input.resolved_work_context_ref,
    last_verified_revision: input.resolution_digest,
    evidence_refs: [],
    resume_attempt_count: previous?.resume_attempt_count ?? 0,
    last_resume_reason: previous?.last_resume_reason ?? null,
    last_input_digest: previous?.last_input_digest ?? null,
    last_result_digest: previous?.last_result_digest ?? null,
    required_worker_class: input.required_worker_class,
    recorded_at: new Date().toISOString(),
  };
  appendWaiting(row, input.path);
  return { work_id: input.work_id, blocked_on: keys, parked: true, detail: `parked in work-continuation on ${keys.join(", ")}` };
}

export function waitingRowFor(workId: string, path?: string): WaitingWork | null {
  return currentWaiting(path).find((r) => r.work_id === workId) ?? null;
}

export interface DependencyArrival {
  readonly work_id: string;
  readonly known: boolean;
  readonly evaluation: Evaluation | null;
  readonly resume: boolean;
  readonly detail: string;
}

/**
 * A fact arrived. Hands it to work-continuation's own evaluator and reports
 * the verdict verbatim — this file never overrides STILL_BLOCKED,
 * STALE_RESOLUTION or OWNER_DECISION_REQUIRED into a resume.
 */
export function deliverDependencyFact(input: {
  readonly work_id: string;
  readonly namespace: string;
  readonly value: string;
  readonly source: string;
  readonly evidence_ref: string;
  readonly current_resolution_digest: string | null;
  readonly current_result_digest: string | null;
  readonly path?: string;
}): DependencyArrival {
  const row = waitingRowFor(input.work_id, input.path);
  if (row === null) {
    return { work_id: input.work_id, known: false, evaluation: null, resume: false, detail: `UNKNOWN_WORK: no waiting row for ${input.work_id}` };
  }

  const event: DependencyEvent = {
    key: dependencyKey(input.namespace, input.value),
    value: input.value,
    source: input.source,
    evidence_ref: input.evidence_ref,
    occurred_at: new Date().toISOString(),
  };
  const satisfied = satisfiedKeysFrom([event]);
  const evaluation = evaluate(row, event, satisfied, input.current_resolution_digest, input.current_result_digest);
  const resume = evaluation.verdict === "RESUME_ELIGIBLE";

  if (resume) {
    // The SAME work_id transitions to RESUMED. Loop-safety counters carry
    // forward so a repeated identical trigger is refused by the evaluator
    // on the next arrival, not by anything invented here.
    appendWaiting({
      ...row,
      status: "RESUMED",
      resume_attempt_count: row.resume_attempt_count + 1,
      last_resume_reason: evaluation.reason,
      last_input_digest: evaluation.input_digest,
      last_result_digest: input.current_result_digest,
      recorded_at: new Date().toISOString(),
    }, input.path);
  }

  return { work_id: row.work_id, known: true, evaluation, resume, detail: `${evaluation.verdict}: ${evaluation.reason} (via ${SOURCE_MARKER})` };
}

/**
 * Record what the resume actually PRODUCED. Loop safety is "same trigger AND
 * unchanged result", so the result half has to be written down after the
 * work ran — otherwise a repeating trigger looks new forever and the bound
 * never bites. The caller supplies the digest; this file computes nothing
 * about the work's outcome itself.
 */
export function recordResumeOutcome(workId: string, resultDigest: string | null, path?: string): boolean {
  const row = waitingRowFor(workId, path);
  if (row === null) return false;
  appendWaiting({ ...row, last_result_digest: resultDigest, recorded_at: new Date().toISOString() }, path);
  return true;
}
