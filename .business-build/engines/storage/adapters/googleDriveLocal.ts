/**
 * Google Drive Desktop local-sync adapter.
 *
 * Local-first and read-only: this adapter never calls Google APIs, reads
 * credentials, writes/moves/deletes files, or treats Drive as DNA OS truth.
 * A caller must provide an explicit approved folder scope before ingestion.
 */
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type GoogleDriveConnectionStatus = "connected" | "approval_required" | "unavailable" | "invalid_scope";

export interface GoogleDriveConnectionState {
  provider: "google_drive_desktop";
  status: GoogleDriveConnectionStatus;
  discovered_roots: string[];
  selected_sync_root: string | null;
  approved_scope: string | null;
  accessible: boolean;
  last_scan_at: string | null;
  last_scan_result: "not_run" | "blocked" | "passed" | "failed";
  reason: string;
}

export interface GoogleDriveFileEvidence {
  relative_path: string;
  absolute_path: string;
  size_bytes: number;
  modified_at: string;
  sha256: string;
  content_preview: string | null;
}

export interface GoogleDriveIngestionResult {
  read_only: true;
  source: "google_drive_desktop_local_sync";
  scope: string;
  files: GoogleDriveFileEvidence[];
  scanned_at: string;
}

function knownCandidates(home: string): string[] {
  return [
    join(home, "Google Drive"),
    join(home, "Google Drive", "My Drive"),
    join(home, "Library", "CloudStorage", "Google Drive"),
  ];
}

function isReadableDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && (accessSync(path, constants.R_OK | constants.X_OK), true);
  } catch {
    return false;
  }
}

/** Checks only known Google Drive Desktop locations; never scans the home directory. */
export function discoverGoogleDriveSyncRoots(home = "/Users/tam"): string[] {
  const roots = new Set<string>();
  for (const candidate of knownCandidates(home)) {
    if (isReadableDirectory(candidate)) roots.add(resolve(candidate));
  }
  try {
    const cloudStorage = join(home, "Library", "CloudStorage");
    if (isReadableDirectory(cloudStorage)) {
      for (const entry of readdirSync(cloudStorage, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith("GoogleDrive-")) {
          const candidate = join(cloudStorage, entry.name);
          if (isReadableDirectory(candidate)) roots.add(resolve(candidate));
        }
      }
    }
  } catch {
    // Discovery stays best-effort; an explicit configured path remains valid.
  }
  return [...roots];
}

export function validateGoogleDriveScope(syncRoot: string, approvedScope: string | null | undefined): { ok: true; root: string; scope: string } | { ok: false; reason: string } {
  if (!isReadableDirectory(syncRoot)) return { ok: false, reason: "selected Google Drive sync root is missing or not readable" };
  if (!approvedScope) return { ok: false, reason: "an explicit approved Google Drive folder scope is required before reading files" };

  const root = resolve(syncRoot);
  const scope = resolve(isAbsolute(approvedScope) ? approvedScope : join(root, approvedScope));
  const rel = relative(root, scope);
  if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, reason: "approved scope must stay inside the selected Google Drive sync root" };
  if (!isReadableDirectory(scope)) return { ok: false, reason: "approved Google Drive folder is missing or not readable" };
  return { ok: true, root, scope };
}

export function getGoogleDriveConnectionState(opts: { syncRoot?: string | null; approvedScope?: string | null; home?: string; now?: string } = {}): GoogleDriveConnectionState {
  const discovered = discoverGoogleDriveSyncRoots(opts.home);
  const root = opts.syncRoot ?? process.env.GOOGLE_DRIVE_SYNC_ROOT ?? null;
  const approvedScope = opts.approvedScope ?? process.env.GOOGLE_DRIVE_APPROVED_SCOPE ?? null;
  if (!root) {
    return { provider: "google_drive_desktop", status: discovered.length ? "approval_required" : "unavailable", discovered_roots: discovered, selected_sync_root: null, approved_scope: approvedScope, accessible: false, last_scan_at: opts.now ?? null, last_scan_result: "blocked", reason: discovered.length ? "local sync root found; configure an explicit selected root and approved folder scope" : "no known local Google Drive sync root found" };
  }
  const validation = validateGoogleDriveScope(root, approvedScope);
  if (!validation.ok) {
    return { provider: "google_drive_desktop", status: validation.reason.includes("scope") ? "approval_required" : "invalid_scope", discovered_roots: discovered, selected_sync_root: resolve(root), approved_scope: approvedScope, accessible: false, last_scan_at: opts.now ?? null, last_scan_result: "blocked", reason: validation.reason };
  }
  return { provider: "google_drive_desktop", status: "connected", discovered_roots: discovered, selected_sync_root: validation.root, approved_scope: validation.scope, accessible: true, last_scan_at: opts.now ?? null, last_scan_result: "not_run", reason: "selected local sync folder is readable; ingestion remains explicitly scoped and read-only" };
}

function walkSelectedFiles(scope: string, maxDepth: number, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    const full = join(scope, entry.name);
    if (entry.isDirectory()) files.push(...walkSelectedFiles(full, maxDepth, depth + 1));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/** Reads only the explicitly approved scope; no writes or Google API calls. */
export function ingestApprovedGoogleDriveScope(opts: { syncRoot: string; approvedScope: string; maxDepth?: number; maxFiles?: number; previewBytes?: number }): GoogleDriveIngestionResult | { read_only: true; blocked: true; reason: string } {
  const validation = validateGoogleDriveScope(opts.syncRoot, opts.approvedScope);
  if (!validation.ok) return { read_only: true, blocked: true, reason: validation.reason };
  const files = walkSelectedFiles(validation.scope, opts.maxDepth ?? 4).slice(0, opts.maxFiles ?? 100);
  return {
    read_only: true,
    source: "google_drive_desktop_local_sync",
    scope: relative(validation.root, validation.scope) || ".",
    files: files.map((path) => {
      const bytes = readFileSync(path);
      const stat = statSync(path);
      return { relative_path: relative(validation.root, path), absolute_path: path, size_bytes: stat.size, modified_at: stat.mtime.toISOString(), sha256: createHash("sha256").update(bytes).digest("hex"), content_preview: bytes.subarray(0, opts.previewBytes ?? 512).toString("utf8") };
    }),
    scanned_at: new Date().toISOString(),
  };
}

/** Reuses the existing health/problem-report convention; the DB write is optional. */
export async function reportGoogleDriveHealth(db: { from(table: string): { upsert(row: Record<string, unknown>, options?: { onConflict?: string }): PromiseLike<unknown> } } | null, state: GoogleDriveConnectionState): Promise<void> {
  if (!db) return;
  await db.from("system_health_status").upsert({ service_key: "google_drive_local", check_kind: "local_sync_access", status: state.status === "connected" ? "healthy" : "degraded", consecutive_failures: state.status === "connected" ? 0 : 1, last_check_at: state.last_scan_at, last_error: state.status === "connected" ? null : state.reason, detail: state }, { onConflict: "service_key" });
}
