/**
 * Backup — Scope Registry (owner, 2026-08-08, Software Factory Step
 * 12.5). Declares the real Backup Scopes this Factory tracks, and each
 * one's REAL, currently-known status — never VERIFIED from file
 * presence alone.
 *
 * Reuse investigation (Phase 1) — real, confirmed by direct inspection:
 *  - scripts/backup.ts is the ONLY real backup mechanism in this repo —
 *    backs up 20 real Supabase tables to backups/YYYY-MM-DD_HHmmss/*.json
 *    + a real _manifest.json (created_at/tables/success/errors/total_rows/
 *    error_details). Confirmed real, single, existing backup:
 *    backups/2026-07-05_0502/ (19/20 tables, 511 rows, 1 real error —
 *    kv_cache table missing at backup time).
 *  - registry/infrastructure.json's real `backup` field independently
 *    confirms: schedule "manual", local-disk-only risk_note, cloud backup
 *    status "planned" (not real).
 *  - The manifest NEVER recorded a checksum at creation time — backupRuntime.ts
 *    computes one NOW, live, at verification time; this can prove current
 *    readability/structure, never prove byte-identical-since-creation.
 *  - git remote `origin` is real and confirmed "up to date" — the real,
 *    existing off-machine backup of SOURCE (not data).
 */
export type BackupScope =
  | "DATABASE_SCHEMA" | "DATABASE_DATA" | "REGISTRY" | "ARTIFACT_METADATA"
  | "EVIDENCE_METADATA" | "CONFIGURATION" | "SOURCE_MANIFEST" | "CRITICAL_DOCUMENT_INDEX";

export type BackupScopeStatus = "VERIFIED" | "BACKUP_ONLY" | "PARTIAL" | "PLANNED" | "STALE" | "NOT_IMPLEMENTED" | "UNKNOWN";

export interface BackupScopeDefinition {
  scope: BackupScope;
  displayName: string;
  source: string;
  target: string;
  method: string;
  schedule: string;
  retention: string;
  encryption: string;
  compression: string;
  checksum: string;
  manifest: string;
  owner: string;
  status: BackupScopeStatus;
  limitations: string;
}

export const BACKUP_SCOPE_REGISTRY: Record<BackupScope, BackupScopeDefinition> = {
  DATABASE_DATA: {
    scope: "DATABASE_DATA", displayName: "Database Data (20 real Supabase tables)",
    source: "real Supabase tables (scripts/backup.ts's TABLES array)", target: "local disk: backups/YYYY-MM-DD_HHmmss/*.json",
    method: "real supabase-js .select(\"*\").limit(50000) per table, written as JSON", schedule: "manual only (npm run backup) — no real cron/scheduled trigger exists",
    retention: "30 most recent real backups, auto-cleaned by scripts/backup.ts#cleanOldBackups", encryption: "none — real, plain JSON on local disk",
    compression: "none", checksum: "real sha256 per table, recorded at creation time as of Step 12.75 (scripts/backup.ts) — the real, existing 2026-07-05 backup predates this and has none; backupRuntime.ts compares live-computed checksums against the recorded original whenever present, honestly UNKNOWN when absent",
    manifest: "real backups/*/_manifest.json", owner: "operations-center",
    status: "STALE", limitations: "latest real backup (2026-07-05_0502) is 30+ days old as of this Step and predates checksum recording; kv_cache table was missing at backup time (1 real error) — no NEW backup has been run this Step (would require real Supabase credentials not present in this environment)",
  },
  DATABASE_SCHEMA: {
    scope: "DATABASE_SCHEMA", displayName: "Database Schema",
    source: "real Supabase Postgres schema", target: "no real dedicated schema export exists",
    method: "none — scripts/backup.ts only exports row data via .select(\"*\"), never DDL/pg_dump", schedule: "n/a",
    retention: "n/a", encryption: "n/a", compression: "n/a", checksum: "n/a", manifest: "n/a", owner: "operations-center",
    status: "PARTIAL", limitations: "the real supabase/migrations/*.sql directory is this repo's real, git-tracked schema HISTORY (recoverable via git), but this is source control, not a dedicated schema backup artifact — real, honest distinction",
  },
  REGISTRY: {
    scope: "REGISTRY", displayName: "Registry (registry/*.json)",
    source: "real registry/*.json files", target: "no real dedicated backup exists",
    method: "none — registry files are real, generated/git-tracked artifacts, regenerable via npm run sync", schedule: "n/a",
    retention: "n/a", encryption: "n/a", compression: "n/a", checksum: "n/a", manifest: "n/a", owner: "operations-center",
    status: "PARTIAL", limitations: "no dedicated backup mechanism exists; real recoverability relies on git history + regeneration scripts, not a snapshot artifact",
  },
  ARTIFACT_METADATA: {
    scope: "ARTIFACT_METADATA", displayName: "Artifact Metadata",
    source: "in-memory artifactRuntime.ts Map", target: "none",
    method: "none — real Artifact records are bounded in-memory only, never persisted to disk", schedule: "n/a",
    retention: "n/a", encryption: "n/a", compression: "n/a", checksum: "n/a", manifest: "n/a", owner: "operations-center",
    status: "NOT_IMPLEMENTED", limitations: "real, honest gap — Artifact/Evidence data does not survive a process restart; no backup exists because there is no persistence to back up",
  },
  EVIDENCE_METADATA: {
    scope: "EVIDENCE_METADATA", displayName: "Evidence Metadata",
    source: "in-memory artifactRuntime.ts EvidenceRef records", target: "none",
    method: "none — same real limitation as ARTIFACT_METADATA", schedule: "n/a",
    retention: "n/a", encryption: "n/a", compression: "n/a", checksum: "n/a", manifest: "n/a", owner: "operations-center",
    status: "NOT_IMPLEMENTED", limitations: "real, honest gap — not persisted, so not backed up",
  },
  CONFIGURATION: {
    scope: "CONFIGURATION", displayName: "Configuration (env vars/secrets)",
    source: "real environment variables", target: "intentionally none",
    method: "none, by real policy — this Step's mission explicitly forbids backing up plain credentials", schedule: "n/a",
    retention: "n/a", encryption: "n/a", compression: "n/a", checksum: "n/a", manifest: "n/a", owner: "operations-center",
    status: "NOT_IMPLEMENTED", limitations: "deliberate — never back up secrets/plain credentials (Section 9 mission rule), not a gap to close",
  },
  SOURCE_MANIFEST: {
    scope: "SOURCE_MANIFEST", displayName: "Source Manifest (git)",
    source: "the real, live git working tree", target: "real, existing git remote `origin` (github.com)",
    method: "real git push/pull to the real, already-configured remote", schedule: "owner-driven (git push), not automatic",
    retention: "full real git history", encryption: "provider-managed (GitHub)", compression: "git's own real delta compression",
    checksum: "real git commit SHA (content-addressed by design)", manifest: "git's own real object database", owner: "operations-center",
    status: "VERIFIED", limitations: "real, confirmed: `git remote -v` shows a real origin, and `git status` confirms this branch is up to date with origin/main at time of this Step's investigation",
  },
  CRITICAL_DOCUMENT_INDEX: {
    scope: "CRITICAL_DOCUMENT_INDEX", displayName: "Critical Document Index",
    source: "no real Document engine exists", target: "none",
    method: "none — matches Step 10's real finding: Document Lifecycle Constitution is DECLARED_NOT_ENFORCED, no real Document engine exists", schedule: "n/a",
    retention: "n/a", encryption: "n/a", compression: "n/a", checksum: "n/a", manifest: "n/a", owner: "operations-center",
    status: "NOT_IMPLEMENTED", limitations: "real, honest — cannot back up an index that does not exist",
  },
};

export function listBackupScopes(): BackupScopeDefinition[] {
  return Object.values(BACKUP_SCOPE_REGISTRY);
}
export function getBackupScopeDefinition(scope: string): BackupScopeDefinition | undefined {
  return BACKUP_SCOPE_REGISTRY[scope as BackupScope];
}
