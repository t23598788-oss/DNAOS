/**
 * Production Queue Runtime (owner, 2026-08-06, Software Factory Step 3).
 *
 * Editor → Save → Create Job → Queue → Execution Runtime → Result → History
 *
 * This is the connective layer between the Editor's real save path (Step
 * 1), the Controlled Terminal's real Execution Runtime (Step 2), and a
 * real Job record that both flow through. It does NOT reimplement file
 * I/O or process execution — RUN_COMMAND/TYPE_CHECK jobs call the real
 * executionRuntime.ts's startRun()/cancelRun()/subscribeToRunEvents()
 * directly (same engine the Terminal panel uses); OPEN_FILE/SAVE_FILE jobs
 * are recorded by app/api/admin/ide/file/route.ts itself, right after it
 * does the real read/write, via recordCompletedJob() below — the file
 * logic in that route is untouched, this only adds a Job record around it.
 *
 * Checked first, reused where real (per instruction, "ห้ามสร้างซ้ำ"):
 *   - Execution Runtime (engines/shared/ide-lib/executionRuntime.ts) — the
 *     actual process engine. Reused directly for RUN_COMMAND/TYPE_CHECK,
 *     never reimplemented.
 *   - registry/execution/*.registry.json — a real, existing "pipeline"
 *     registry, but for a completely different domain (the LINE message
 *     webhook processing pipeline: signature verify → log → AI extract →
 *     ...). Not a live job queue, not reusable for IDE Editor/Terminal
 *     jobs — checked and ruled out, not duplicated blindly.
 *   - registry/commands/workflows.json — real, but for desktop-automation
 *     command sequences (OPEN_APP/CLICK/TYPE_TEXT for plugins/agent), an
 *     unrelated domain. Not reusable here either.
 *   - No existing Task Queue / Job Queue code exists anywhere in this
 *     repository (verified: no "TaskQueue"/"JobQueue" hits) — the Job
 *     store/lifecycle in this file is the genuinely new part.
 */
import { randomUUID } from "crypto";
import { getCommandDefinition, ExecutionError } from "./executionRegistry";
import { startRun, cancelRun, subscribeToRunEvents, type RunRecord } from "./executionRuntime";
import { getJobTypeDefinition, type JobType } from "./queueRegistry";

export type JobStatus = "QUEUED" | "READY" | "RUNNING" | "WAITING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "REJECTED";

export interface Job {
  jobId: string;
  type: JobType;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  actor: string;
  /** Which real UI surface created this job — "editor" (OPEN_FILE/
   * SAVE_FILE), "terminal" (RUN_COMMAND/TYPE_CHECK), "ui-inspection"
   * (UI_INSPECTION, Step 6), "review" (Change Set / Code Review /
   * Review Decision job types, Step 7), "test" (RUN_TEST/RERUN_TEST/
   * TEST_COLLECTION/TEST_REPORT, Step 8), "build" (BUILD_REQUEST/
   * RUN_BUILD/VERIFY_BUILD/COMPARE_BUILD/BUILD_REPORT, Step 9), or
   * "release" (RELEASE_REQUEST/VALIDATE_RELEASE/PACKAGE_CAPABILITIES/
   * APPROVE_RELEASE/OPERATIONAL_READINESS_CHECK, Step 10), or
   * "deployment" (DEPLOYMENT_PLAN_REQUEST/DEPLOYMENT_GATE_CHECK/
   * APPROVE_DEPLOYMENT, Step 11 — never a real deploy), or "operations"
   * (MONITORING_COLLECT/INCIDENT_OPEN/INCIDENT_STATUS_CHANGE/
   * RECOVERY_PLAN_REQUEST/RECOVERY_APPROVE/RECOVERY_VERIFY, Step 12 —
   * observe/detect/plan/verify only, never a real mutation), or "worker"
   * (WORKER_INVOKE — every real AI Worker call, Step 13.6 Bridge, owner
   * 2026-08-07). */
  source: "editor" | "terminal" | "ui-inspection" | "review" | "test" | "build" | "release" | "deployment" | "operations" | "worker";
  file: string | null;
  command: string | null;
  status: JobStatus;
  /** 0-100. Real, not fabricated fine-grained progress — jobs here are
   * either instant (file ops) or have exactly one real underlying process
   * (commands), so progress only ever reflects real state transitions:
   * 0 queued, 50 running, 100 terminal. */
  progress: number;
  factory: string;
  executionId: string | null;
  result: string | null;
  duration: number | null;
  error: string | null;
  /** Internal — not part of the spec's field list, but required to
   * enforce "owner only" access; ownership filtering never trusts a
   * client-supplied value. */
  ownerId: string;
}

export type JobEventType = "JOB_CREATED" | "JOB_STARTED" | "JOB_FINISHED" | "JOB_FAILED" | "JOB_CANCELLED";
export interface JobEvent { seq: number; type: JobEventType; ts: string; detail: string | null }

export class QueueError extends Error {
  code: "JOB_NOT_FOUND" | "JOB_NOT_OWNED" | "JOB_TYPE_NOT_IMPLEMENTED" | "DUPLICATE_JOB" | "JOB_NOT_CANCELLABLE" | "JOB_NOT_RETRYABLE" | "INTERNAL_ERROR";
  constructor(code: typeof QueueError.prototype.code, message: string) {
    super(message);
    this.code = code;
    this.name = "QueueError";
  }
}

interface JobState { job: Job; events: JobEvent[]; nextSeq: number; retryOf: string | null }

const MAX_JOB_HISTORY = 100;
const jobs = new Map<string, JobState>();
/** Duplicate Job Protection — one in-flight job per (ownerId, type,
 * dedupe key) at a time. Key is the file path for OPEN_FILE/SAVE_FILE, the
 * commandId for RUN_COMMAND/TYPE_CHECK. */
const inFlightKeys = new Set<string>();

function dedupeKey(ownerId: string, type: JobType, key: string): string {
  return `${ownerId}:${type}:${key}`;
}
function isTerminal(status: JobStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED" || status === "REJECTED";
}

function emitJobEvent(state: JobState, type: JobEventType, detail: string | null) {
  state.events.push({ seq: state.nextSeq++, type, ts: new Date().toISOString(), detail });
}

function evictOldFinishedJobs(ownerId: string) {
  const ownerFinished = [...jobs.values()]
    .filter((s) => s.job.ownerId === ownerId && isTerminal(s.job.status))
    .sort((a, b) => (a.job.finishedAt ?? "").localeCompare(b.job.finishedAt ?? ""));
  const ownerTotal = [...jobs.values()].filter((s) => s.job.ownerId === ownerId).length;
  const overflow = ownerTotal - MAX_JOB_HISTORY;
  for (let i = 0; i < Math.min(overflow, ownerFinished.length); i++) jobs.delete(ownerFinished[i].job.jobId);
}

function finalizeJob(state: JobState, status: JobStatus, result: string | null, error: string | null) {
  if (isTerminal(state.job.status)) return;
  const finishedAt = new Date();
  state.job.status = status;
  state.job.finishedAt = finishedAt.toISOString();
  state.job.progress = 100;
  state.job.result = result;
  state.job.error = error;
  state.job.duration = state.job.startedAt ? finishedAt.getTime() - new Date(state.job.startedAt).getTime() : 0;
  emitJobEvent(state, status === "SUCCEEDED" ? "JOB_FINISHED" : status === "CANCELLED" ? "JOB_CANCELLED" : "JOB_FAILED", error);
  const key = state.job.file ?? state.job.command;
  if (key) inFlightKeys.delete(dedupeKey(state.job.ownerId, state.job.type, key));
  evictOldFinishedJobs(state.job.ownerId);
}

function newJobRecord(type: JobType, actor: string, ownerId: string, source: Job["source"], file: string | null, command: string | null): { job: Job; state: JobState } {
  const def = getJobTypeDefinition(type)!;
  const job: Job = {
    jobId: randomUUID(), type, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null,
    actor, source, file, command, status: "QUEUED", progress: 0, factory: def.factory,
    executionId: null, result: null, duration: null, error: null, ownerId,
  };
  const state: JobState = { job, events: [], nextSeq: 0, retryOf: null };
  jobs.set(job.jobId, state);
  emitJobEvent(state, "JOB_CREATED", null);
  return { job, state };
}

/**
 * Starts a real UI_INSPECTION job in RUNNING state BEFORE the real Browser
 * Inspection Runtime scan begins (unlike recordCompletedJob, which records
 * retrospectively) — the scan itself needs a real jobId to stamp onto
 * every Inspection Record/Artifact it produces as it runs, so the job must
 * exist first. Finalized via finalizeUiInspectionJob() once the real scan
 * settles. Same real Job store, same real finalizeJob() primitive every
 * other job type already uses — never a second queue.
 */
export function startUiInspectionJob(actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord("UI_INSPECTION", actor, ownerId, "ui-inspection", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeUiInspectionJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real CHANGE_SET_CREATE/CHANGE_SET_REFRESH/CODE_REVIEW/
 * REVIEW_DECISION job in RUNNING state BEFORE the real Code Review
 * Pipeline work begins (Step 7) — same real "start now, finalize once the
 * real work settles" pattern already established for UI_INSPECTION above,
 * generalized rather than re-implemented per job type.
 */
export function startReviewJob(type: "CHANGE_SET_CREATE" | "CHANGE_SET_REFRESH" | "CODE_REVIEW" | "REVIEW_DECISION", actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, "review", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeReviewJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real WORKER_INVOKE job BEFORE a real Worker Adapter call begins
 * (owner, 2026-08-07, /admin/ide Foundation — VS Code Coding Worker
 * integration) — the one, required Queue hop between the Owner Command
 * Surface and the Worker Selector/Adapter, so a live AI Worker call is
 * never dispatched without a real, observable Job (mirrors
 * startReviewJob's exact real pattern, never a second queue).
 */
export function startWorkerInvokeJob(actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord("WORKER_INVOKE", actor, ownerId, "worker", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeWorkerInvokeJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real RUN_TEST/RERUN_TEST/TEST_COLLECTION/TEST_REPORT job in
 * RUNNING state BEFORE the real Test Pipeline work begins (Step 8) — same
 * real "start now, finalize once the real work settles" pattern already
 * established for UI_INSPECTION/Review above, generalized rather than
 * re-implemented per job type.
 */
export function startTestJob(type: "RUN_TEST" | "RERUN_TEST" | "TEST_COLLECTION" | "TEST_REPORT", actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, "test", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeTestJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real BUILD_REQUEST/RUN_BUILD/VERIFY_BUILD/COMPARE_BUILD/
 * BUILD_REPORT job in RUNNING state BEFORE the real Build Pipeline work
 * begins (Step 9) — same real "start now, finalize once the real work
 * settles" pattern already established for UI_INSPECTION/Review/Test above,
 * generalized rather than re-implemented per job type.
 */
export function startBuildJob(type: "BUILD_REQUEST" | "RUN_BUILD" | "VERIFY_BUILD" | "COMPARE_BUILD" | "BUILD_REPORT", actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, "build", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeBuildJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real RELEASE_REQUEST/VALIDATE_RELEASE/PACKAGE_CAPABILITIES/
 * APPROVE_RELEASE/OPERATIONAL_READINESS_CHECK job in RUNNING state BEFORE
 * the real Release Pipeline work begins (Step 10) — same real "start now,
 * finalize once the real work settles" pattern already established for
 * Test/Build above, generalized rather than re-implemented per job type.
 */
export function startReleaseJob(type: "RELEASE_REQUEST" | "VALIDATE_RELEASE" | "PACKAGE_CAPABILITIES" | "APPROVE_RELEASE" | "OPERATIONAL_READINESS_CHECK", actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, "release", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeReleaseJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real DEPLOYMENT_PLAN_REQUEST/DEPLOYMENT_GATE_CHECK/
 * APPROVE_DEPLOYMENT job (Step 11) — the SAME real "start now, finalize
 * once the real work settles" pattern as every prior Step's job types,
 * generalized rather than re-implemented. Never triggers a real deploy —
 * this only tracks the real, read-only Deployment Orchestration work.
 */
export function startDeploymentJob(type: "DEPLOYMENT_PLAN_REQUEST" | "DEPLOYMENT_GATE_CHECK" | "APPROVE_DEPLOYMENT", actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, "deployment", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeDeploymentJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Starts a real MONITORING_COLLECT/INCIDENT_OPEN/INCIDENT_STATUS_CHANGE/
 * RECOVERY_PLAN_REQUEST/RECOVERY_APPROVE/RECOVERY_VERIFY job (Step 12) —
 * the SAME real "start now, finalize once the real work settles" pattern
 * as every prior Step's job types, generalized rather than re-implemented.
 * Never triggers a real mutation — only tracks the real, read-only
 * Operations work.
 */
export function startOperationsJob(type: "MONITORING_COLLECT" | "INCIDENT_OPEN" | "INCIDENT_STATUS_CHANGE" | "RECOVERY_PLAN_REQUEST" | "RECOVERY_APPROVE" | "RECOVERY_VERIFY", actor: string, ownerId: string, target: string): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, "operations", target, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 10;
  emitJobEvent(state, "JOB_STARTED", null);
  return job;
}
export function finalizeOperationsJob(jobId: string, ownerId: string, outcome: { ok: boolean; result: string | null; error: string | null }): void {
  const state = jobs.get(jobId);
  if (!state || state.job.ownerId !== ownerId) return;
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
}

/**
 * Records a real, already-completed OPEN_FILE/SAVE_FILE/UI_INSPECTION
 * action as a Job — called right after the real work finishes (success or
 * failure); OPEN_FILE/SAVE_FILE from app/api/admin/ide/file/route.ts,
 * UI_INSPECTION from app/api/admin/ide/ui-inspection/run/route.ts once the
 * real Browser Inspection Runtime scan settles. The real work itself never
 * happens here.
 */
export function recordCompletedJob(
  type: "OPEN_FILE" | "SAVE_FILE" | "UI_INSPECTION", actor: string, ownerId: string, file: string,
  outcome: { ok: boolean; result: string | null; error: string | null }
): Job {
  const { job, state } = newJobRecord(type, actor, ownerId, type === "UI_INSPECTION" ? "ui-inspection" : "editor", file, null);
  job.status = "RUNNING";
  job.startedAt = job.createdAt;
  job.progress = 50;
  emitJobEvent(state, "JOB_STARTED", null);
  finalizeJob(state, outcome.ok ? "SUCCEEDED" : "FAILED", outcome.result, outcome.error);
  return job;
}

/**
 * Creates a real RUN_COMMAND (or TYPE_CHECK, for commandId "typecheck")
 * job — calls the real Execution Runtime's startRun() directly (never a
 * reimplementation), mirrors that run's real event stream onto the Job's
 * own status, and links executionId so the two are traceable to each other.
 */
export function createRunCommandJob(
  commandId: string, args: Record<string, unknown> | undefined, actor: string, ownerId: string, ownerConfirmation: boolean
): Job {
  const key = dedupeKey(ownerId, "RUN_COMMAND", commandId);
  if (inFlightKeys.has(key)) {
    throw new QueueError("DUPLICATE_JOB", `a job for command "${commandId}" is already in flight for this session`);
  }
  // Real validation up front — an unregistered commandId is rejected
  // before any Job record is even created (mirrors REJECTED semantics).
  getCommandDefinition(commandId); // throws ExecutionError("INVALID_COMMAND", ...) if unknown — propagates as-is

  const type: JobType = commandId === "typecheck" ? "TYPE_CHECK" : "RUN_COMMAND";
  const { job, state } = newJobRecord(type, actor, ownerId, "terminal", null, commandId);
  inFlightKeys.add(key);

  let run: RunRecord;
  try {
    run = startRun(commandId, args, ownerId, { actor, ownerConfirmation });
  } catch (e) {
    inFlightKeys.delete(key);
    const message = e instanceof ExecutionError ? `${e.code}: ${e.message}` : "failed to start";
    finalizeJob(state, "REJECTED", null, message);
    return job;
  }

  job.executionId = run.runId;
  job.status = "RUNNING";
  job.startedAt = new Date().toISOString();
  job.progress = 50;
  emitJobEvent(state, "JOB_STARTED", `execution ${run.runId}`);

  const sub = subscribeToRunEvents(run.runId, (event) => {
    if (event.type === "run.completed") finalizeJob(state, "SUCCEEDED", `exit 0`, null);
    else if (event.type === "run.failed") finalizeJob(state, "FAILED", null, "command exited non-zero or failed to run");
    else if (event.type === "run.cancelled") finalizeJob(state, "CANCELLED", null, "cancelled");
    else if (event.type === "run.timeout") finalizeJob(state, "FAILED", null, "TIMEOUT");
    else if (event.type === "run.output_limited") finalizeJob(state, "FAILED", null, "OUTPUT_LIMIT_EXCEEDED");
  });
  // subscribeToRunEvents replays history — if the run already finished
  // (very fast commands can complete before this line runs), the replay
  // above already finalized the job via the listener; nothing further to do.
  void sub;

  return job;
}

export function getJob(jobId: string, ownerId: string): Job {
  const state = jobs.get(jobId);
  if (!state) throw new QueueError("JOB_NOT_FOUND", "no job with that id");
  if (state.job.ownerId !== ownerId) throw new QueueError("JOB_NOT_OWNED", "this job belongs to a different session");
  return state.job;
}

export function listJobs(ownerId: string): Job[] {
  // Reverse Map insertion order rather than sorting by createdAt — two
  // jobs created within the same millisecond would otherwise get identical
  // ISO timestamps and an unstable/wrong relative order from a string
  // sort; a Map's real insertion order is exact and always correct here.
  return [...jobs.values()].filter((s) => s.job.ownerId === ownerId).map((s) => s.job).reverse();
}

export function getJobEvents(jobId: string, ownerId: string): JobEvent[] {
  const state = jobs.get(jobId);
  if (!state) throw new QueueError("JOB_NOT_FOUND", "no job with that id");
  if (state.job.ownerId !== ownerId) throw new QueueError("JOB_NOT_OWNED", "this job belongs to a different session");
  return state.events;
}

export function cancelJob(jobId: string, ownerId: string): Job {
  const state = jobs.get(jobId);
  if (!state) throw new QueueError("JOB_NOT_FOUND", "no job with that id");
  if (state.job.ownerId !== ownerId) throw new QueueError("JOB_NOT_OWNED", "this job belongs to a different session");
  if (isTerminal(state.job.status)) return state.job; // already terminal, no-op
  if (state.job.executionId) {
    // Real command job — send the real cancel signal and let the run's OWN
    // event stream (already subscribed to in createRunCommandJob) finalize
    // this Job once the process ACTUALLY exits. Force-finalizing the Job
    // here immediately would let it claim CANCELLED while the real
    // execution (and its per-owner concurrency slot) is still alive during
    // its grace period — a real state lie, not just a cosmetic one.
    try { cancelRun(state.job.executionId, ownerId); } catch { /* real run may already be gone/terminal */ }
    return state.job;
  }
  // A file-op job is always already terminal by the time it's ever
  // observable (recordCompletedJob finalizes synchronously) — this branch
  // only exists for a hypothetical future synchronous job type with no
  // executionId that's still QUEUED/RUNNING when cancelled.
  finalizeJob(state, "CANCELLED", null, "cancelled by owner");
  return state.job;
}

/** Real re-invocation — creates a brand NEW job of the same type+target,
 * never resumes or mutates the original (finished) job record. Only
 * terminal (FAILED/CANCELLED/REJECTED) jobs can be retried. */
export function retryJob(jobId: string, ownerId: string, actor: string): Job {
  const state = jobs.get(jobId);
  if (!state) throw new QueueError("JOB_NOT_FOUND", "no job with that id");
  if (state.job.ownerId !== ownerId) throw new QueueError("JOB_NOT_OWNED", "this job belongs to a different session");
  if (!isTerminal(state.job.status) || state.job.status === "SUCCEEDED") {
    throw new QueueError("JOB_NOT_RETRYABLE", "only a FAILED, CANCELLED, or REJECTED job can be retried");
  }
  if (state.job.type === "RUN_COMMAND" || state.job.type === "TYPE_CHECK") {
    if (!state.job.command) throw new QueueError("INTERNAL_ERROR", "job has no command to retry");
    return createRunCommandJob(state.job.command, undefined, actor, ownerId, true);
  }
  throw new QueueError("JOB_NOT_RETRYABLE", `job type "${state.job.type}" is not retryable (file-op jobs complete synchronously and have nothing to re-run)`);
}

/** Clears this owner's FINISHED jobs from the live queue view — never
 * touches a real file, never deletes execution history (executionRuntime's
 * own run records are untouched; only this Job wrapper record is dropped). */
export function clearFinishedJobs(ownerId: string): number {
  const toDelete = [...jobs.values()].filter((s) => s.job.ownerId === ownerId && isTerminal(s.job.status));
  for (const s of toDelete) jobs.delete(s.job.jobId);
  return toDelete.length;
}

// ---- Test-only introspection (never imported by any route) ----
export function __debugJobCount(): number {
  return jobs.size;
}
export function __debugInFlightKeys(): string[] {
  return [...inFlightKeys];
}
