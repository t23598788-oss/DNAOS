/**
 * Phase 1 — filesystem access guard + code.read for a granted workspace.
 *
 * Scope: READ-ONLY. Phase 1 intentionally exposes NO write/delete surface
 * (the write path arrives with workspace isolation in the next phase,
 * pending the owner-approved change-set flow on the Business plane). The
 * defense is the same discipline as app/api/admin/ide/_lib/fsSecurity.ts:
 * deny-by-exclusion over a fixed workspace root, never trusting the client
 * path as given. No Business Runtime import — the guard is reimplemented
 * here so the compute plane keeps zero dependency on app code.
 */
import { promises as fs } from "fs";
import path from "path";

export const MAX_READ_BYTES = 1_000_000; // 1MB — same cap as the IDE file endpoint

/** Directory names that must never be listed or read anywhere in the tree. */
const EXCLUDED_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".dnaos-trash"]);

/** File-name patterns denied regardless of position in the tree. */
const EXCLUDED_FILE_PATTERNS: RegExp[] = [
  /^\.env$/i,
  /^\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /credential/i,
  /secret/i,
];

export class WorkspaceError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Resolve a client-relative path to an absolute path INSIDE workspaceRoot,
 * or throw. The client path must be relative; traversal ("..") is checked
 * after normalization, so a crafted escape can never resolve outside the
 * root even on Windows-style separators.
 */
export function resolveWorkspacePath(workspaceRoot: string, clientPath: string): string {
  if (!clientPath || typeof clientPath !== "string") {
    throw new WorkspaceError("INVALID_PATH", "path is required and must be a relative workspace path");
  }
  if (path.isAbsolute(clientPath)) {
    throw new WorkspaceError("PATH_OUTSIDE_WORKSPACE", "absolute client paths are never accepted");
  }
  const rootReal = path.resolve(workspaceRoot);
  const candidate = path.resolve(rootReal, clientPath);
  const rel = path.relative(rootReal, candidate);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new WorkspaceError("PATH_OUTSIDE_WORKSPACE", "path escapes the granted workspace root");
  }
  const segments = rel.split(path.sep);
  for (const seg of segments) {
    if (EXCLUDED_DIRS.has(seg)) {
      throw new WorkspaceError("ACCESS_DENIED", `directory '${seg}' is never readable through this surface`);
    }
    for (const pattern of EXCLUDED_FILE_PATTERNS) {
      if (pattern.test(seg)) {
        throw new WorkspaceError("ACCESS_DENIED", `path segment '${seg}' matches a denied file pattern`);
      }
    }
  }
  return candidate;
}

/**
 * Real code.read: bounded, utf-8 read of a file inside the granted root.
 * Returns content + byte/line meta; never returns file content from an
 * excluded path (the guard runs BEFORE the open).
 */
export async function readWorkspaceFile(
  workspaceRoot: string,
  payload: { path: string; startLine?: number; maxBytes?: number },
): Promise<{ relPath: string; content: string; bytes: number; truncated: boolean }> {
  const absPath = resolveWorkspacePath(workspaceRoot, payload.path);
  const maxBytes = Math.min(Math.max(payload.maxBytes ?? MAX_READ_BYTES, 1), MAX_READ_BYTES);
  const stat = await fs.stat(absPath).catch(() => {
    throw new WorkspaceError("NOT_FOUND", `no file at that path inside the granted workspace: ${payload.path}`);
  });
  if (!stat.isFile()) throw new WorkspaceError("ACCESS_DENIED", "path is not a regular file");
  if (stat.size > MAX_READ_BYTES) {
    throw new WorkspaceError("FILE_TOO_LARGE", `file exceeds the ${MAX_READ_BYTES}-byte read cap`);
  }
  const buf = await fs.readFile(absPath);
  const full = buf.subarray(0, maxBytes).toString("utf-8");
  const bytes = Math.min(buf.byteLength, maxBytes);
  const rel = path.relative(path.resolve(workspaceRoot), absPath);
  return { relPath: rel.split(path.sep).join("/"), content: full, bytes, truncated: bytes < buf.byteLength };
}
