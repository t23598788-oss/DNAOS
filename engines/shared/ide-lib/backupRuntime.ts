/**
 * Backup Runtime (owner, 2026-08-08, Software Factory Step 12.5).
 * Discovers and verifies REAL, already-existing backups/&lt;timestamp&gt;/_manifest.json
 * output from scripts/backup.ts — never invokes a real backup itself
 * (scripts/backup.ts is deliberately NEVER imported as a module here: it
 * self-executes a real backup() call against real Supabase credentials
 * at its own bottom-of-file — importing it would trigger a real backup
 * attempt as a side effect of loading this Runtime, which this Step
 * forbids). Read-only, deterministic, never AI-judged.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { createHash } from "crypto";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";
import { listBackupScopes } from "./backupRegistry";
import { createOperationsArtifact } from "./artifactRuntime";

const ROOT = WORKSPACE_ROOT;
const DAY_MS = 24 * 60 * 60_000;
const STALE_AFTER_MS = 30 * DAY_MS;

/** The real, 20-table list scripts/backup.ts declares — copied here
 * deliberately (never imported; see file header) and kept in sync by
 * hand. If scripts/backup.ts's TABLES array changes, this constant must
 * be updated to match — flagged via a real regression test comparing
 * this list's length against the real, current backup manifest's
 * `tables` count. */
export const EXPECTED_BACKUP_TABLES = [
  "app_configs", "conversation_states", "debt_trackings", "document_items", "documents",
  "driver_profiles", "entity_registry", "invoice_debts", "invoice_payments", "jobs",
  "kv_cache", "line_draft_documents", "line_events", "match_queue", "material_types",
  "partners", "pit_materials", "pit_profiles", "resource_transactions", "vehicle_types",
];

function sha256Hex(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }

export interface BackupManifest {
  created_at: string; tables: number; success: number; errors: number; total_rows: number; error_details?: string[];
  /** Real, per-table sha256 recorded AT BACKUP CREATION TIME — added Step
   * 12.75 (scripts/backup.ts). Absent on any backup created before this
   * Step (e.g. the real 2026-07-05 backup) — those honestly have no
   * original checksum to compare against, ever. */
  checksums?: Record<string, string>;
}
export interface BackupRecord { backupId: string; path: string; manifest: BackupManifest; discoveredAt: string }

export function discoverBackups(): BackupRecord[] {
  const backupsDir = path.join(ROOT, "backups");
  if (!existsSync(backupsDir)) return [];
  const dirs = readdirSync(backupsDir).filter((d) => existsSync(path.join(backupsDir, d, "_manifest.json"))).sort().reverse();
  const out: BackupRecord[] = [];
  for (const d of dirs) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(backupsDir, d, "_manifest.json"), "utf-8")) as BackupManifest;
      out.push({ backupId: d, path: `backups/${d}`, manifest, discoveredAt: new Date().toISOString() });
    } catch { /* real, unparseable manifest — honestly excluded, not fabricated */ }
  }
  return out;
}

export type BackupIntegrityStatus = "VERIFIED" | "PARTIAL" | "CORRUPT" | "STALE" | "MISSING" | "UNKNOWN";
export interface IntegrityCheck { criterion: string; result: "PASS" | "FAIL" | "UNKNOWN"; detail: string }
export interface BackupIntegrityReport {
  backupId: string;
  status: BackupIntegrityStatus;
  checkedAt: string;
  ageMs: number | null;
  checks: IntegrityCheck[];
  computedChecksums: Record<string, string>;
  reason: string;
  artifactIds: string[];
}

export class BackupError extends Error {
  code: "BACKUP_NOT_FOUND";
  constructor(code: typeof BackupError.prototype.code, message: string) { super(message); this.code = code; this.name = "BackupError"; }
}

export async function verifyBackupIntegrity(backupId: string, ownerId: string, actor: string): Promise<BackupIntegrityReport> {
  const backupsDir = path.join(ROOT, "backups", backupId);
  const checks: IntegrityCheck[] = [];
  const computedChecksums: Record<string, string> = {};

  const manifestPath = path.join(backupsDir, "_manifest.json");
  if (!existsSync(manifestPath)) {
    const report: BackupIntegrityReport = { backupId, status: "MISSING", checkedAt: new Date().toISOString(), ageMs: null, checks: [{ criterion: "manifest exists", result: "FAIL", detail: `no real _manifest.json at ${backupsDir}` }], computedChecksums: {}, reason: "real backup directory or manifest not found", artifactIds: [] };
    return report;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as BackupManifest;
  checks.push({ criterion: "manifest exists", result: "PASS", detail: "real _manifest.json read successfully" });

  const ageMs = Date.now() - new Date(manifest.created_at).getTime();
  const stale = ageMs > STALE_AFTER_MS;
  checks.push({ criterion: "age/staleness", result: stale ? "FAIL" : "PASS", detail: `real backup age: ${Math.round(ageMs / DAY_MS)} day(s), staleAfter: ${STALE_AFTER_MS / DAY_MS} day(s)` });

  let corrupt = false;
  let presentCount = 0;
  const hasOriginalChecksums = !!manifest.checksums && Object.keys(manifest.checksums).length > 0;
  let checksumMismatch = false;
  for (const table of EXPECTED_BACKUP_TABLES) {
    const filePath = path.join(backupsDir, `${table}.json`);
    if (!existsSync(filePath)) {
      checks.push({ criterion: `table:${table}`, result: manifest.error_details?.some((e) => e.includes(table)) ? "FAIL" : "UNKNOWN", detail: `real file missing — ${manifest.error_details?.some((e) => e.includes(table)) ? "matches a real, disclosed manifest error" : "not disclosed in manifest, honestly UNKNOWN why"}` });
      continue;
    }
    try {
      const buf = readFileSync(filePath);
      const rows = JSON.parse(buf.toString("utf-8"));
      if (!Array.isArray(rows)) throw new Error("not a real JSON array");
      computedChecksums[table] = sha256Hex(buf);
      presentCount++;
      const original = manifest.checksums?.[table];
      if (original) {
        const matches = original === computedChecksums[table];
        if (!matches) checksumMismatch = true;
        checks.push({ criterion: `table:${table}`, result: matches ? "PASS" : "FAIL", detail: matches ? `real checksum MATCHES the real, original checksum recorded at backup creation — tamper-since-creation disproven` : `real checksum MISMATCH — original=${original.slice(0, 12)}, current=${computedChecksums[table].slice(0, 12)} — file changed since backup creation` });
      } else {
        checks.push({ criterion: `table:${table}`, result: "PASS", detail: `real, readable, valid JSON array (${rows.length} real rows), sha256=${computedChecksums[table].slice(0, 12)}` });
      }
    } catch (e) {
      corrupt = true;
      checks.push({ criterion: `table:${table}`, result: "FAIL", detail: `real file exists but failed to parse: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  if (checksumMismatch) corrupt = true;
  const scopeComplete = presentCount === EXPECTED_BACKUP_TABLES.length;
  checks.push({ criterion: "expected scope complete", result: scopeComplete ? "PASS" : "FAIL", detail: `${presentCount}/${EXPECTED_BACKUP_TABLES.length} real expected table files present and readable` });
  checks.push({
    criterion: "original checksum comparison", result: hasOriginalChecksums ? (checksumMismatch ? "FAIL" : "PASS") : "UNKNOWN",
    detail: hasOriginalChecksums
      ? (checksumMismatch ? "one or more real files do not match their real, original checksum recorded at backup creation" : "all real, present files match their real, original checksum recorded at backup creation (Step 12.75+)")
      : "this backup was created before Step 12.75 — scripts/backup.ts did not record a checksum at creation time, so computedChecksums above prove current readability only, never tamper-since-creation",
  });

  let status: BackupIntegrityStatus;
  let reason: string;
  if (corrupt) { status = "CORRUPT"; reason = checksumMismatch ? "one or more real files failed their real, original checksum comparison — tamper or corruption since backup creation" : "one or more real backup files failed to parse as valid JSON"; }
  else if (stale) { status = "STALE"; reason = `real backup is ${Math.round(ageMs / DAY_MS)} day(s) old, exceeds the real ${STALE_AFTER_MS / DAY_MS}-day staleness threshold`; }
  else if (!scopeComplete) { status = "PARTIAL"; reason = `only ${presentCount}/${EXPECTED_BACKUP_TABLES.length} real expected tables present`; }
  else {
    status = "VERIFIED";
    reason = hasOriginalChecksums
      ? "all real expected tables present, readable, fresh, and every real checksum matches the real, original checksum recorded at backup creation — tamper-since-creation disproven (Step 12.75+)"
      : "all real expected tables present, readable, and fresh — VERIFIED refers to structural integrity right now only; this backup predates Step 12.75, so no original checksum was ever recorded to prove tamper-since-creation";
  }

  const report: BackupIntegrityReport = { backupId, status, checkedAt: new Date().toISOString(), ageMs, checks, computedChecksums, reason, artifactIds: [] };

  const manifestArtifact = createOperationsArtifact({
    artifactType: "BACKUP_MANIFEST", content: JSON.stringify(manifest), mimeType: "application/json",
    actor, ownerId, generatedFrom: backupId, jobId: null, relatedBackupId: backupId,
  });
  const reportArtifact = createOperationsArtifact({
    artifactType: "BACKUP_INTEGRITY_REPORT", content: JSON.stringify(report), mimeType: "application/json",
    actor, ownerId, generatedFrom: `${backupId}-integrity-${Date.now()}`, jobId: null, relatedBackupId: backupId, parentIds: [manifestArtifact.artifactId],
  });
  report.artifactIds = [manifestArtifact.artifactId, reportArtifact.artifactId];
  return report;
}

export interface BackupPlan { scope: string; source: string; target: string; method: string; schedule: string; status: string }
export function listBackupPlan(): BackupPlan[] {
  return listBackupScopes().map((s) => ({ scope: s.scope, source: s.source, target: s.target, method: s.method, schedule: s.schedule, status: s.status }));
}

export function getBackup(backupId: string): BackupRecord {
  const found = discoverBackups().find((b) => b.backupId === backupId);
  if (!found) throw new BackupError("BACKUP_NOT_FOUND", `no real backup with id ${backupId}`);
  return found;
}
