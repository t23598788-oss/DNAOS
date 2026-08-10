/**
 * Shared path-security + audit-logging module for /admin/ide's real file
 * reading endpoints (owner, 2026-08-05 — "เชื่อมหน้า /admin/ide เข้ากับ File
 * Workspace จริงแบบจำกัดขอบเขต" + "เชื่อม Search...แบบ read-only" passes).
 * Used only by app/api/admin/ide/tree, app/api/admin/ide/file, and
 * app/api/admin/ide/search — read-only, no write/delete/rename anywhere in
 * this file or its callers.
 *
 * Security model (deny-by-exclusion over the whole project root, not a
 * curated whitelist of specific top-level directories): WORKSPACE_ROOT is
 * fixed server-side to process.cwd() — the client can only ever send a
 * relative path, checked against WORKSPACE_ROOT here, never trusted as-is.
 */
import { promises as fs } from "fs";
import path from "path";

// process.cwd() — same real convention every other app/api/admin/* route in
// this codebase already uses for the project root (e.g. app/api/admin/
// workspace/status/route.ts, engines/workspace/fileTree.ts). Fixed at
// module load; never derived from client input.
export const WORKSPACE_ROOT = process.cwd();

export const MAX_FILE_BYTES = 1_000_000; // 1MB, per spec

export type IdeErrorCode =
  | "INVALID_PATH"
  | "INVALID_QUERY"
  | "INVALID_NAME"
  | "PATH_OUTSIDE_WORKSPACE"
  | "NOT_FOUND"
  | "ACCESS_DENIED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FILE"
  | "SEARCH_LIMIT_REACHED"
  | "SEARCH_TIMEOUT"
  | "GIT_ERROR"
  | "FILE_CONFLICT"
  | "WRITE_FAILED"
  | "PATH_CONFLICT"
  | "DIRECTORY_NOT_EMPTY"
  | "INVALID_MOVE"
  | "TRASH_ENTRY_NOT_FOUND"
  | "CORRUPT_TRASH_ENTRY"
  | "OPERATION_FAILED"
  | "LOCKED_FILE"
  | "INTERNAL_ERROR";

export class IdeFsError extends Error {
  code: IdeErrorCode;
  constructor(code: IdeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ".dnaos-trash" added (owner, 2026-08-05, Phase 3) — the workspace trash
// directory (see ./trash.ts) must be invisible to Explorer/Search/tree the
// same way .git/node_modules already are; one exclusion list, reused by
// every reader AND every writer, so trash contents can never be listed,
// searched, read, or written-into through the normal file APIs.
const EXCLUDED_DIR_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".dnaos-trash"]);
const EXCLUDED_DIR_PATTERN = /^\.tmp-/;
// File-name patterns that must never be listed or read, regardless of
// where in the tree they appear — checked at every path segment, not just
// the final component, so e.g. "some/nested/.env.local" is denied too.
const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /^\.env$/i,
  /^\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /credential/i,
  /secret/i,
];

// Real, defense-in-depth denylist (Software Factory Readiness, Worker
// #2/UI_WORKER gap fill, 2026-08-09) — real, structurally dangerous
// paths (DB migrations, CI/CD, infra-as-code, deploy config) that no
// scoped Worker may ever write to, REGARDLESS of what a Job Contract's
// permittedWriteScope says. This is a second, independent check on top
// of scope matching — a JobContract author's mistake (accidentally
// including one of these in permittedWriteScope) is still refused here.
// Checked by codeWorkerRuntime.ts#validateOperationScope for every
// Worker (Worker #1's CODE_WORKER and Worker #2's UI_WORKER alike).
const HIGH_RISK_INFRA_PATTERNS: RegExp[] = [
  /^supabase\/migrations\//i,
  /^supabase\/functions\//i,
  /^\.github\/workflows\//i,
  /^\.githooks\//i,
  /^infra\//i,
  /^terraform\//i,
  /^k8s\//i,
  /^helm\//i,
  /^\.vercel\//i,
  /^vercel\.json$/i,
  /^docker-compose[\w.-]*\.ya?ml$/i,
  /^Dockerfile[\w.-]*$/i,
];

export function isHighRiskInfraPath(relPath: string): boolean {
  return HIGH_RISK_INFRA_PATTERNS.some((p) => p.test(relPath));
}

export function isExcludedName(name: string, isDirectory: boolean): boolean {
  if (isDirectory) {
    return EXCLUDED_DIR_NAMES.has(name) || EXCLUDED_DIR_PATTERN.test(name);
  }
  return EXCLUDED_FILE_PATTERNS.some((p) => p.test(name));
}

export interface SafePath {
  /** Absolute filesystem path — server-side use only, never sent to the client. */
  absPath: string;
  /** Workspace-relative path (forward-slash separated) — the only path form returned to clients. */
  relPath: string;
}

/**
 * Validate and resolve a client-supplied relative path against
 * WORKSPACE_ROOT. Rejects: absolute paths, null bytes, traversal outside
 * the root (".." or otherwise), any excluded path segment (.git,
 * node_modules, .env*, *.pem, *.key, credential/secret-named files, etc.),
 * and any symlink (at any segment, or the final resolved path) that points
 * outside WORKSPACE_ROOT. Throws IdeFsError with a typed code on failure —
 * never silently narrows or "helpfully" corrects a bad path.
 */
export async function resolveSafeRelativePath(clientPath: string): Promise<SafePath> {
  if (typeof clientPath !== "string") {
    throw new IdeFsError("INVALID_PATH", "path must be a string");
  }
  if (clientPath.includes("\0")) {
    throw new IdeFsError("INVALID_PATH", "path contains an invalid character");
  }
  if (path.isAbsolute(clientPath)) {
    throw new IdeFsError("INVALID_PATH", "absolute paths are not accepted — send a relative path only");
  }

  const candidate = path.resolve(WORKSPACE_ROOT, clientPath);
  const withSep = WORKSPACE_ROOT + path.sep;
  if (candidate !== WORKSPACE_ROOT && !candidate.startsWith(withSep)) {
    throw new IdeFsError("PATH_OUTSIDE_WORKSPACE", "path escapes the workspace root");
  }

  const relPath = path.relative(WORKSPACE_ROOT, candidate);
  const segments = relPath === "" ? [] : relPath.split(path.sep);

  let walked = WORKSPACE_ROOT;
  for (const segment of segments) {
    walked = path.join(walked, segment);
    let lstat;
    try {
      lstat = await fs.lstat(walked);
    } catch {
      throw new IdeFsError("NOT_FOUND", "path does not exist");
    }
    if (isExcludedName(segment, lstat.isDirectory())) {
      throw new IdeFsError("ACCESS_DENIED", "path is excluded");
    }
    if (lstat.isSymbolicLink()) {
      const real = await fs.realpath(walked).catch(() => null);
      if (!real || (real !== WORKSPACE_ROOT && !real.startsWith(withSep))) {
        throw new IdeFsError("ACCESS_DENIED", "symlink escapes the workspace root");
      }
    }
  }

  // Defense in depth: resolve the final real path too, in case something
  // upstream missed a symlink hop the segment walk didn't catch.
  const finalReal = await fs.realpath(candidate).catch(() => candidate);
  if (finalReal !== WORKSPACE_ROOT && !finalReal.startsWith(withSep)) {
    throw new IdeFsError("ACCESS_DENIED", "resolved path escapes the workspace root");
  }

  return { absPath: candidate, relPath: segments.join("/") };
}

/**
 * A real, single filename/foldername component — never a path. Rejects
 * empty, ".", "..", any path separator, and null bytes. No Unicode
 * normalization is applied: the codebase has no stated filename-
 * normalization policy (checked registry/CONSTITUTION.json), so per
 * instruction this preserves the name exactly as given rather than
 * guessing a normalization form.
 */
export function isValidEntryName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\0")) return false;
  return true;
}

export interface NewEntryPath {
  /** Absolute filesystem path of the (not-yet-existing) target — server-side use only. */
  absPath: string;
  /** Workspace-relative path of the target. */
  relPath: string;
  /** Absolute path of the target's parent directory. */
  parentAbsPath: string;
  name: string;
}

/**
 * Resolves and validates a path for something that must NOT exist yet
 * (Create File/Folder, or the destination of a Rename/Move) — the mirror
 * image of resolveSafeRelativePath(), which requires the full path to
 * already exist. The parent directory is validated through the exact same
 * resolveSafeRelativePath() (so every existing check — traversal,
 * exclusion, symlink escape — applies identically to the parent chain),
 * the final component's NAME is validated separately (isValidEntryName +
 * exclusion), and the target itself must not already exist on disk
 * (PATH_CONFLICT otherwise). Throws IdeFsError on any failure.
 */
export async function resolveNewEntryPath(clientPath: string): Promise<NewEntryPath> {
  if (typeof clientPath !== "string") throw new IdeFsError("INVALID_PATH", "path must be a string");
  if (clientPath.includes("\0")) throw new IdeFsError("INVALID_PATH", "path contains an invalid character");
  if (path.isAbsolute(clientPath)) throw new IdeFsError("INVALID_PATH", "absolute paths are not accepted — send a relative path only");

  const trimmed = clientPath.replace(/\/+$/, "");
  if (trimmed === "") throw new IdeFsError("INVALID_NAME", "name cannot be empty");

  const name = path.basename(trimmed);
  const parentClient = path.dirname(trimmed); // "." when there's no parent segment

  if (!isValidEntryName(name)) throw new IdeFsError("INVALID_NAME", "invalid file or folder name");
  if (isExcludedName(name, false) || isExcludedName(name, true)) throw new IdeFsError("ACCESS_DENIED", "that name is excluded");

  const parentRel = parentClient === "." ? "" : parentClient;
  const { absPath: parentAbsPath, relPath: parentRelPath } = await resolveSafeRelativePath(parentRel);
  const parentStat = await fs.stat(parentAbsPath).catch(() => null);
  if (!parentStat) throw new IdeFsError("NOT_FOUND", "parent directory does not exist");
  if (!parentStat.isDirectory()) throw new IdeFsError("INVALID_PATH", "parent is not a directory");

  const absPath = path.join(parentAbsPath, name);
  const relPath = parentRelPath ? `${parentRelPath}/${name}` : name;

  const existing = await fs.lstat(absPath).catch(() => null);
  if (existing) throw new IdeFsError("PATH_CONFLICT", "a file or folder already exists at that path");

  return { absPath, relPath, parentAbsPath, name };
}

/**
 * Filesystem-operation audit log (owner, 2026-08-05, Phase 3) — operation
 * name, source/destination relative paths, timestamp, result only. Never
 * content, never an absolute path, never a secret.
 */
export function auditFsOpLog(operation: "create" | "rename" | "move" | "trash" | "restore", sourceRelPath: string, destRelPath: string | null, result: "ok" | IdeErrorCode) {
  console.log(JSON.stringify({ event: `ide.fs.${operation}`, source: sourceRelPath, destination: destRelPath, at: new Date().toISOString(), result }));
}

/** First-chunk null-byte heuristic — standard, content-based binary
 * detection (not extension-based), so a text file with an unusual
 * extension isn't wrongly rejected and a binary file with a misleading
 * extension isn't wrongly served. */
export function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  return sample.includes(0);
}

/**
 * Audit log — metadata only (owner requirement): relative path, timestamp,
 * result. Never the file content, never a secret, never a request header.
 * Server console output only — no new Supabase table (out of scope this
 * round; this page does not connect to Supabase).
 *
 * `actor` and `hash` (owner, 2026-08-06, Real Editor Write Path Step 1) —
 * optional so every pre-existing call site (tree/search/git reads) keeps
 * working unchanged; app/api/admin/ide/file/route.ts's GET passes both
 * (the real authenticated user id, and the real sha256 of what was read)
 * to satisfy the Audit Evidence requirement: actor, path, hash,
 * timestamp, result all present for every real file open.
 */
export function auditLog(
  event: "ide.tree.read" | "ide.file.read" | "ide.git.status" | "ide.git.diff"
    | "ide.git.branches" | "ide.git.tags" | "ide.git.history" | "ide.git.blame" | "ide.git.merge_status" | "ide.git.conflicts",
  relPath: string,
  result: "ok" | IdeErrorCode,
  options?: { actor?: string; hash?: string }
) {
  console.log(JSON.stringify({ event, path: relPath, actor: options?.actor ?? null, hash: options?.hash ?? null, at: new Date().toISOString(), result }));
}

/**
 * Write-specific audit log (owner, 2026-08-05, Phase 2; extended
 * 2026-08-06 with actor/before_hash/after_hash/error for the Real Editor
 * Write Path's Audit Evidence requirement). Never the file content, never
 * the diff, never a secret — only real, already-computed metadata.
 */
export function auditFileWriteLog(
  relPath: string,
  sizeBytes: number | null,
  result: "ok" | IdeErrorCode,
  options?: { actor?: string; beforeHash?: string; afterHash?: string; error?: string }
) {
  console.log(JSON.stringify({
    event: "ide.file.write", path: relPath, size_bytes: sizeBytes,
    actor: options?.actor ?? null, before_hash: options?.beforeHash ?? null, after_hash: options?.afterHash ?? null,
    error: options?.error ?? null, at: new Date().toISOString(), result,
  }));
}

/**
 * Search audit log (owner, 2026-08-05) — deliberately never logs the query
 * text itself, only its length. A search query can legitimately contain
 * something sensitive the user typed to find (e.g. hunting for where a
 * leaked value appears) — logging length + scope + result count + duration
 * is enough to audit usage without recording what was searched for.
 */
export function auditSearchLog(queryLength: number, scopePath: string, resultCount: number, durationMs: number, status: "ok" | IdeErrorCode) {
  console.log(JSON.stringify({ event: "ide.search", query_length: queryLength, path: scopePath, result_count: resultCount, duration_ms: durationMs, status, at: new Date().toISOString() }));
}

/**
 * Lazy, depth-first real-file walker for Search — reuses the exact same
 * exclusion rules and symlink-escape checks as resolveSafeRelativePath(),
 * applied per directory entry rather than to one target path. A generator,
 * not an array: the caller (search/route.ts) can stop pulling from it the
 * instant it hits a result/file/time limit, so this never materializes the
 * whole workspace file list in memory — directories are read one at a time,
 * on demand.
 */
export async function* walkWorkspaceFiles(startRelPath: string): AsyncGenerator<{ absPath: string; relPath: string }> {
  const { absPath: startAbs, relPath: startRel } = await resolveSafeRelativePath(startRelPath);
  const startStat = await fs.stat(startAbs).catch(() => null);
  if (!startStat) return;
  if (startStat.isFile()) {
    yield { absPath: startAbs, relPath: startRel };
    return;
  }
  if (!startStat.isDirectory()) return;
  yield* walkDir(startAbs, startRel);
}

async function* walkDir(absDir: string, relDir: string): AsyncGenerator<{ absPath: string; relPath: string }> {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  const sorted = [...dirents].sort((a, b) =>
    a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1
  );
  const withSep = WORKSPACE_ROOT + path.sep;
  for (const entry of sorted) {
    if (isExcludedName(entry.name, entry.isDirectory())) continue;
    const abs = path.join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;

    let lst;
    try {
      lst = await fs.lstat(abs);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink()) {
      const real = await fs.realpath(abs).catch(() => null);
      if (!real || (real !== WORKSPACE_ROOT && !real.startsWith(withSep))) continue;
    }
    if (lst.isDirectory()) {
      yield* walkDir(abs, rel);
    } else if (lst.isFile()) {
      yield { absPath: abs, relPath: rel };
    }
  }
}
