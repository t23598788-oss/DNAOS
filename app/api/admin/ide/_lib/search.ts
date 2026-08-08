/**
 * Real search logic for /admin/ide's Search panel (owner, 2026-08-05,
 * checkpoint refactor). Extracted out of search/route.ts so the regression
 * suite exercises the exact function production traffic runs. No shell,
 * no exec/spawn, no grep/ripgrep — a pure-JS line scan over files pulled
 * lazily from fsSecurity.ts's walkWorkspaceFiles(), bounded by a result
 * cap, a file-scan cap, and a wall-clock time budget.
 */
import { promises as fs } from "fs";
import { resolveSafeRelativePath, walkWorkspaceFiles, looksBinary, MAX_FILE_BYTES, IdeFsError } from "./fsSecurity";

export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 200;
export const MAX_RESULTS = 200;
export const MAX_FILES_SCANNED = 5000;
export const TIME_BUDGET_MS = 4000;
const PREVIEW_MAX_LENGTH = 240;

export interface SearchResult {
  relativePath: string;
  line: number;
  column: number;
  preview: string;
  matchLength: number;
}
export interface SearchOutcome {
  path: string;
  results: SearchResult[];
  filesScanned: number;
  truncated: boolean;
  truncationReason: "SEARCH_LIMIT_REACHED" | "SEARCH_TIMEOUT" | null;
  durationMs: number;
}

/** Throws IdeFsError (INVALID_QUERY / path errors) before scanning starts.
 * `signal` lets an HTTP caller abort mid-scan; optional for direct/test use. */
export async function performSearch(query: string, clientPath: string, signal?: AbortSignal): Promise<SearchOutcome> {
  const startedAt = Date.now();
  if (query.length < MIN_QUERY_LENGTH) throw new IdeFsError("INVALID_QUERY", `query must be at least ${MIN_QUERY_LENGTH} characters`);
  if (query.length > MAX_QUERY_LENGTH) throw new IdeFsError("INVALID_QUERY", `query must be at most ${MAX_QUERY_LENGTH} characters`);

  const { relPath: startRelPath } = await resolveSafeRelativePath(clientPath);

  const needle = query.toLowerCase();
  const results: SearchResult[] = [];
  const deadline = startedAt + TIME_BUDGET_MS;
  let filesScanned = 0;
  let truncated = false;
  let truncationReason: SearchOutcome["truncationReason"] = null;

  walkLoop:
  for await (const file of walkWorkspaceFiles(startRelPath)) {
    if (signal?.aborted) break;
    if (Date.now() > deadline) { truncated = true; truncationReason = "SEARCH_TIMEOUT"; break; }
    filesScanned++;
    if (filesScanned > MAX_FILES_SCANNED) { truncated = true; truncationReason = "SEARCH_LIMIT_REACHED"; break; }

    const stat = await fs.stat(file.absPath).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    const buf = await fs.readFile(file.absPath).catch(() => null);
    if (!buf || looksBinary(buf)) continue;

    const lines = buf.toString("utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, "");
      const lowerLine = line.toLowerCase();
      let fromIndex = 0;
      while (true) {
        const idx = lowerLine.indexOf(needle, fromIndex);
        if (idx === -1) break;
        results.push({
          relativePath: file.relPath,
          line: i + 1,
          column: idx + 1,
          preview: line.length > PREVIEW_MAX_LENGTH ? `${line.slice(0, PREVIEW_MAX_LENGTH)}…` : line,
          matchLength: query.length,
        });
        if (results.length >= MAX_RESULTS) { truncated = true; truncationReason = "SEARCH_LIMIT_REACHED"; break walkLoop; }
        fromIndex = idx + needle.length;
      }
    }
  }

  return { path: startRelPath, results, filesScanned, truncated, truncationReason, durationMs: Date.now() - startedAt };
}
