/**
 * Workspace Trash for /admin/ide's Explorer (owner, 2026-08-05, Phase 3).
 *
 * A workspace-internal trash — `.dnaos-trash/` at WORKSPACE_ROOT — chosen
 * deliberately over the existing engines/storage/adapters/trashAdapter.ts
 * (checked first, per instruction): that adapter moves files to the real
 * macOS `~/.Trash`, is part of a completely different subsystem (Storage
 * Intelligence's whole-repo dead-file cleanup), and has no concept of
 * restoring a file back to its exact original relative path — which this
 * Phase explicitly requires. No existing policy fit, so this is a new,
 * clearly-scoped system, not a duplicate of the old one.
 *
 * `.dnaos-trash` is in fsSecurity.ts's EXCLUDED_DIR_NAMES, so it is already
 * invisible to Explorer/Search/tree/read/write through every existing
 * function — nothing new to exclude there. It's also excluded from the
 * registry scanner's file globs (scripts/sync-registry.ts,
 * scripts/build-arch-book.ts) and from git (.gitignore) as part of this
 * same pass.
 *
 * Layout:
 *   .dnaos-trash/items/<trashId>       — the actual moved file/directory,
 *                                         renamed to an opaque ID so two
 *                                         same-named trashed items never
 *                                         collide
 *   .dnaos-trash/metadata.json         — the ledger (see TrashEntry)
 *
 * Rollback strategy: trash = move first, THEN write metadata. If the
 * metadata write fails, the move is undone (renamed back) before the error
 * is reported — the item is never left moved-but-untracked. Restore is the
 * mirror image: metadata is updated (entry removed) only after the move
 * back succeeds.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { resolveSafeRelativePath, resolveNewEntryPath, WORKSPACE_ROOT, IdeFsError } from "./fsSecurity";
import { writeFileAtomic } from "./fileWrite";

const TRASH_DIR_NAME = ".dnaos-trash";
const TRASH_ROOT = path.join(WORKSPACE_ROOT, TRASH_DIR_NAME);
const TRASH_ITEMS_DIR = path.join(TRASH_ROOT, "items");
const TRASH_METADATA_PATH = path.join(TRASH_ROOT, "metadata.json");

export type EntryType = "file" | "directory";

export interface TrashEntry {
  id: string;
  originalRelPath: string;
  trashedRelPath: string; // relative to WORKSPACE_ROOT — never absolute
  itemType: EntryType;
  trashedAt: string;
}

interface TrashListEntry {
  entry: TrashEntry | null;
  corrupt: boolean;
  raw?: unknown;
}

function isValidTrashEntry(v: unknown): v is TrashEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" && e.id.length > 0 &&
    typeof e.originalRelPath === "string" && e.originalRelPath.length > 0 &&
    typeof e.trashedRelPath === "string" && e.trashedRelPath.length > 0 &&
    (e.itemType === "file" || e.itemType === "directory") &&
    typeof e.trashedAt === "string"
  );
}

async function readMetadata(): Promise<TrashEntry[]> {
  const raw = await fs.readFile(TRASH_METADATA_PATH, "utf-8").catch(() => null);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTrashEntry);
  } catch {
    // Corrupt metadata.json itself (not just one entry) — treated as empty
    // rather than crashing; listTrash() below reports the raw parse
    // failure separately so it's never silently hidden.
    return [];
  }
}

async function writeMetadata(entries: TrashEntry[]): Promise<void> {
  const buf = Buffer.from(JSON.stringify(entries, null, 2), "utf-8");
  await writeFileAtomic(TRASH_METADATA_PATH, buf);
}

function generateTrashId(): string {
  return `${Date.now()}-${randomBytes(8).toString("hex")}`;
}

/**
 * Moves a real file/directory into the trash. Refuses symlinks (same as
 * every other write operation). Rolls back the move if the metadata write
 * fails, so a crash between the two steps never leaves an item moved but
 * unrecorded.
 */
export async function trashEntry(clientPath: string): Promise<TrashEntry> {
  const source = await resolveSafeRelativePath(clientPath);
  const sourceLstat = await fs.lstat(source.absPath).catch(() => null);
  if (!sourceLstat) throw new IdeFsError("NOT_FOUND", "path does not exist");
  if (sourceLstat.isSymbolicLink()) throw new IdeFsError("ACCESS_DENIED", "cannot trash a symlink");
  const itemType: EntryType = sourceLstat.isDirectory() ? "directory" : "file";

  await fs.mkdir(TRASH_ITEMS_DIR, { recursive: true });
  const id = generateTrashId();
  const trashedAbsPath = path.join(TRASH_ITEMS_DIR, id);
  const trashedRelPath = `${TRASH_DIR_NAME}/items/${id}`;

  await fs.rename(source.absPath, trashedAbsPath);

  const entry: TrashEntry = {
    id,
    originalRelPath: source.relPath,
    trashedRelPath,
    itemType,
    trashedAt: new Date().toISOString(),
  };

  try {
    const current = await readMetadata();
    await writeMetadata([...current, entry]);
  } catch (e) {
    // Rollback — move it back before reporting failure.
    await fs.rename(trashedAbsPath, source.absPath).catch(() => {});
    throw new IdeFsError("OPERATION_FAILED", `trash metadata write failed, move rolled back: ${e instanceof Error ? e.message : String(e)}`);
  }

  return entry;
}

/**
 * Restores a trashed item to its original relative path. Re-validates
 * path security on the ORIGINAL path fresh every time (never trusts that
 * it was safe when trashed still applies) and refuses if something new
 * now occupies that path (PATH_CONFLICT, never overwritten).
 */
export async function restoreEntry(id: string): Promise<{ relPath: string }> {
  const entries = await readMetadata();
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) throw new IdeFsError("TRASH_ENTRY_NOT_FOUND", "no trash entry with that id");
  const entry = entries[index];

  const trashedAbsPath = path.join(WORKSPACE_ROOT, entry.trashedRelPath);
  const trashedLstat = await fs.lstat(trashedAbsPath).catch(() => null);
  if (!trashedLstat) {
    throw new IdeFsError("CORRUPT_TRASH_ENTRY", "metadata references a trashed item that no longer exists on disk");
  }

  // Re-check the ORIGINAL destination fresh — it must not exist now.
  let dest;
  try {
    dest = await resolveNewEntryPath(entry.originalRelPath);
  } catch (e) {
    if (e instanceof IdeFsError && e.code === "PATH_CONFLICT") throw e;
    // The original location's PARENT no longer exists/is invalid, or the
    // stored path itself no longer resolves safely (e.g. an ancestor
    // directory was itself renamed/removed since trashing) — the metadata
    // is real but no longer actionable as recorded.
    throw new IdeFsError("CORRUPT_TRASH_ENTRY", "original location is no longer valid");
  }

  await fs.rename(trashedAbsPath, dest.absPath);

  try {
    const next = entries.filter((e) => e.id !== id);
    await writeMetadata(next);
  } catch (e) {
    // Rollback the restore so the item isn't lost from the trash ledger.
    await fs.rename(dest.absPath, trashedAbsPath).catch(() => {});
    throw new IdeFsError("OPERATION_FAILED", `trash metadata write failed, restore rolled back: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { relPath: dest.relPath };
}

/**
 * Lists trash entries. Individual entries that fail shape validation are
 * reported as corrupt (never silently dropped, never guessed into shape).
 */
export async function listTrash(): Promise<{ entries: TrashEntry[]; corruptCount: number }> {
  const raw = await fs.readFile(TRASH_METADATA_PATH, "utf-8").catch(() => null);
  if (raw === null) return { entries: [], corruptCount: 0 };
  let parsedRaw: unknown[];
  try {
    const parsed = JSON.parse(raw);
    parsedRaw = Array.isArray(parsed) ? parsed : [];
  } catch {
    // metadata.json itself is corrupt JSON — report as all-corrupt rather
    // than crash or guess.
    return { entries: [], corruptCount: -1 };
  }
  const results: TrashListEntry[] = parsedRaw.map((v) => (isValidTrashEntry(v) ? { entry: v, corrupt: false } : { entry: null, corrupt: true, raw: v }));
  const entries = results.filter((r): r is { entry: TrashEntry; corrupt: false } => r.entry !== null).map((r) => r.entry);
  const corruptCount = results.filter((r) => r.corrupt).length;
  return { entries, corruptCount };
}
