/**
 * Monitoring — Signal Type Registry (owner, 2026-08-08, Software Factory
 * Step 12). Declares the real Signal Types monitoringRuntime.ts observes.
 *
 * Reuse Investigation (Phase 1, real, confirmed by direct inspection
 * before writing this file):
 *  - No Monitoring/Incident/Recovery Runtime exists anywhere under
 *    app/api/admin/ide/_lib/ (grep-verified for monitor-, health-,
 *    incident-, and recovery-related names — the only hits were Step
 *    10.5/11's own NOT_IMPLEMENTED findings about this exact gap).
 *  - A REAL, deployed, external monitoring mechanism DOES exist outside
 *    the IDE surface: supabase/functions/system-health-check/index.ts
 *    (real Edge Function, cron every 5 min per supabase/migrations/
 *    20260729000001_system_health_check.sql) writes real rows to the
 *    real `system_health_status` table (service_key/status/check_kind/
 *    consecutive_failures/last_check_at/detail — migration
 *    20260804000001), checking real Supabase/Anthropic/LINE/Gmail
 *    reachability + real pg_cron execution history. A real, already-
 *    configured, already-used-elsewhere client already reads this table:
 *    app/api/admin/infrastructure/route.ts uses supabaseAdmin() from
 *    services/supabase/queries.ts. REUSED here read-only for
 *    EXTERNAL_PROVIDER_HEALTH/CONNECTOR_HEALTH — never a second table,
 *    never a fabricated integration, never a write.
 *  - scripts/backup.ts is real (20-table Supabase→local-JSON backup +
 *    upsert-restore), and backups/2026-07-05_0502/ is a real, single,
 *    stale (>30 days as of this Step) backup with a real _manifest.json
 *    (19/20 tables, 511 rows, 1 real error: kv_cache table missing).
 *    registry/infrastructure.json's real `backup` field confirms:
 *    schedule "manual", risk_note about single local-disk copy, no cloud
 *    backup (status: "planned", not real). REUSED read-only for
 *    BACKUP_HEALTH — never invoking backup/restore itself.
 *  - artifactRuntime.ts#checkIntegrity() already exists and is REUSED
 *    directly for ARTIFACT_INTEGRITY — never re-implemented.
 *  - governanceRuntime.ts#computeCoverageSummary() already exists and is
 *    REUSED directly for GOVERNANCE_HEALTH.
 *  - registry/architecture-book.json's real summary (broken/unregistered)
 *    is REUSED directly for REGISTRY_INTEGRITY.
 *  - executionRuntime.ts#listRuns() / queueRuntime.ts#listJobs() /
 *    buildRuntime.ts#listBuildRuns() / releaseRuntime.ts#listReleaseRuns()
 *    / deploymentRuntime.ts#listDeploymentPlans() are REUSED directly for
 *    EXECUTION_HEALTH/QUEUE_HEALTH/BUILD_HEALTH/RELEASE_HEALTH/
 *    DEPLOYMENT_PLAN_HEALTH.
 *  - local-runtime/storage-threshold-watcher.ts is real but exports
 *    nothing callable in-process and has its own real side-effect (a
 *    real webhook POST to an alert URL when its threshold is breached) —
 *    invoking it from Monitoring Runtime would violate the read-only,
 *    observe-only contract this Step requires. STORAGE_HEALTH is
 *    therefore honestly PARTIAL (a real source script exists; Monitoring
 *    does not invoke it this Step).
 *  - No real PROCESS_LEAK signal source exists anywhere in this repo —
 *    NOT_IMPLEMENTED.
 *  - No real API_HEALTH live-reachability source exists for this app's
 *    own routes (self-ping would require a new integration) — PARTIAL
 *    (route registration can be checked structurally; live latency
 *    cannot).
 *  - No real COST_ANOMALY baseline/detector exists — registry/
 *    infrastructure.json's real cost_summary is a single current figure,
 *    not a time series — PARTIAL (data exists, no anomaly evaluation).
 */
export type SignalType =
  | "RUNTIME_HEALTH" | "API_HEALTH" | "DATABASE_HEALTH" | "QUEUE_HEALTH" | "EXECUTION_HEALTH"
  | "ARTIFACT_INTEGRITY" | "REGISTRY_INTEGRITY" | "GOVERNANCE_HEALTH" | "BUILD_HEALTH" | "RELEASE_HEALTH"
  | "DEPLOYMENT_PLAN_HEALTH" | "STORAGE_HEALTH" | "CONNECTOR_HEALTH" | "EXTERNAL_PROVIDER_HEALTH"
  | "COST_ANOMALY" | "PROCESS_LEAK" | "DATA_FRESHNESS" | "BACKUP_HEALTH";

export type SignalTypeStatus = "IMPLEMENTED" | "PARTIAL" | "NOT_IMPLEMENTED" | "COMPATIBILITY_ONLY" | "UNKNOWN";

export interface SignalTypeDefinition {
  id: SignalType;
  displayName: string;
  description: string;
  source: string;
  producer: string;
  owner: string;
  scope: "RUNTIME" | "PROVIDER" | "REPO" | "FACTORY";
  collectionMode: "LIVE_QUERY" | "FILE_READ" | "DB_READ" | "SCRIPT_SOURCE_ONLY" | "NONE";
  evaluationMode: "EXACT_MATCH" | "THRESHOLD" | "STALE_TIMEOUT" | "MISSING_SOURCE" | "DURATION" | "NONE";
  expectedIntervalMs: number | null;
  staleAfterMs: number | null;
  severityPolicy: string;
  incidentPolicy: string;
  evidenceRequirements: string;
  status: SignalTypeStatus;
}

const MIN_5 = 5 * 60_000, MIN_10 = 10 * 60_000, HOUR_1 = 60 * 60_000, DAY_1 = 24 * HOUR_1, DAY_30 = 30 * DAY_1;

export const SIGNAL_TYPE_REGISTRY: Record<SignalType, SignalTypeDefinition> = {
  RUNTIME_HEALTH: {
    id: "RUNTIME_HEALTH", displayName: "Runtime Health",
    description: "Real, per-Runtime reachability — whether each of the 12 real Runtime nodes from globalFactoryRuntime.ts's Runtime Dependency Graph is REAL (file exists, module loads) — never a live process ping (no such mechanism exists).",
    source: "app/api/admin/ide/_lib/globalFactoryRuntime.ts#computeRuntimeDependencyGraph", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "RUNTIME", collectionMode: "FILE_READ", evaluationMode: "EXACT_MATCH", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "any NOT_IMPLEMENTED node among the 12 core Runtimes (excluding the 3 known-absent Monitoring/Incident/Recovery placeholders, which are expected) is DEGRADED", incidentPolicy: "a core Runtime file going missing opens a RUNTIME_FAILURE Incident",
    evidenceRequirements: "real file existence check", status: "IMPLEMENTED",
  },
  API_HEALTH: {
    id: "API_HEALTH", displayName: "API Health",
    description: "Structural check that every real API route this Factory declared (Steps 2-12) still exists as a file — never a live HTTP reachability probe (no self-ping mechanism exists in this repo).",
    source: "real app/api/admin/ide/**/route.ts file existence", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "REPO", collectionMode: "FILE_READ", evaluationMode: "EXACT_MATCH", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "a real, previously-declared route file missing is UNHEALTHY", incidentPolicy: "opens an API_FAILURE Incident",
    evidenceRequirements: "real file existence check", status: "PARTIAL",
  },
  DATABASE_HEALTH: {
    id: "DATABASE_HEALTH", displayName: "Database Health",
    description: "Real Supabase Auth/REST reachability, read from the real system_health_status table (service_key='supabase') that the real, deployed system-health-check Edge Function writes every 5 minutes.",
    source: "supabase table public.system_health_status (service_key='supabase')", producer: "monitoringRuntime.ts via services/supabase/queries.ts#supabaseAdmin", owner: "operations-center",
    scope: "PROVIDER", collectionMode: "DB_READ", evaluationMode: "STALE_TIMEOUT", expectedIntervalMs: MIN_5, staleAfterMs: MIN_10,
    severityPolicy: "status='degraded' is UNHEALTHY; a row older than staleAfterMs is STALE", incidentPolicy: "2+ consecutive_failures opens a DATABASE_FAILURE Incident",
    evidenceRequirements: "real row read, read-only, never written by this Runtime", status: "IMPLEMENTED",
  },
  QUEUE_HEALTH: {
    id: "QUEUE_HEALTH", displayName: "Queue Health",
    description: "Real, owner-scoped Job records from the Production Queue — counts REJECTED/stuck-RUNNING jobs.",
    source: "app/api/admin/ide/_lib/queueRuntime.ts#listJobs", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "RUNTIME", collectionMode: "LIVE_QUERY", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "any real REJECTED job is DEGRADED; a RUNNING job older than 1 hour with no finish is UNHEALTHY", incidentPolicy: "opens a QUEUE_STALL Incident",
    evidenceRequirements: "real, live Job records for the requesting owner", status: "IMPLEMENTED",
  },
  EXECUTION_HEALTH: {
    id: "EXECUTION_HEALTH", displayName: "Execution Health",
    description: "Real, owner-scoped Run records from the Execution Runtime — counts real non-zero exit codes and timeouts.",
    source: "app/api/admin/ide/_lib/executionRuntime.ts#listRuns", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "RUNTIME", collectionMode: "LIVE_QUERY", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "any real timeout/non-zero exit among recent runs is DEGRADED", incidentPolicy: "opens an EXECUTION_FAILURE Incident",
    evidenceRequirements: "real, live Run records for the requesting owner", status: "IMPLEMENTED",
  },
  ARTIFACT_INTEGRITY: {
    id: "ARTIFACT_INTEGRITY", displayName: "Artifact Integrity",
    description: "Real integrity findings (checksum mismatch, broken parent/child links, orphans, duplicates) from the already-existing Artifact Runtime integrity checker.",
    source: "app/api/admin/ide/_lib/artifactRuntime.ts#checkIntegrity", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "RUNTIME", collectionMode: "LIVE_QUERY", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "any real CHECKSUM_MISMATCH is UNHEALTHY; MISSING_PARENT/CHILD is DEGRADED", incidentPolicy: "opens an ARTIFACT_CORRUPTION Incident",
    evidenceRequirements: "real, live IntegrityFinding[] for the requesting owner", status: "IMPLEMENTED",
  },
  REGISTRY_INTEGRITY: {
    id: "REGISTRY_INTEGRITY", displayName: "Registry Integrity",
    description: "Real broken/unregistered module counts from the already-generated Architecture Book.",
    source: "registry/architecture-book.json#summary", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "REPO", collectionMode: "FILE_READ", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: DAY_1,
    severityPolicy: "broken>0 is UNHEALTHY; unregistered>0 is DEGRADED (per Step 10.5, a known, disclosed, honest gap for real duplicate files)", incidentPolicy: "broken>0 opens a REGISTRY_DRIFT Incident",
    evidenceRequirements: "real, generated file — staleAfterMs flags a report that hasn't been regenerated recently", status: "IMPLEMENTED",
  },
  GOVERNANCE_HEALTH: {
    id: "GOVERNANCE_HEALTH", displayName: "Governance Health",
    description: "Real rule coverage summary from the already-existing Governance Runtime.",
    source: "app/api/admin/ide/_lib/governanceRuntime.ts#computeCoverageSummary", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "REPO", collectionMode: "LIVE_QUERY", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "coveragePercent dropping below its own last-observed value is DEGRADED (relative regression, never an absolute guess)", incidentPolicy: "opens a GOVERNANCE_FAILURE Incident",
    evidenceRequirements: "real, live coverage summary", status: "IMPLEMENTED",
  },
  BUILD_HEALTH: {
    id: "BUILD_HEALTH", displayName: "Build Health",
    description: "Real, owner-scoped Build Run records — counts real FAILED/TIMED_OUT builds.",
    source: "app/api/admin/ide/_lib/buildRuntime.ts#listBuildRuns", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "FACTORY", collectionMode: "LIVE_QUERY", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "the most recent real Build Run being FAILED/TIMED_OUT is UNHEALTHY", incidentPolicy: "opens a BUILD_FAILURE Incident",
    evidenceRequirements: "real, live BuildRun records for the requesting owner", status: "IMPLEMENTED",
  },
  RELEASE_HEALTH: {
    id: "RELEASE_HEALTH", displayName: "Release Health",
    description: "Real, owner-scoped Release Run records — counts real BLOCKED/FAILED releases.",
    source: "app/api/admin/ide/_lib/releaseRuntime.ts#listReleaseRuns", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "FACTORY", collectionMode: "LIVE_QUERY", evaluationMode: "THRESHOLD", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "the most recent real Release Run being BLOCKED/FAILED is DEGRADED (BLOCKED is an honest, expected outcome per Step 10 findings, not automatically CRITICAL)", incidentPolicy: "repeated BLOCKED opens a RELEASE_FAILURE Incident",
    evidenceRequirements: "real, live ReleaseRun records for the requesting owner", status: "IMPLEMENTED",
  },
  DEPLOYMENT_PLAN_HEALTH: {
    id: "DEPLOYMENT_PLAN_HEALTH", displayName: "Deployment Plan Health",
    description: "Real, owner-scoped Deployment Plan records — every real plan is expected BLOCKED this Step (Rule 176); this signal reports that honestly, never as an error.",
    source: "app/api/admin/ide/_lib/deploymentRuntime.ts#listDeploymentPlans", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "FACTORY", collectionMode: "LIVE_QUERY", evaluationMode: "EXACT_MATCH", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "always INFO — a BLOCKED Deployment Plan this Step is expected, correct behavior, never a Monitoring finding", incidentPolicy: "never opens an Incident by itself",
    evidenceRequirements: "real, live DeploymentPlan records for the requesting owner", status: "IMPLEMENTED",
  },
  STORAGE_HEALTH: {
    id: "STORAGE_HEALTH", displayName: "Storage Health",
    description: "A real storage-threshold watcher script exists (local-runtime/storage-threshold-watcher.ts) but exports no callable function and has its own real side-effect (a webhook alert POST) — Monitoring Runtime does not invoke it this Step to preserve the read-only, observe-only contract.",
    source: "local-runtime/storage-threshold-watcher.ts (not invoked)", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "RUNTIME", collectionMode: "SCRIPT_SOURCE_ONLY", evaluationMode: "NONE", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "n/a — no live evaluation this Step", incidentPolicy: "n/a",
    evidenceRequirements: "none collected this Step — honestly PARTIAL", status: "PARTIAL",
  },
  CONNECTOR_HEALTH: {
    id: "CONNECTOR_HEALTH", displayName: "Connector Health",
    description: "Real pg_cron execution status for each real Supabase Edge Function connector, read from system_health_status rows with service_key starting 'cron:'.",
    source: "supabase table public.system_health_status (service_key like 'cron:%')", producer: "monitoringRuntime.ts via services/supabase/queries.ts#supabaseAdmin", owner: "operations-center",
    scope: "PROVIDER", collectionMode: "DB_READ", evaluationMode: "STALE_TIMEOUT", expectedIntervalMs: null, staleAfterMs: DAY_1,
    severityPolicy: "status='degraded' is DEGRADED; \"succeeded\" only proves pg_cron fired the trigger, never that the function's business logic succeeded (stated honestly, matching the real Edge Function's own comment)", incidentPolicy: "opens a CONNECTOR_FAILURE Incident",
    evidenceRequirements: "real row read, read-only", status: "IMPLEMENTED",
  },
  EXTERNAL_PROVIDER_HEALTH: {
    id: "EXTERNAL_PROVIDER_HEALTH", displayName: "External Provider Health",
    description: "Real Anthropic/LINE Messaging/Gmail reachability + token validity, read from system_health_status rows the real system-health-check Edge Function already writes.",
    source: "supabase table public.system_health_status (service_key in anthropic/line_messaging/gmail)", producer: "monitoringRuntime.ts via services/supabase/queries.ts#supabaseAdmin", owner: "operations-center",
    scope: "PROVIDER", collectionMode: "DB_READ", evaluationMode: "STALE_TIMEOUT", expectedIntervalMs: MIN_5, staleAfterMs: MIN_10,
    severityPolicy: "status='degraded' is UNHEALTHY; a real config_presence failure (missing credential) is DEGRADED, never UNKNOWN when a row exists", incidentPolicy: "opens a PROVIDER_OUTAGE Incident",
    evidenceRequirements: "real row read, read-only — a missing row for a provider is honestly UNKNOWN, never assumed HEALTHY", status: "IMPLEMENTED",
  },
  COST_ANOMALY: {
    id: "COST_ANOMALY", displayName: "Cost Anomaly",
    description: "registry/infrastructure.json's real cost_summary exists (monthly_thb/yearly_thb) but is a single current figure, not a time series — no real anomaly baseline or detector exists.",
    source: "registry/infrastructure.json#cost_summary", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "PROVIDER", collectionMode: "FILE_READ", evaluationMode: "NONE", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "n/a — no real anomaly detection this Step", incidentPolicy: "opens a COST_ANOMALY Incident only if a future baseline is built",
    evidenceRequirements: "real current figure reported as data only, never classified HEALTHY/UNHEALTHY", status: "PARTIAL",
  },
  PROCESS_LEAK: {
    id: "PROCESS_LEAK", displayName: "Process Leak",
    description: "No real, live process-tracking mechanism exists anywhere in this repo's Runtime layer (process leak checks in this Factory's own verification sweeps are manual `ps aux` commands run by the operator, never a queryable Runtime signal).",
    source: "none", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "RUNTIME", collectionMode: "NONE", evaluationMode: "NONE", expectedIntervalMs: null, staleAfterMs: null,
    severityPolicy: "n/a", incidentPolicy: "n/a",
    evidenceRequirements: "none — honestly NOT_IMPLEMENTED", status: "NOT_IMPLEMENTED",
  },
  DATA_FRESHNESS: {
    id: "DATA_FRESHNESS", displayName: "Data Freshness",
    description: "Real mtime-based staleness check across the Factory's own generated registry reports (architecture-book/governance-summary/factory-summary/global-factory-report/factory-completion-report).",
    source: "real fs.statSync mtime of registry/*.json report files", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "REPO", collectionMode: "FILE_READ", evaluationMode: "STALE_TIMEOUT", expectedIntervalMs: null, staleAfterMs: DAY_1,
    severityPolicy: "a report older than staleAfterMs is STALE", incidentPolicy: "opens a DATA_STALE Incident",
    evidenceRequirements: "real fs mtime read", status: "IMPLEMENTED",
  },
  BACKUP_HEALTH: {
    id: "BACKUP_HEALTH", displayName: "Backup Health",
    description: "Real backup manifest read from backups/*/_manifest.json (scripts/backup.ts's real output) — reports the real, latest backup's age and real per-table success/error counts. Never invokes a backup.",
    source: "real backups/*/_manifest.json files + registry/infrastructure.json#backup", producer: "monitoringRuntime.ts", owner: "operations-center",
    scope: "REPO", collectionMode: "FILE_READ", evaluationMode: "STALE_TIMEOUT", expectedIntervalMs: null, staleAfterMs: DAY_30,
    severityPolicy: "no real backup found is UNHEALTHY; a real backup older than staleAfterMs is STALE; a real backup with error_details is DEGRADED", incidentPolicy: "opens a BACKUP_FAILURE Incident",
    evidenceRequirements: "real, existing _manifest.json content", status: "IMPLEMENTED",
  },
};

export function listSignalTypes(): SignalTypeDefinition[] {
  return Object.values(SIGNAL_TYPE_REGISTRY);
}
export function getSignalTypeDefinition(type: string): SignalTypeDefinition | undefined {
  return SIGNAL_TYPE_REGISTRY[type as SignalType];
}
