/**
 * Restore Test — Stage Registry (owner, 2026-08-08, Software Factory
 * Step 12.5). Declares the real, 12 Restore Test stages. This repo has
 * NO real isolated database, disposable container, or sandbox schema
 * available in this environment (investigated: no docker/sqlite/test-db
 * tooling wired to a real restore path) — the ONLY real option per the
 * mission's own explicit allowance ("dry-run parser/inventory
 * verification") is a dry-run: parse each real backup table file,
 * verify structure and row counts, WITHOUT ever writing to any database.
 * PREPARE_ISOLATED_TARGET through VERIFY_CRITICAL_QUERIES are therefore
 * honestly SKIPPED every real run — this is a genuine, disclosed
 * limitation, never hidden.
 */
export type RestoreTestStage =
  | "SELECT_BACKUP" | "VALIDATE_MANIFEST" | "VALIDATE_CHECKSUM" | "PREPARE_ISOLATED_TARGET"
  | "RESTORE_SCHEMA" | "RESTORE_DATA" | "VERIFY_OBJECTS" | "VERIFY_COUNTS"
  | "VERIFY_CONSTRAINTS" | "VERIFY_CRITICAL_QUERIES" | "CLEANUP" | "REPORT";

export interface RestoreTestStageDefinition {
  stage: RestoreTestStage;
  displayName: string;
  description: string;
  mutationScope: "NONE" | "ISOLATED_TARGET_ONLY";
  realizable: boolean;
}

export const RESTORE_TEST_STAGE_REGISTRY: Record<RestoreTestStage, RestoreTestStageDefinition> = {
  SELECT_BACKUP: { stage: "SELECT_BACKUP", displayName: "Select Backup", description: "Real, owner/system-selected backupId from backupRuntime.ts#discoverBackups().", mutationScope: "NONE", realizable: true },
  VALIDATE_MANIFEST: { stage: "VALIDATE_MANIFEST", displayName: "Validate Manifest", description: "Real, live re-check that the real _manifest.json parses.", mutationScope: "NONE", realizable: true },
  VALIDATE_CHECKSUM: { stage: "VALIDATE_CHECKSUM", displayName: "Validate Checksum", description: "Real, live sha256 computed per table file now; no original checksum exists to compare against (real, disclosed gap).", mutationScope: "NONE", realizable: true },
  PREPARE_ISOLATED_TARGET: { stage: "PREPARE_ISOLATED_TARGET", displayName: "Prepare Isolated Target", description: "No real isolated database/container/sandbox schema is available in this environment — honestly SKIPPED.", mutationScope: "NONE", realizable: false },
  RESTORE_SCHEMA: { stage: "RESTORE_SCHEMA", displayName: "Restore Schema", description: "Requires a real isolated target — SKIPPED.", mutationScope: "NONE", realizable: false },
  RESTORE_DATA: { stage: "RESTORE_DATA", displayName: "Restore Data", description: "Requires a real isolated target — SKIPPED. Never restores to Production.", mutationScope: "NONE", realizable: false },
  VERIFY_OBJECTS: { stage: "VERIFY_OBJECTS", displayName: "Verify Objects", description: "Real, dry-run structural check — each real backup table file parses as a real JSON array.", mutationScope: "NONE", realizable: true },
  VERIFY_COUNTS: { stage: "VERIFY_COUNTS", displayName: "Verify Counts", description: "Real row counts from the dry-run parse compared against the real manifest's total_rows.", mutationScope: "NONE", realizable: true },
  VERIFY_CONSTRAINTS: { stage: "VERIFY_CONSTRAINTS", displayName: "Verify Constraints", description: "Requires a real database to check real constraints — SKIPPED (no isolated target).", mutationScope: "NONE", realizable: false },
  VERIFY_CRITICAL_QUERIES: { stage: "VERIFY_CRITICAL_QUERIES", displayName: "Verify Critical Queries", description: "Requires a real database to run real queries — SKIPPED (no isolated target).", mutationScope: "NONE", realizable: false },
  CLEANUP: { stage: "CLEANUP", displayName: "Cleanup", description: "Real — nothing was ever written (dry-run only), so cleanup trivially and honestly completes with nothing to remove.", mutationScope: "NONE", realizable: true },
  REPORT: { stage: "REPORT", displayName: "Report", description: "Real RestoreTestRun record + RESTORE_VERIFICATION_REPORT artifact generated.", mutationScope: "NONE", realizable: true },
};

export function listRestoreTestStages(): RestoreTestStageDefinition[] {
  return Object.values(RESTORE_TEST_STAGE_REGISTRY);
}
export function getRestoreTestStageDefinition(stage: string): RestoreTestStageDefinition | undefined {
  return RESTORE_TEST_STAGE_REGISTRY[stage as RestoreTestStage];
}
