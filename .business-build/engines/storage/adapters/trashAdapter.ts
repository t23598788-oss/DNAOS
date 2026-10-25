/**
 * Storage Intelligence — macOS Trash adapter. THE ONLY code in this
 * capability permitted to move a file. No rm, no rm -rf, no unlink, no
 * Empty Trash — moves only, always reversible by the user via Finder.
 *
 * Called exclusively from engines/storage/engine.ts's moveSafeToTrash(),
 * and only for resources already in state SAFE (engines/storage/decisionEngine.ts
 * is the sole place that ever sets SAFE).
 */
import { existsSync, mkdirSync, renameSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const TRASH_DIR = join(homedir(), ".Trash");

export interface TrashMoveResult {
  from_path: string;
  trash_path: string;
  moved_at: string;
}

export function moveToTrash(filePath: string): TrashMoveResult {
  if (!existsSync(TRASH_DIR)) mkdirSync(TRASH_DIR, { recursive: true });
  let dest = join(TRASH_DIR, basename(filePath));
  if (existsSync(dest)) {
    dest = join(TRASH_DIR, `${Date.now()}-${basename(filePath)}`);
  }
  renameSync(filePath, dest);
  return { from_path: filePath, trash_path: dest, moved_at: new Date().toISOString() };
}
