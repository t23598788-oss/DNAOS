import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PipelineRecordV1 } from "../work-production-pipeline/types";
import { dataPath, repoRoot } from "./host-runtime";
import type { ProductionCheckpointV1, RemoteProductionDiscoveryV1, WorkCompletionReportV1, WorkStateFinalizationV1 } from "./types";

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as T); } catch { /* skip */ }
  }
  return rows;
}

function rewrite(file: string, rows: readonly unknown[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

let checkpoints: ProductionCheckpointV1[] | null = null;
let reports: WorkCompletionReportV1[] | null = null;
let catchups: string[] | null = null;
let emitted: string[] | null = null;
let finalizations: WorkStateFinalizationV1[] | null = null;
let lastDiscovery: RemoteProductionDiscoveryV1 | null = null;
let githubEnvProbe: { permission: string; names: readonly string[] } | null = null;
let targetEnablement: { target_id: string; owner_enabled: boolean }[] | null = null;
let railwayDeployments: Record<string, unknown>[] | null = null;
let deployCapability: { mutation_runtime_verified: boolean } | null = null;

export function resetCheckpointMemory(): void {
  checkpoints = null;
  reports = null;
  catchups = null;
  emitted = null;
  finalizations = null;
  lastDiscovery = null;
  githubEnvProbe = null;
  targetEnablement = null;
  railwayDeployments = null;
  deployCapability = null;
}

export function listCheckpoints(): ProductionCheckpointV1[] {
  if (checkpoints === null) checkpoints = readJsonl<ProductionCheckpointV1>(dataPath("checkpoints.jsonl", "PRODUCTION_CHECKPOINT_LOG"));
  return checkpoints;
}

export function persistCheckpointsForWork(work_id: string, rows: readonly ProductionCheckpointV1[]): void {
  const next = listCheckpoints().filter((row) => row.work_id !== work_id);
  next.push(...rows);
  checkpoints = next;
  rewrite(dataPath("checkpoints.jsonl", "PRODUCTION_CHECKPOINT_LOG"), next);
}

export function listCompletionReports(): WorkCompletionReportV1[] {
  if (reports === null) reports = readJsonl<WorkCompletionReportV1>(dataPath("completion-reports.jsonl", "PRODUCTION_COMPLETION_REPORT_LOG"));
  return reports;
}

export function persistCompletionReport(row: WorkCompletionReportV1): void {
  const next = listCompletionReports().filter((item) => item.work_id !== row.work_id);
  next.push(row);
  reports = next;
  rewrite(dataPath("completion-reports.jsonl", "PRODUCTION_COMPLETION_REPORT_LOG"), next);
}

export function listCatchupKeys(): string[] {
  if (catchups === null) {
    catchups = readJsonl<{ key: string }>(dataPath("catchup.jsonl", "PRODUCTION_CHECKPOINT_CATCHUP_LOG")).map((row) => row.key);
  }
  return catchups;
}

export function rememberCatchup(key: string): boolean {
  const rows = listCatchupKeys();
  if (rows.includes(key)) return true;
  rows.push(key);
  catchups = rows;
  rewrite(dataPath("catchup.jsonl", "PRODUCTION_CHECKPOINT_CATCHUP_LOG"), rows.map((item) => ({ key: item })));
  return false;
}

export function listEmittedKeys(): string[] {
  if (emitted === null) {
    emitted = readJsonl<{ key: string }>(dataPath("emitted.jsonl", "PRODUCTION_CHECKPOINT_EMITTED_LOG")).map((row) => row.key);
  }
  return emitted;
}

export function rememberEmitted(key: string): boolean {
  const rows = listEmittedKeys();
  if (rows.includes(key)) return true;
  rows.push(key);
  emitted = rows;
  rewrite(dataPath("emitted.jsonl", "PRODUCTION_CHECKPOINT_EMITTED_LOG"), rows.map((item) => ({ key: item })));
  return false;
}

export function listFinalizations(): WorkStateFinalizationV1[] {
  if (finalizations === null) {
    finalizations = readJsonl<WorkStateFinalizationV1>(dataPath("finalizations.jsonl", "PRODUCTION_FINALIZATION_LOG"));
  }
  return finalizations;
}

export function persistFinalization(row: WorkStateFinalizationV1): void {
  const next = listFinalizations().filter((item) => item.work_id !== row.work_id);
  next.push(row);
  finalizations = next;
  rewrite(dataPath("finalizations.jsonl", "PRODUCTION_FINALIZATION_LOG"), next);
}

export function persistRemoteProductionDiscovery(row: RemoteProductionDiscoveryV1): void {
  lastDiscovery = row;
  rewrite(dataPath("remote-production-discovery.jsonl", "PRODUCTION_REMOTE_DISCOVERY_LOG"), [row]);
}

export function lastRemoteProductionDiscovery(): RemoteProductionDiscoveryV1 | null {
  if (lastDiscovery) return lastDiscovery;
  const rows = readJsonl<RemoteProductionDiscoveryV1>(dataPath("remote-production-discovery.jsonl", "PRODUCTION_REMOTE_DISCOVERY_LOG"));
  lastDiscovery = rows[rows.length - 1] ?? null;
  return lastDiscovery;
}

export function rememberGithubEnvironmentProbe(row: { permission: string; names: readonly string[] }): void {
  githubEnvProbe = row;
}

export function lastGithubEnvironmentProbe(): { permission: string; names: readonly string[] } | null {
  return githubEnvProbe;
}

export function persistRemoteTargetEnablement(row: { target_id: string; owner_enabled: boolean }): void {
  const rows = listRemoteTargetEnablement().filter((item) => item.target_id !== row.target_id);
  rows.push(row);
  targetEnablement = rows;
  rewrite(dataPath("remote-target-enablement.jsonl", "PRODUCTION_REMOTE_TARGET_ENABLEMENT_LOG"), rows);
}

export function listRemoteTargetEnablement(): { target_id: string; owner_enabled: boolean }[] {
  if (targetEnablement === null) {
    targetEnablement = readJsonl<{ target_id: string; owner_enabled: boolean }>(dataPath("remote-target-enablement.jsonl", "PRODUCTION_REMOTE_TARGET_ENABLEMENT_LOG"));
  }
  return targetEnablement;
}

export function isRemoteTargetOwnerEnabled(target_id: string): boolean {
  const rows = listRemoteTargetEnablement().filter((row) => row.target_id === target_id);
  return rows[rows.length - 1]?.owner_enabled === true;
}

export function persistRailwayDeployment(row: Record<string, unknown>): void {
  const next = listRailwayDeployments();
  next.push(row);
  railwayDeployments = next;
  rewrite(dataPath("railway-deployments.jsonl", "PRODUCTION_RAILWAY_DEPLOYMENT_LOG"), next);
}

export function listRailwayDeployments(): Record<string, unknown>[] {
  if (railwayDeployments === null) {
    railwayDeployments = readJsonl<Record<string, unknown>>(dataPath("railway-deployments.jsonl", "PRODUCTION_RAILWAY_DEPLOYMENT_LOG"));
  }
  return railwayDeployments;
}

export function persistCanonicalLineageRepair(row: Record<string, unknown>): void {
  rewrite(dataPath("canonical-lineage-repair.jsonl", "PRODUCTION_CANONICAL_LINEAGE_REPAIR_LOG"), [row]);
}

export function lastCanonicalLineageRepair(): Record<string, unknown> | null {
  const rows = readJsonl<Record<string, unknown>>(dataPath("canonical-lineage-repair.jsonl", "PRODUCTION_CANONICAL_LINEAGE_REPAIR_LOG"));
  return rows[rows.length - 1] ?? null;
}

export function persistRailwayDeployCapability(row: { mutation_runtime_verified: boolean }): void {
  deployCapability = row;
  rewrite(dataPath("railway-deploy-capability.jsonl", "PRODUCTION_RAILWAY_DEPLOY_CAPABILITY_LOG"), [row]);
}

export function lastRailwayDeployCapability(): { mutation_runtime_verified: boolean } | null {
  if (deployCapability) return deployCapability;
  const rows = readJsonl<{ mutation_runtime_verified: boolean }>(dataPath("railway-deploy-capability.jsonl", "PRODUCTION_RAILWAY_DEPLOY_CAPABILITY_LOG"));
  deployCapability = rows[rows.length - 1] ?? null;
  return deployCapability;
}

export function listDiskCatalogPipelines(): PipelineRecordV1[] {
  const dir = join(repoRoot(), "control/work-production-pipeline/data");
  if (!existsSync(dir)) return [];
  const map = new Map<string, PipelineRecordV1>();
  for (const name of readdirSync(dir)) {
    if (!/^(pipeline|cinfo-pipe-.+)\.jsonl$/.test(name)) continue;
    for (const row of readJsonl<PipelineRecordV1>(join(dir, name))) {
      if (row?.schema === "DNA_OS_WORK_PRODUCTION_PIPELINE_V1" && row.work_id) map.set(row.work_id, row);
    }
  }
  return [...map.values()];
}
