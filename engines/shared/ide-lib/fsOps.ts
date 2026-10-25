/**
 * Real file/folder management for /admin/ide's Explorer (owner, 2026-08-05,
 * Phase 3). Create/Rename/Move only — no permanent delete anywhere in this
 * file (that's ./trash.ts's job). Every operation validates through
 * fsSecurity.ts's resolveSafeRelativePath()/resolveNewEntryPath() — the
 * exact same functions reads use — so a write can never reach a path a
 * read couldn't, and a new entry can never be created with an excluded or
 * invalid name.
 */
import { promises as fs } from "fs";
import path from "path";
import { resolveSafeRelativePath, resolveNewEntryPath, isValidEntryName, IdeFsError } from "./fsSecurity";

export type EntryType = "file" | "directory";

export async function createFile(clientPath: string): Promise<{ relPath: string }> {
  const { absPath, relPath } = await resolveNewEntryPath(clientPath);
  try {
    // "wx" = exclusive create, fails if it now exists (closes the race
    // between the PATH_CONFLICT check above and this write). Mode 0o644 —
    // the same safe default every other file this project creates uses,
    // not a new/looser policy.
    await fs.writeFile(absPath, "", { flag: "wx", mode: 0o644 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EEXIST") throw new IdeFsError("PATH_CONFLICT", "a file or folder already exists at that path");
    throw new IdeFsError("OPERATION_FAILED", err.message ?? "failed to create file");
  }
  return { relPath };
}

export async function createFolder(clientPath: string): Promise<{ relPath: string }> {
  const { absPath, relPath } = await resolveNewEntryPath(clientPath);
  try {
    // recursive: false — this creates exactly one directory; it never
    // silently creates missing parent directories from a deep client path
    // (resolveNewEntryPath already required the parent to exist for real).
    await fs.mkdir(absPath, { recursive: false, mode: 0o755 });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EEXIST") throw new IdeFsError("PATH_CONFLICT", "a file or folder already exists at that path");
    if (err.code === "ENOENT") throw new IdeFsError("NOT_FOUND", "parent directory does not exist");
    throw new IdeFsError("OPERATION_FAILED", err.message ?? "failed to create folder");
  }
  return { relPath };
}

export interface MoveResult {
  sourceRelPath: string;
  destRelPath: string;
  itemType: EntryType;
}

/**
 * Shared engine for both Rename and Move (a rename is just a move within
 * the same parent directory) — real `fs.rename()`, atomic on the same
 * filesystem, nothing else. Refuses: a source that doesn't exist, a
 * source that IS a symlink, a destination that already exists, and moving
 * a directory into itself or one of its own descendants. A cross-device
 * rename (EXDEV) is refused outright rather than falling back to a
 * copy+delete — an explicit Phase 3 instruction, not an oversight.
 */
export async function moveEntry(sourceClientPath: string, destClientPath: string): Promise<MoveResult> {
  const source = await resolveSafeRelativePath(sourceClientPath);
  const sourceLstat = await fs.lstat(source.absPath).catch(() => null);
  if (!sourceLstat) throw new IdeFsError("NOT_FOUND", "source does not exist");
  if (sourceLstat.isSymbolicLink()) throw new IdeFsError("ACCESS_DENIED", "cannot move a symlink");
  const itemType: EntryType = sourceLstat.isDirectory() ? "directory" : "file";

  const dest = await resolveNewEntryPath(destClientPath);

  if (itemType === "directory") {
    const srcWithSep = source.absPath + path.sep;
    if (dest.absPath === source.absPath || dest.absPath.startsWith(srcWithSep)) {
      throw new IdeFsError("INVALID_MOVE", "cannot move a directory into itself or one of its own descendants");
    }
  }

  try {
    await fs.rename(source.absPath, dest.absPath);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EXDEV") {
      throw new IdeFsError("OPERATION_FAILED", "cross-device rename is not supported in this phase — no copy/delete fallback is performed");
    }
    throw new IdeFsError("OPERATION_FAILED", err.message ?? "move failed");
  }

  return { sourceRelPath: source.relPath, destRelPath: dest.relPath, itemType };
}

/** Rename = move within the same parent directory, new basename only. */
export async function renameEntry(clientPath: string, newName: string): Promise<MoveResult> {
  // newName must be a single path segment — a rename is a basename swap,
  // never a disguised move. Rejecting this here (rather than letting it
  // fall through to resolveNewEntryPath) keeps the error INVALID_NAME
  // instead of a misleading NOT_FOUND from a bogus intermediate "parent".
  if (!isValidEntryName(newName)) {
    throw new IdeFsError("INVALID_NAME", "invalid file or folder name");
  }
  const parentRel = path.dirname(clientPath.replace(/\/+$/, ""));
  const destClientPath = parentRel === "." ? newName : `${parentRel}/${newName}`;
  return moveEntry(clientPath, destClientPath);
}

/** Move = same basename, different parent directory. */
export async function moveEntryToDirectory(clientPath: string, destinationDirClientPath: string): Promise<MoveResult> {
  const name = path.basename(clientPath.replace(/\/+$/, ""));
  const destClientPath = destinationDirClientPath === "" ? name : `${destinationDirClientPath}/${name}`;
  return moveEntry(clientPath, destClientPath);
}
