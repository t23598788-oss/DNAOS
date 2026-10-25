/**
 * Real directory-listing logic for /admin/ide's Explorer (owner,
 * 2026-08-05, checkpoint refactor). Extracted out of tree/route.ts so the
 * regression suite (scripts/ide-regression-test.ts) exercises the exact
 * same function production traffic runs, never a re-implementation that
 * could quietly drift from it. Pure logic — no HTTP concerns.
 */
import { promises as fs } from "fs";
import { resolveSafeRelativePath, isExcludedName, IdeFsError } from "./fsSecurity";

export interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

/** One directory level, sorted directories-first then alphabetical. Throws
 * IdeFsError (NOT_FOUND / INVALID_PATH / ...) on any real failure. */
export async function listDirectory(clientPath: string): Promise<{ relPath: string; entries: TreeEntry[] }> {
  const { absPath, relPath } = await resolveSafeRelativePath(clientPath);

  const stat = await fs.stat(absPath).catch(() => null);
  if (!stat) throw new IdeFsError("NOT_FOUND", "path does not exist");
  if (!stat.isDirectory()) throw new IdeFsError("INVALID_PATH", "path is not a directory");

  const dirents = await fs.readdir(absPath, { withFileTypes: true });
  const entries: TreeEntry[] = dirents
    .filter((d) => !isExcludedName(d.name, d.isDirectory()))
    .map((d) => ({
      name: d.name,
      path: relPath ? `${relPath}/${d.name}` : d.name,
      type: d.isDirectory() ? ("directory" as const) : ("file" as const),
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1));

  return { relPath, entries };
}
