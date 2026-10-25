import { collectSignalWith, type CollectResult, type SignalRecord, type MonitoringStatus } from "./monitoringSignals";
import { collectDatabaseHealth, collectConnectorHealth, collectExternalProviderHealth } from "./providerHealthCollectors";
/**
 * Monitoring Runtime (owner, 2026-08-08, Software Factory Step 12).
 * Observe-only — never mutates production, never guesses HEALTHY, never
 * lets AI decide a status. Every collector below reads a REAL, already-
 * existing source (Steps 2-11's Runtimes, registry/*.json, or the real
 * system_health_status table a real, already-deployed Edge Function
 * writes) — no fabricated data, no new Store.
 *
 * Reuse confirmed by direct inspection (see monitoringRegistry.ts's own
 * header for the full Phase 1 investigation): executionRuntime.ts#listRuns,
 * queueRuntime.ts#listJobs, buildRuntime.ts#listBuildRuns,
 * releaseRuntime.ts#listReleaseRuns, deploymentRuntime.ts#listDeploymentPlans,
 * artifactRuntime.ts#checkIntegrity, governanceRuntime.ts#computeCoverageSummary
 * are all called directly, never re-implemented. services/supabase/queries.ts#
 * supabaseAdmin() is the SAME real, already-configured client
 * app/api/admin/infrastructure/route.ts already uses — reused here
 * strictly read-only (.select() only, grep-verifiable: no .insert/.update/
 * .delete/.upsert call anywhere in this file).
 */
import { createHash } from "crypto";
import { readFileSync, existsSync, statSync, readdirSync } from "fs";

import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { SIGNAL_TYPE_REGISTRY, type SignalType } from "./monitoringRegistry";
import { listRuns } from "./executionRuntime";
import { listJobs } from "./queueRuntime";
import { listBuildRuns } from "./buildRuntime";
import { listReleaseRuns } from "./releaseRuntime";
import { listDeploymentPlans } from "./deploymentRuntime";
import { checkIntegrity } from "./artifactRuntime";
import { computeCoverageSummary } from "./governanceRuntime";
import { computeRuntimeDependencyGraph } from "./runtimeDependencyGraph";

const ROOT = WORKSPACE_ROOT;
const DAY_MS = 24 * 60 * 60_000;
function sha256Hex(data: string): string { return createHash("sha256").update(data).digest("hex"); }
function safeReadJson<T>(rel: string): T | null {
  try { return JSON.parse(readFileSync(path.join(ROOT, rel), "utf-8")) as T; } catch { return null; }
}
const lastGovernanceCoverage = new Map<string, number>();

async function collectRuntimeHealth(): Promise<CollectResult> {
  const graph = computeRuntimeDependencyGraph();
  const coreIds = ["executionRuntime", "queueRuntime", "inspectionRuntime", "governanceRuntime", "artifactRuntime", "changeSetRuntime", "testRuntime", "buildRuntime", "releaseRuntime", "factoryCompletionRuntime", "deploymentRuntime", "globalFactoryRuntime", "monitoringRuntime", "incidentRuntime", "recoveryRuntime"];
  const missing = graph.nodes.filter((n) => coreIds.includes(n.id) && n.status === "NOT_IMPLEMENTED");
  return {
    status: missing.length === 0 ? "HEALTHY" : "UNHEALTHY", severity: missing.length === 0 ? "INFO" : "HIGH",
    reason: missing.length === 0 ? `all ${coreIds.length} real core Runtime files present` : `${missing.length} real core Runtime file(s) missing: ${missing.map((m) => m.id).join(", ")}`,
    normalizedValue: { total: coreIds.length, missing: missing.map((m) => m.id) }, rawReference: "globalFactoryRuntime.ts#computeRuntimeDependencyGraph",
  };
}

async function collectApiHealth(): Promise<CollectResult> {
  const criticalRoutes = [
    "app/api/admin/ide/build/runs/route.ts", "app/api/admin/ide/release/runs/route.ts",
    "app/api/admin/ide/deployment/plans/route.ts", "app/api/admin/ide/global-factory/route.ts",
    "app/api/admin/ide/factory-completion/route.ts",
  ];
  const missing = criticalRoutes.filter((r) => !existsSync(path.join(ROOT, r)));
  return {
    status: missing.length === 0 ? "HEALTHY" : "UNHEALTHY", severity: missing.length === 0 ? "INFO" : "MEDIUM",
    reason: missing.length === 0 ? `all ${criticalRoutes.length} real critical route files present (structural check only — no live reachability probe exists)` : `${missing.length} real route file(s) missing: ${missing.join(", ")}`,
    normalizedValue: { total: criticalRoutes.length, missing }, rawReference: "real app/api/admin/ide/**/route.ts file existence",
  };
}

async function collectQueueHealth(ownerId: string): Promise<CollectResult> {
  const jobs = listJobs(ownerId);
  const rejected = jobs.filter((j) => j.status === "REJECTED");
  const stuckRunning = jobs.filter((j) => j.status === "RUNNING" && j.startedAt && Date.now() - new Date(j.startedAt).getTime() > 60 * 60_000);
  const status: MonitoringStatus = jobs.length === 0 ? "UNKNOWN" : stuckRunning.length > 0 ? "UNHEALTHY" : rejected.length > 0 ? "DEGRADED" : "HEALTHY";
  return {
    status, severity: status === "UNHEALTHY" ? "HIGH" : status === "DEGRADED" ? "LOW" : "INFO",
    reason: jobs.length === 0 ? "no real Job records for this owner yet — honestly UNKNOWN" : `${rejected.length} real REJECTED, ${stuckRunning.length} real stuck-RUNNING of ${jobs.length} real jobs`,
    normalizedValue: { total: jobs.length, rejected: rejected.length, stuckRunning: stuckRunning.length }, rawReference: "queueRuntime.ts#listJobs", relatedRuntime: "queueRuntime",
  };
}

async function collectExecutionHealth(ownerId: string): Promise<CollectResult> {
  const runs = listRuns(ownerId);
  const failed = runs.filter((r) => r.timedOut || (r.exitCode !== null && r.exitCode !== 0));
  const status: MonitoringStatus = runs.length === 0 ? "UNKNOWN" : failed.length > 0 ? "DEGRADED" : "HEALTHY";
  return {
    status, severity: status === "DEGRADED" ? "LOW" : "INFO",
    reason: runs.length === 0 ? "no real Run records for this owner yet — honestly UNKNOWN" : `${failed.length} real failed/timed-out of ${runs.length} real runs`,
    normalizedValue: { total: runs.length, failed: failed.length }, rawReference: "executionRuntime.ts#listRuns", relatedRuntime: "executionRuntime",
  };
}

async function collectArtifactIntegrity(ownerId: string): Promise<CollectResult> {
  const findings = checkIntegrity(ownerId);
  const mismatches = findings.filter((f) => f.kind === "CHECKSUM_MISMATCH");
  const broken = findings.filter((f) => f.kind === "MISSING_PARENT" || f.kind === "MISSING_CHILD");
  const status: MonitoringStatus = mismatches.length > 0 ? "UNHEALTHY" : broken.length > 0 ? "DEGRADED" : "HEALTHY";
  return {
    status, severity: mismatches.length > 0 ? "HIGH" : broken.length > 0 ? "MEDIUM" : "INFO",
    reason: `${findings.length} real integrity finding(s): ${mismatches.length} checksum mismatch, ${broken.length} broken link`,
    normalizedValue: { total: findings.length, mismatches: mismatches.length, broken: broken.length }, rawReference: "artifactRuntime.ts#checkIntegrity", relatedRuntime: "artifactRuntime",
  };
}

async function collectRegistryIntegrity(): Promise<CollectResult> {
  const book = safeReadJson<{ summary?: { broken?: number; unregistered?: number; total?: number } }>("registry/architecture-book.json");
  const s = book?.summary;
  if (!s) return { status: "MISSING", severity: "MEDIUM", reason: "registry/architecture-book.json missing or unreadable", normalizedValue: null, rawReference: "registry/architecture-book.json" };
  const status: MonitoringStatus = (s.broken ?? 0) > 0 ? "UNHEALTHY" : (s.unregistered ?? 0) > 0 ? "DEGRADED" : "HEALTHY";
  return {
    status, severity: status === "UNHEALTHY" ? "HIGH" : status === "DEGRADED" ? "LOW" : "INFO",
    reason: `real summary: broken=${s.broken ?? 0}, unregistered=${s.unregistered ?? 0} of ${s.total ?? "?"} real modules`,
    normalizedValue: s, rawReference: "registry/architecture-book.json#summary",
  };
}

async function collectGovernanceHealth(ownerId: string): Promise<CollectResult> {
  const summary = computeCoverageSummary();
  const prior = lastGovernanceCoverage.get(ownerId);
  lastGovernanceCoverage.set(ownerId, summary.coveragePercent);
  const regressed = prior !== undefined && summary.coveragePercent < prior;
  return {
    status: regressed ? "DEGRADED" : "HEALTHY", severity: regressed ? "MEDIUM" : "INFO",
    reason: regressed ? `real coveragePercent dropped from ${prior}% to ${summary.coveragePercent}%` : `real coveragePercent: ${summary.coveragePercent}%${prior === undefined ? " (first observation, no baseline yet)" : ""}`,
    normalizedValue: summary, rawReference: "governanceRuntime.ts#computeCoverageSummary", relatedRuntime: "governanceRuntime",
  };
}

async function collectBuildHealth(ownerId: string): Promise<CollectResult> {
  const runs = listBuildRuns(ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (runs.length === 0) return { status: "UNKNOWN", severity: "INFO", reason: "no real Build Run for this owner yet", normalizedValue: null, rawReference: "buildRuntime.ts#listBuildRuns", relatedRuntime: "buildRuntime" };
  const latest = runs[0];
  const bad = latest.status === "FAILED" || latest.status === "TIMED_OUT";
  return {
    status: bad ? "UNHEALTHY" : "HEALTHY", severity: bad ? "MEDIUM" : "INFO",
    reason: `real, most recent Build Run status: ${latest.status}`, normalizedValue: { buildRunId: latest.buildRunId, status: latest.status },
    rawReference: "buildRuntime.ts#listBuildRuns", relatedRuntime: "buildRuntime",
  };
}

async function collectReleaseHealth(ownerId: string): Promise<CollectResult> {
  const runs = listReleaseRuns(ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (runs.length === 0) return { status: "UNKNOWN", severity: "INFO", reason: "no real Release Run for this owner yet", normalizedValue: null, rawReference: "releaseRuntime.ts#listReleaseRuns", relatedRuntime: "releaseRuntime" };
  const latest = runs[0];
  const bad = latest.status === "BLOCKED" || latest.status === "FAILED";
  return {
    status: bad ? "DEGRADED" : "HEALTHY", severity: "LOW",
    reason: `real, most recent Release Run status: ${latest.status} (BLOCKED is an honest, expected outcome, not a critical failure)`,
    normalizedValue: { releaseRunId: latest.releaseRunId, status: latest.status }, rawReference: "releaseRuntime.ts#listReleaseRuns", relatedRuntime: "releaseRuntime",
  };
}

async function collectDeploymentPlanHealth(ownerId: string): Promise<CollectResult> {
  const plans = listDeploymentPlans(ownerId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (plans.length === 0) return { status: "UNKNOWN", severity: "INFO", reason: "no real Deployment Plan for this owner yet", normalizedValue: null, rawReference: "deploymentRuntime.ts#listDeploymentPlans", relatedRuntime: "deploymentRuntime" };
  const latest = plans[0];
  return {
    status: "HEALTHY", severity: "INFO", reason: `real, most recent Deployment Plan status: ${latest.status} (BLOCKED is the expected, correct terminal status this Step — Rule 176)`,
    normalizedValue: { deploymentPlanId: latest.deploymentPlanId, status: latest.status }, rawReference: "deploymentRuntime.ts#listDeploymentPlans",
    relatedRuntime: "deploymentRuntime", relatedDeploymentPlan: latest.deploymentPlanId,
  };
}

async function collectStorageHealth(): Promise<CollectResult> {
  return {
    status: "NOT_IMPLEMENTED", severity: "INFO",
    reason: "local-runtime/storage-threshold-watcher.ts is a real source but is not invoked by Monitoring Runtime this Step (it has its own real webhook side-effect, which would violate the read-only observe contract)",
    normalizedValue: null, rawReference: "local-runtime/storage-threshold-watcher.ts (not invoked)",
  };
}

async function collectCostAnomaly(): Promise<CollectResult> {
  const infra = safeReadJson<{ cost_summary?: { monthly_thb?: number; yearly_thb?: number } }>("registry/infrastructure.json");
  if (!infra?.cost_summary) return { status: "MISSING", severity: "LOW", reason: "registry/infrastructure.json#cost_summary missing", normalizedValue: null, rawReference: "registry/infrastructure.json#cost_summary" };
  return {
    status: "UNKNOWN", severity: "INFO", reason: "real current cost figure exists, but no anomaly baseline/time-series exists to compare against — honestly UNKNOWN, never classified HEALTHY",
    normalizedValue: infra.cost_summary, rawReference: "registry/infrastructure.json#cost_summary",
  };
}

async function collectProcessLeak(): Promise<CollectResult> {
  return { status: "NOT_IMPLEMENTED", severity: "INFO", reason: "no real, live process-tracking mechanism exists in this repo's Runtime layer", normalizedValue: null, rawReference: "none" };
}

async function collectDataFreshness(): Promise<CollectResult> {
  const files = ["registry/architecture-book.json", "registry/governance-summary.json", "registry/factory-summary.json", "registry/global-factory-report.json", "registry/factory-completion-report.json"];
  const staleAfter = SIGNAL_TYPE_REGISTRY.DATA_FRESHNESS.staleAfterMs!;
  const ages: { file: string; ageMs: number | null }[] = files.map((f) => {
    try { return { file: f, ageMs: Date.now() - statSync(path.join(ROOT, f)).mtimeMs }; } catch { return { file: f, ageMs: null }; }
  });
  const missing = ages.filter((a) => a.ageMs === null);
  const stale = ages.filter((a) => a.ageMs !== null && a.ageMs > staleAfter);
  const status: MonitoringStatus = missing.length > 0 ? "MISSING" : stale.length > 0 ? "STALE" : "HEALTHY";
  return {
    status, severity: status === "MISSING" ? "MEDIUM" : status === "STALE" ? "LOW" : "INFO",
    reason: missing.length > 0 ? `${missing.length} real report file(s) missing: ${missing.map((m) => m.file).join(", ")}` : stale.length > 0 ? `${stale.length} real report file(s) stale: ${stale.map((s) => s.file).join(", ")}` : "all real report files fresh",
    normalizedValue: ages, rawReference: "real fs.statSync mtime of registry/*.json report files",
  };
}

async function collectBackupHealth(): Promise<CollectResult> {
  const backupsDir = path.join(ROOT, "backups");
  if (!existsSync(backupsDir)) return { status: "UNHEALTHY", severity: "HIGH", reason: "no real backups/ directory exists", normalizedValue: null, rawReference: "backups/" };
  const dirs = readdirSync(backupsDir).filter((d) => existsSync(path.join(backupsDir, d, "_manifest.json"))).sort().reverse();
  if (dirs.length === 0) return { status: "UNHEALTHY", severity: "HIGH", reason: "no real backup manifest found", normalizedValue: null, rawReference: "backups/*/_manifest.json" };
  const latestDir = dirs[0];
  const manifest = safeReadJson<{ created_at: string; tables: number; success: number; errors: number; total_rows: number; error_details?: string[] }>(`backups/${latestDir}/_manifest.json`);
  if (!manifest) return { status: "UNKNOWN", severity: "MEDIUM", reason: "real manifest file exists but could not be parsed", normalizedValue: null, rawReference: `backups/${latestDir}/_manifest.json` };
  const ageMs = Date.now() - new Date(manifest.created_at).getTime();
  const staleAfter = SIGNAL_TYPE_REGISTRY.BACKUP_HEALTH.staleAfterMs!;
  const status: MonitoringStatus = ageMs > staleAfter ? "STALE" : manifest.errors > 0 ? "DEGRADED" : "HEALTHY";
  return {
    status, severity: status === "STALE" ? "MEDIUM" : status === "DEGRADED" ? "LOW" : "INFO",
    reason: `real latest backup ${latestDir}: ${manifest.success}/${manifest.tables} tables, ${manifest.total_rows} rows, ${manifest.errors} error(s), age ${Math.round(ageMs / DAY_MS)} day(s)`,
    normalizedValue: manifest, rawReference: `backups/${latestDir}/_manifest.json`,
  };
}

const COLLECTORS: Record<SignalType, (ownerId: string) => Promise<CollectResult>> = {
  RUNTIME_HEALTH: () => collectRuntimeHealth(),
  API_HEALTH: () => collectApiHealth(),
  DATABASE_HEALTH: () => collectDatabaseHealth(),
  QUEUE_HEALTH: (o) => collectQueueHealth(o),
  EXECUTION_HEALTH: (o) => collectExecutionHealth(o),
  ARTIFACT_INTEGRITY: (o) => collectArtifactIntegrity(o),
  REGISTRY_INTEGRITY: () => collectRegistryIntegrity(),
  GOVERNANCE_HEALTH: (o) => collectGovernanceHealth(o),
  BUILD_HEALTH: (o) => collectBuildHealth(o),
  RELEASE_HEALTH: (o) => collectReleaseHealth(o),
  DEPLOYMENT_PLAN_HEALTH: (o) => collectDeploymentPlanHealth(o),
  STORAGE_HEALTH: () => collectStorageHealth(),
  CONNECTOR_HEALTH: () => collectConnectorHealth(),
  EXTERNAL_PROVIDER_HEALTH: () => collectExternalProviderHealth(),
  COST_ANOMALY: () => collectCostAnomaly(),
  PROCESS_LEAK: () => collectProcessLeak(),
  DATA_FRESHNESS: () => collectDataFreshness(),
  BACKUP_HEALTH: () => collectBackupHealth(),
};

export async function collectAllSignals(ownerId: string, actor: string): Promise<SignalRecord[]> {
  const types = Object.keys(SIGNAL_TYPE_REGISTRY) as SignalType[];
  const out: SignalRecord[] = [];
  for (const t of types) out.push(await collectSignal(t, ownerId, actor));
  return out;
}

export { MonitoringError, getSignal, listSignals, listMonitoringEvents, computeMonitoringSummary, __debugSignalCount } from "./monitoringSignals";
export type { MonitoringStatus, Severity, SignalRecord, MonitoringEvent, MonitoringSummary } from "./monitoringSignals";

export function collectSignal(signalType: SignalType, ownerId: string, actor: string): Promise<SignalRecord> {
  return collectSignalWith(signalType, ownerId, actor, COLLECTORS[signalType]);
}
