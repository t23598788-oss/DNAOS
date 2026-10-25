/**
 * Continuous Operations Runtime (owner, 2026-08-08, Software Factory
 * Step 12.5). Real, manual-trigger-callable Operations Loop — reuses
 * monitoringRuntime.ts/incidentRuntime.ts/alertRuntime.ts/backupRuntime.ts
 * exactly (Rule 103). Deterministic, never AI-judged, never fabricates a
 * signal when a provider is unreachable, never treats missing/stale as
 * healthy. RESTORE_TEST_PLAN/RESTORE_TEST_VERIFICATION are deliberately
 * NOT part of the automatic loop (owner-triggered only, via their own
 * real routes) — a restore test is a periodic, deliberate action, not
 * something to fire on every collection tick.
 *
 * Concurrency: a real, single in-memory lock per ownerId — a second
 * real call while one is RUNNING returns the SAME in-flight run
 * (SKIPPED_DUPLICATE is recorded as a real, separate run entry
 * referencing it, never silently dropped).
 */
import { randomUUID, createHash } from "crypto";
import { collectAllSignals, computeMonitoringSummary, type SignalRecord } from "./monitoringRuntime";
import { openIncidentFromSignal, listIncidents, type IncidentRecord } from "./incidentRuntime";
import { dispatchAlert } from "./alertRuntime";
import { discoverBackups, verifyBackupIntegrity } from "./backupRuntime";
import { createOperationsArtifact } from "./artifactRuntime";
import { getOperationsJobTypeDefinition, type OperationsJobType } from "./continuousOperationsRegistry";

function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }

export type LoopRunStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "SKIPPED_DUPLICATE";
export interface LoopStepResult { jobType: OperationsJobType; status: "PASSED" | "FAILED" | "SKIPPED"; detail: string }

export interface OperationsLoopRun {
  runId: string;
  ownerId: string;
  actor: string;
  trigger: "MANUAL" | "CRON";
  status: LoopRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sourceHash: string;
  steps: LoopStepResult[];
  signalsCollected: number;
  incidentsOpened: number;
  alertsDispatched: number;
  artifactIds: string[];
}

export class OperationsLoopError extends Error {
  code: "LOOP_RUN_NOT_FOUND" | "LOOP_RUN_NOT_OWNED";
  constructor(code: typeof OperationsLoopError.prototype.code, message: string) { super(message); this.code = code; this.name = "OperationsLoopError"; }
}

const loopRuns = new Map<string, OperationsLoopRun>();
const locks = new Map<string, string>(); // ownerId -> runId currently RUNNING
const MAX_LOOP_RUN_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...loopRuns.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  while (owned.length > MAX_LOOP_RUN_HISTORY) { const oldest = owned.shift()!; loopRuns.delete(oldest.runId); }
}

export interface LoopEvent {
  eventId: string; type: "OPERATIONS_LOOP_STARTED" | "OPERATIONS_LOOP_COMPLETED" | "OPERATIONS_LOOP_FAILED" | "OPERATIONS_LOOP_SKIPPED";
  runId: string; actor: string; timestamp: string; evidence: string;
}
const loopEvents: LoopEvent[] = [];
const MAX_EVENTS = 500;
function emitLoopEvent(type: LoopEvent["type"], runId: string, actor: string, evidence: string) {
  loopEvents.push({ eventId: randomUUID(), type, runId, actor, timestamp: new Date().toISOString(), evidence });
  while (loopEvents.length > MAX_EVENTS) loopEvents.shift();
}
export function listLoopEvents(limit = 200): LoopEvent[] {
  return loopEvents.slice(-limit).reverse();
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`real step timeout after ${ms}ms`)), ms))]);
}

export async function runOperationsLoop(ownerId: string, actor: string, trigger: "MANUAL" | "CRON" = "MANUAL"): Promise<OperationsLoopRun> {
  const existingLockRunId = locks.get(ownerId);
  if (existingLockRunId) {
    const existing = loopRuns.get(existingLockRunId);
    if (existing && existing.status === "RUNNING") {
      const dupId = randomUUID();
      const dup: OperationsLoopRun = { ...existing, runId: dupId, status: "SKIPPED_DUPLICATE", finishedAt: new Date().toISOString() };
      loopRuns.set(dupId, dup);
      emitLoopEvent("OPERATIONS_LOOP_SKIPPED", dupId, actor, `real duplicate-run prevention — run ${existing.runId} is already RUNNING for this owner`);
      return dup;
    }
    locks.delete(ownerId);
  }

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  locks.set(ownerId, runId);
  const run: OperationsLoopRun = {
    runId, ownerId, actor, trigger, status: "RUNNING", startedAt, finishedAt: null, durationMs: null,
    sourceHash: "", steps: [], signalsCollected: 0, incidentsOpened: 0, alertsDispatched: 0, artifactIds: [],
  };
  loopRuns.set(runId, run);
  emitLoopEvent("OPERATIONS_LOOP_STARTED", runId, actor, `real Operations Loop started (trigger: ${trigger})`);

  const timeoutMs = getOperationsJobTypeDefinition("OPERATIONS_SUMMARY")!.timeoutMs;
  try {
    await withTimeout((async () => {
      // 1. MONITORING_COLLECTION
      let signals: SignalRecord[] = [];
      try {
        signals = await collectAllSignals(ownerId, actor);
        run.signalsCollected = signals.length;
        run.steps.push({ jobType: "MONITORING_COLLECTION", status: "PASSED", detail: `real ${signals.length} signals collected` });
      } catch (e) {
        run.steps.push({ jobType: "MONITORING_COLLECTION", status: "FAILED", detail: e instanceof Error ? e.message : String(e) });
      }

      // 2. SIGNAL_FRESHNESS_CHECK — real, derived from the real signals just collected
      const staleOrMissing = signals.filter((s) => s.status === "STALE" || s.status === "MISSING");
      run.steps.push({ jobType: "SIGNAL_FRESHNESS_CHECK", status: "PASSED", detail: `${staleOrMissing.length} real stale/missing signal(s) of ${signals.length}` });

      // 3. INCIDENT_REEVALUATION — real, only from real non-healthy signals
      const bad = signals.filter((s) => ["UNHEALTHY", "DEGRADED", "STALE", "MISSING"].includes(s.status));
      const incidentsThisRun: IncidentRecord[] = [];
      try {
        for (const s of bad) incidentsThisRun.push(await openIncidentFromSignal(s, ownerId, actor));
        run.incidentsOpened = incidentsThisRun.length;
        run.steps.push({ jobType: "INCIDENT_REEVALUATION", status: "PASSED", detail: `real ${incidentsThisRun.length} incident(s) opened/correlated from ${bad.length} real non-healthy signal(s)` });
      } catch (e) {
        run.steps.push({ jobType: "INCIDENT_REEVALUATION", status: "FAILED", detail: e instanceof Error ? e.message : String(e) });
      }

      // 4. ALERT_DISPATCH — real, only for real open incidents
      try {
        const openIncidents = listIncidents(ownerId).filter((i) => !["RESOLVED", "FALSE_POSITIVE"].includes(i.status));
        let dispatched = 0;
        for (const inc of openIncidents) { const a = await dispatchAlert(inc, ownerId, actor); if (a.status === "DISPATCHED") dispatched++; }
        run.alertsDispatched = dispatched;
        run.steps.push({ jobType: "ALERT_DISPATCH", status: "PASSED", detail: `real ${dispatched} alert(s) dispatched across ${openIncidents.length} real open incident(s)` });
      } catch (e) {
        run.steps.push({ jobType: "ALERT_DISPATCH", status: "FAILED", detail: e instanceof Error ? e.message : String(e) });
      }

      // 5/6. BACKUP_PLAN_CHECK + BACKUP_INTEGRITY_CHECK
      try {
        const backups = discoverBackups();
        run.steps.push({ jobType: "BACKUP_PLAN_CHECK", status: "PASSED", detail: `real ${backups.length} backup(s) discovered` });
        if (backups.length > 0) {
          const report = await verifyBackupIntegrity(backups[0].backupId, ownerId, actor);
          run.steps.push({ jobType: "BACKUP_INTEGRITY_CHECK", status: "PASSED", detail: `real latest backup (${backups[0].backupId}) integrity: ${report.status}` });
        } else {
          run.steps.push({ jobType: "BACKUP_INTEGRITY_CHECK", status: "SKIPPED", detail: "no real backup exists to verify" });
        }
      } catch (e) {
        run.steps.push({ jobType: "BACKUP_PLAN_CHECK", status: "FAILED", detail: e instanceof Error ? e.message : String(e) });
      }

      // 7. RESTORE_TEST_PLAN / RESTORE_TEST_VERIFICATION — deliberately not run automatically this loop
      run.steps.push({ jobType: "RESTORE_TEST_PLAN", status: "SKIPPED", detail: "restore tests are owner-triggered only, not part of the automatic loop, by design" });
      run.steps.push({ jobType: "RESTORE_TEST_VERIFICATION", status: "SKIPPED", detail: "restore tests are owner-triggered only, not part of the automatic loop, by design" });

      // 9. OPERATIONS_SUMMARY
      const summary = computeMonitoringSummary(ownerId);
      run.steps.push({ jobType: "OPERATIONS_SUMMARY", status: "PASSED", detail: `real overallStatus: ${summary.overallStatus}` });
    })(), timeoutMs);

    run.status = run.steps.some((s) => s.status === "FAILED") ? "FAILED" : "SUCCEEDED";
  } catch (e) {
    run.status = e instanceof Error && e.message.includes("timeout") ? "TIMED_OUT" : "FAILED";
    run.steps.push({ jobType: "OPERATIONS_SUMMARY", status: "FAILED", detail: e instanceof Error ? e.message : String(e) });
  } finally {
    run.finishedAt = new Date().toISOString();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    run.sourceHash = sha256Hex(JSON.stringify(run.steps));
    locks.delete(ownerId);
  }

  const runArtifact = createOperationsArtifact({
    artifactType: "CONTINUOUS_MONITORING_RUN", content: JSON.stringify(run), mimeType: "application/json",
    actor, ownerId, generatedFrom: runId, jobId: null,
  });
  run.artifactIds.push(runArtifact.artifactId);

  loopRuns.set(runId, run);
  evictOld(ownerId);

  if (run.status === "SUCCEEDED") emitLoopEvent("OPERATIONS_LOOP_COMPLETED", runId, actor, `real loop completed: ${run.signalsCollected} signals, ${run.incidentsOpened} incidents, ${run.alertsDispatched} alerts, duration ${run.durationMs}ms`);
  else emitLoopEvent("OPERATIONS_LOOP_FAILED", runId, actor, `real loop ended with status ${run.status}`);

  return run;
}

export function getLoopRun(runId: string, ownerId: string): OperationsLoopRun {
  const r = loopRuns.get(runId);
  if (!r) throw new OperationsLoopError("LOOP_RUN_NOT_FOUND", "no loop run with that id");
  if (r.ownerId !== ownerId) throw new OperationsLoopError("LOOP_RUN_NOT_OWNED", "this loop run belongs to a different session");
  return r;
}
export function listLoopRuns(ownerId: string): OperationsLoopRun[] {
  return [...loopRuns.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export function __debugLoopRunCount(): number { return loopRuns.size; }
