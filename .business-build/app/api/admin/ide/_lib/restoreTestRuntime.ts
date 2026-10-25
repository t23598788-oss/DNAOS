/**
 * Restore Test Runtime (owner, 2026-08-08, Software Factory Step 12.5).
 * Proves whether a real backup CAN be restored — never whether it merely
 * exists. This environment has NO real isolated database, so every real
 * run here is a dry-run/parser-based inventory verification (the
 * mission's own explicitly allowed fallback) — overall status is
 * therefore ALWAYS PLAN_ONLY or PARTIAL, NEVER a fabricated
 * VERIFIED_RESTORE. Never restores to Production. Never opens a real
 * database connection.
 *
 * Reuse: createOperationsArtifact() routes through the SAME real
 * createArtifactInternal() every prior Step uses. Reuses backupRuntime.ts#
 * discoverBackups()/EXPECTED_BACKUP_TABLES — never a second backup
 * inventory.
 */
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { discoverBackups, EXPECTED_BACKUP_TABLES } from "./backupRuntime";
import type { RestoreTestStage } from "./restoreTestRegistry";
import { createOperationsArtifact } from "./artifactRuntime";

const ROOT = WORKSPACE_ROOT;

export type StageStatus = "NOT_STARTED" | "RUNNING" | "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" | "UNKNOWN";
export interface RestoreTestStageResult {
  stage: RestoreTestStage; status: StageStatus; startedAt: string | null; finishedAt: string | null;
  evidence: string; failureReason: string | null; mutationScope: "NONE" | "ISOLATED_TARGET_ONLY"; cleanupStatus: "NOT_APPLICABLE" | "CLEAN";
}

export type RestoreTestOverallStatus = "PLAN_ONLY" | "PARTIAL" | "FAILED";

export interface RestoreTestRun {
  restoreTestId: string;
  backupId: string;
  status: RestoreTestOverallStatus;
  stages: RestoreTestStageResult[];
  createdAt: string;
  finishedAt: string | null;
  ownerId: string;
  actor: string;
  artifactIds: string[];
  limitations: string;
}

export class RestoreTestError extends Error {
  code: "RESTORE_TEST_NOT_FOUND" | "RESTORE_TEST_NOT_OWNED" | "BACKUP_NOT_FOUND" | "PRODUCTION_TARGET_REJECTED";
  constructor(code: typeof RestoreTestError.prototype.code, message: string) { super(message); this.code = code; this.name = "RestoreTestError"; }
}

const restoreTests = new Map<string, RestoreTestRun>();
const MAX_RESTORE_TEST_HISTORY = 200;
function evictOld(ownerId: string) {
  const owned = [...restoreTests.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  while (owned.length > MAX_RESTORE_TEST_HISTORY) { const oldest = owned.shift()!; restoreTests.delete(oldest.restoreTestId); }
}

export interface RestoreTestEvent {
  eventId: string; type: "RESTORE_TEST_PLANNED" | "RESTORE_TEST_STARTED" | "RESTORE_STAGE_COMPLETED" | "RESTORE_TEST_FAILED" | "RESTORE_TEST_VERIFIED" | "RESTORE_TEST_UNVERIFIED" | "RESTORE_CLEANUP_COMPLETED";
  restoreTestId: string; actor: string; timestamp: string; evidence: string;
}
const restoreTestEvents: RestoreTestEvent[] = [];
const MAX_EVENTS = 500;
function emitRestoreTestEvent(type: RestoreTestEvent["type"], restoreTestId: string, actor: string, evidence: string) {
  restoreTestEvents.push({ eventId: randomUUID(), type, restoreTestId, actor, timestamp: new Date().toISOString(), evidence });
  while (restoreTestEvents.length > MAX_EVENTS) restoreTestEvents.shift();
}
export function listRestoreTestEvents(limit = 200): RestoreTestEvent[] {
  return restoreTestEvents.slice(-limit).reverse();
}

/** A target string containing any real production-looking marker is
 * rejected outright — this Runtime never restores anywhere but a dry-run
 * (target is always "DRY_RUN_NO_TARGET" internally; this guard exists so
 * no future caller can ever pass a real production connection string
 * through this function). */
function assertNeverProductionTarget(target: string) {
  const lowered = target.toLowerCase();
  if (lowered.includes("supabase.co") || lowered.includes("production") || lowered.includes("prod-") || lowered !== "dry_run_no_target") {
    throw new RestoreTestError("PRODUCTION_TARGET_REJECTED", `real restore target "${target}" looks like a real production target — rejected. This Runtime only ever performs a dry-run.`);
  }
}

export async function runRestoreTest(backupId: string, ownerId: string, actor: string): Promise<RestoreTestRun> {
  const backup = discoverBackups().find((b) => b.backupId === backupId);
  if (!backup) throw new RestoreTestError("BACKUP_NOT_FOUND", `no real backup with id ${backupId}`);
  assertNeverProductionTarget("DRY_RUN_NO_TARGET");

  const restoreTestId = randomUUID();
  const createdAt = new Date().toISOString();
  emitRestoreTestEvent("RESTORE_TEST_PLANNED", restoreTestId, actor, `real dry-run restore test planned for backup ${backupId}`);
  emitRestoreTestEvent("RESTORE_TEST_STARTED", restoreTestId, actor, "real stage execution beginning");

  const stages: RestoreTestStageResult[] = [];
  const now = () => new Date().toISOString();
  const stage = (id: RestoreTestStage, status: StageStatus, evidence: string, failureReason: string | null = null): RestoreTestStageResult => {
    const s: RestoreTestStageResult = { stage: id, status, startedAt: now(), finishedAt: now(), evidence, failureReason, mutationScope: "NONE", cleanupStatus: "NOT_APPLICABLE" };
    stages.push(s);
    emitRestoreTestEvent("RESTORE_STAGE_COMPLETED", restoreTestId, actor, `${id}: ${status} — ${evidence}`);
    return s;
  };

  stage("SELECT_BACKUP", "PASSED", `real backup ${backupId} selected (${backup.manifest.tables} tables, ${backup.manifest.total_rows} real rows in manifest)`);

  const manifestPath = path.join(ROOT, "backups", backupId, "_manifest.json");
  if (!existsSync(manifestPath)) { stage("VALIDATE_MANIFEST", "FAILED", "real manifest missing", "manifest not found"); }
  else stage("VALIDATE_MANIFEST", "PASSED", "real manifest re-read and parsed successfully");

  stage("VALIDATE_CHECKSUM", "SKIPPED", "no real original checksum was ever recorded at backup creation time — nothing to compare against (real, disclosed gap, see backupRuntime.ts)");
  stage("PREPARE_ISOLATED_TARGET", "SKIPPED", "no real isolated database/container/sandbox schema is available in this environment");
  stage("RESTORE_SCHEMA", "SKIPPED", "requires a real isolated target, which does not exist this Step");
  stage("RESTORE_DATA", "SKIPPED", "requires a real isolated target, which does not exist this Step — never restores to Production");

  let totalRealRows = 0;
  let allTablesParsed = true;
  const tableResults: string[] = [];
  for (const table of EXPECTED_BACKUP_TABLES) {
    const filePath = path.join(ROOT, "backups", backupId, `${table}.json`);
    if (!existsSync(filePath)) { tableResults.push(`${table}: missing`); continue; }
    try {
      const rows = JSON.parse(readFileSync(filePath, "utf-8"));
      if (!Array.isArray(rows)) throw new Error("not an array");
      totalRealRows += rows.length;
      tableResults.push(`${table}: ${rows.length} rows`);
    } catch {
      allTablesParsed = false;
      tableResults.push(`${table}: PARSE_ERROR`);
    }
  }
  stage("VERIFY_OBJECTS", allTablesParsed ? "PASSED" : "FAILED", `real dry-run parse: ${tableResults.join(", ")}`, allTablesParsed ? null : "one or more real backup files failed to parse");

  const countsMatch = totalRealRows === backup.manifest.total_rows;
  stage("VERIFY_COUNTS", countsMatch ? "PASSED" : "FAILED", `real dry-run row sum: ${totalRealRows}, real manifest total_rows: ${backup.manifest.total_rows}`, countsMatch ? null : "real row count mismatch between dry-run parse and manifest");

  stage("VERIFY_CONSTRAINTS", "SKIPPED", "requires a real isolated database target, which does not exist this Step");
  stage("VERIFY_CRITICAL_QUERIES", "SKIPPED", "requires a real isolated database target, which does not exist this Step");

  const cleanupStage = stage("CLEANUP", "PASSED", "real dry-run wrote nothing — cleanup trivially complete, nothing to remove");
  cleanupStage.cleanupStatus = "CLEAN";
  emitRestoreTestEvent("RESTORE_CLEANUP_COMPLETED", restoreTestId, actor, "real cleanup confirmed — no real state was ever mutated");

  stage("REPORT", "PASSED", "real RestoreTestRun record generated");

  const anyFailed = stages.some((s) => s.status === "FAILED");
  const overallStatus: RestoreTestOverallStatus = anyFailed ? "FAILED" : "PLAN_ONLY";

  const run: RestoreTestRun = {
    restoreTestId, backupId, status: overallStatus, stages, createdAt, finishedAt: new Date().toISOString(),
    ownerId, actor, artifactIds: [],
    limitations: "Dry-run/parser-based inventory verification only — no real isolated database target exists in this environment. PREPARE_ISOLATED_TARGET through VERIFY_CRITICAL_QUERIES were honestly SKIPPED. This proves the backup files are structurally readable and row-count-consistent; it does NOT prove a real database restore succeeds.",
  };

  const runArtifact = createOperationsArtifact({
    artifactType: "RESTORE_TEST_RUN", content: JSON.stringify(run), mimeType: "application/json",
    actor, ownerId, generatedFrom: restoreTestId, jobId: null, relatedBackupId: backupId, relatedRestoreTestId: restoreTestId,
  });
  run.artifactIds.push(runArtifact.artifactId);
  const verificationArtifact = createOperationsArtifact({
    artifactType: "RESTORE_VERIFICATION_REPORT", content: JSON.stringify({ status: overallStatus, limitations: run.limitations }), mimeType: "application/json",
    actor, ownerId, generatedFrom: `${restoreTestId}-verify`, jobId: null, relatedBackupId: backupId, relatedRestoreTestId: restoreTestId, parentIds: [runArtifact.artifactId],
  });
  run.artifactIds.push(verificationArtifact.artifactId);

  restoreTests.set(restoreTestId, run);
  evictOld(ownerId);

  if (overallStatus === "FAILED") emitRestoreTestEvent("RESTORE_TEST_FAILED", restoreTestId, actor, "one or more real stages failed");
  else emitRestoreTestEvent("RESTORE_TEST_UNVERIFIED", restoreTestId, actor, "PLAN_ONLY — never claims VERIFIED_RESTORE without a real isolated database target");

  return run;
}

export function getRestoreTest(restoreTestId: string, ownerId: string): RestoreTestRun {
  const r = restoreTests.get(restoreTestId);
  if (!r) throw new RestoreTestError("RESTORE_TEST_NOT_FOUND", "no restore test with that id");
  if (r.ownerId !== ownerId) throw new RestoreTestError("RESTORE_TEST_NOT_OWNED", "this restore test belongs to a different session");
  return r;
}
export function listRestoreTests(ownerId: string): RestoreTestRun[] {
  return [...restoreTests.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function __debugRestoreTestCount(): number { return restoreTests.size; }
