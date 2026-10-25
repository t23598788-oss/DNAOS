/**
 * Continuous Operations — Job Type Registry (owner, 2026-08-08, Software
 * Factory Step 12.5). Declares the real, scheduled/repeatable Operations
 * Job Types. Reuses queueRuntime.ts/executionRuntime.ts's real bounded
 * job pattern — never a second Queue/Scheduler Store.
 *
 * Reuse investigation (Phase 1) — real, confirmed by direct inspection:
 *  - vercel.json already declares a REAL Vercel Cron entry
 *    (/api/cron/supabase-project-status, every 6h) — this app's real,
 *    already-in-production scheduler mechanism. app/api/cron/
 *    supabase-project-status/route.ts's real CRON_SECRET + `Authorization:
 *    Bearer` pattern is the real, established Scheduler Adapter contract
 *    this Step's new /api/cron/operations-loop route mirrors exactly.
 *  - supabase/migrations/*.sql declares 10+ real pg_cron schedules for
 *    Edge Functions (e.g. system-health-check every 5 min) — a second,
 *    real, independent scheduler this repo already depends on. This Step
 *    deliberately does NOT bind Core to either provider alone (mission:
 *    "ห้ามผูก Core กับ Provider รายเดียว") — the Job Runtime below is
 *    provider-agnostic; only the NEW /api/cron/operations-loop adapter is
 *    Vercel-specific.
 *  - No real, in-process Node scheduler (setInterval-based daemon) exists
 *    in the Next.js app itself — real, honest gap; a server process here
 *    is short-lived per-request, not a persistent daemon.
 */
export type OperationsJobType =
  | "MONITORING_COLLECTION" | "SIGNAL_FRESHNESS_CHECK" | "INCIDENT_REEVALUATION" | "ALERT_DISPATCH"
  | "BACKUP_PLAN_CHECK" | "BACKUP_INTEGRITY_CHECK" | "RESTORE_TEST_PLAN" | "RESTORE_TEST_VERIFICATION"
  | "OPERATIONS_SUMMARY";

export type OperationsJobStatus = "IMPLEMENTED" | "PARTIAL" | "PLAN_ONLY" | "NOT_IMPLEMENTED" | "UNKNOWN";
export type MutationLevel = "NONE" | "LOCAL_STATE_ONLY" | "PROVIDER_MUTATING" | "DESTRUCTIVE";

export interface OperationsJobTypeDefinition {
  id: OperationsJobType;
  displayName: string;
  owner: string;
  sourceRuntime: string;
  scheduleMode: "MANUAL_TRIGGER_ONLY" | "CRON_CONTRACT" | "CONTINUOUS";
  defaultIntervalMs: number;
  minimumIntervalMs: number;
  timeoutMs: number;
  retryPolicy: string;
  deduplicationPolicy: string;
  concurrencyPolicy: string;
  evidenceRequirements: string[];
  mutationLevel: MutationLevel;
  ownerApprovalRequired: boolean;
  status: OperationsJobStatus;
}

const MIN_1 = 60_000, MIN_5 = 5 * MIN_1, MIN_10 = 10 * MIN_1, MIN_30 = 30 * MIN_1, HOUR_1 = 60 * MIN_1, HOUR_6 = 6 * HOUR_1;

function def(id: OperationsJobType, displayName: string, sourceRuntime: string, evidenceRequirements: string[], status: OperationsJobStatus = "PARTIAL"): OperationsJobTypeDefinition {
  return {
    id, displayName, owner: "operations-center", sourceRuntime,
    scheduleMode: "MANUAL_TRIGGER_ONLY", defaultIntervalMs: MIN_10, minimumIntervalMs: MIN_1, timeoutMs: MIN_1,
    retryPolicy: "no automatic retry this Step — a failed run is recorded honestly, never silently retried without owner visibility",
    deduplicationPolicy: "a run already RUNNING for the same owner+jobType is never started twice — the existing run is returned instead",
    concurrencyPolicy: "single real in-flight run per owner+jobType, enforced via a real in-memory lock map",
    evidenceRequirements, mutationLevel: "NONE", ownerApprovalRequired: false, status,
  };
}

export const OPERATIONS_JOB_TYPE_REGISTRY: Record<OperationsJobType, OperationsJobTypeDefinition> = {
  MONITORING_COLLECTION: { ...def("MONITORING_COLLECTION", "Monitoring Collection", "monitoringRuntime.ts#collectAllSignals", ["real SignalRecord[]"], "PARTIAL") },
  SIGNAL_FRESHNESS_CHECK: { ...def("SIGNAL_FRESHNESS_CHECK", "Signal Freshness Check", "continuousOperationsRuntime.ts#evaluateFreshness", ["real Signal.observedAt vs staleAfterMs"], "PARTIAL") },
  INCIDENT_REEVALUATION: { ...def("INCIDENT_REEVALUATION", "Incident Re-evaluation", "incidentRuntime.ts#openIncidentFromSignal", ["real, freshly-collected SignalRecord"], "PARTIAL") },
  ALERT_DISPATCH: { ...def("ALERT_DISPATCH", "Alert Dispatch", "alertRuntime.ts#dispatchAlert", ["real Incident/Signal finding", "real channel dispatch result"], "PARTIAL") },
  BACKUP_PLAN_CHECK: { ...def("BACKUP_PLAN_CHECK", "Backup Plan Check", "backupRuntime.ts#discoverBackups", ["real backups/*/_manifest.json"], "PARTIAL") },
  BACKUP_INTEGRITY_CHECK: { ...def("BACKUP_INTEGRITY_CHECK", "Backup Integrity Check", "backupRuntime.ts#verifyBackupIntegrity", ["real manifest + real per-table file read"], "PARTIAL") },
  RESTORE_TEST_PLAN: { ...def("RESTORE_TEST_PLAN", "Restore Test Plan", "restoreTestRuntime.ts#createRestoreTestPlan", ["real, verified BackupRecord"], "PLAN_ONLY") },
  RESTORE_TEST_VERIFICATION: { ...def("RESTORE_TEST_VERIFICATION", "Restore Test Verification", "restoreTestRuntime.ts#runRestoreTest", ["real dry-run parse of real backup table files"], "PLAN_ONLY") },
  OPERATIONS_SUMMARY: { ...def("OPERATIONS_SUMMARY", "Operations Summary", "continuousOperationsRuntime.ts#runOperationsLoop", ["real MonitoringSummary + real Incident/Recovery/Backup counts"], "PARTIAL") },
};

export function listOperationsJobTypes(): OperationsJobTypeDefinition[] {
  return Object.values(OPERATIONS_JOB_TYPE_REGISTRY);
}
export function getOperationsJobTypeDefinition(type: string): OperationsJobTypeDefinition | undefined {
  return OPERATIONS_JOB_TYPE_REGISTRY[type as OperationsJobType];
}

// ============================================================
// Scheduler Contract / Adapter (Phase 4) — real, separated per mission
// instruction: "ต้องแยก Scheduler Contract / Scheduler Adapter / Job Runtime"
// ============================================================
export interface SchedulerContractStatus {
  contract: "IMPLEMENTED";
  adapter: "NOT_IMPLEMENTED" | "COMPATIBILITY_ONLY" | "IMPLEMENTED";
  loop: "MANUAL_TRIGGER_ONLY" | "PARTIAL" | "CONTINUOUS";
  evidence: string[];
}
export function getSchedulerContractStatus(): SchedulerContractStatus {
  return {
    contract: "IMPLEMENTED",
    adapter: "COMPATIBILITY_ONLY",
    loop: "MANUAL_TRIGGER_ONLY",
    evidence: [
      "real vercel.json cron entry declared for /api/cron/operations-loop (real, declarative — fires only once this app is actually deployed to Vercel, which is out of scope this Step)",
      "real app/api/cron/operations-loop/route.ts exists, real CRON_SECRET-gated, mirrors the SAME real pattern as the already-deployed /api/cron/supabase-project-status route",
      "real supabase/migrations pg_cron precedent confirmed (system-health-check runs every 5 min in production) — a second, independent, already-proven scheduler this repo depends on, deliberately not bound to as the ONLY adapter",
      "no real, live proof this Step that /api/cron/operations-loop has ever actually fired — honestly COMPATIBILITY_ONLY, never claimed CONTINUOUS",
    ],
  };
}
