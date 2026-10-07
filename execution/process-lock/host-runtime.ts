/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (filesystem, clock). The real atomicity primitive lives
 * here: `openSync(path, "wx")` maps to POSIX `open(2)` with
 * `O_CREAT | O_EXCL` — the kernel guarantees at most one caller across
 * any number of separate OS processes ever succeeds in creating the same
 * path; every other concurrent caller gets a real `EEXIST` error. This is
 * the actual cross-process guarantee this whole capability exists to
 * provide — not simulated, not an in-memory approximation.
 *
 * Input: none.
 * Output: `createLockFileExclusive`, `readLockFile`, `unlinkLockFile`,
 * `lockFilePath`, `nowIso`, `ensureLockDir`.
 * Dependency ที่อนุญาต: none — ambient declarations only.
 * สิ่งที่ห้ามแตะ: never widen this file to touch the network. Never
 * replace `"wx"` with a plain write — that is the one line the entire
 * cross-process guarantee depends on.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_LOCK_DIR = join(process.cwd(), "local-runtime/process-locks");

function sanitizeLockKey(lockKey: string): string {
  return lockKey.replace(/[^a-zA-Z0-9_:.-]/g, "_");
}

export function lockFilePath(lockKey: string, dir: string = DEFAULT_LOCK_DIR): string {
  return join(dir, `${sanitizeLockKey(lockKey)}.lock.json`);
}

export function ensureLockDir(dir: string = DEFAULT_LOCK_DIR): void {
  mkdirSync(dir, { recursive: true });
}

/** Real O_CREAT|O_EXCL create — throws with code "EEXIST" if the path already exists. This is the atomic operation. */
export function createLockFileExclusive(path: string, contents: string): { ok: true } | { ok: false; code: string } {
  try {
    const fd = openSync(path, "wx", 0o600);
    writeSync(fd, contents, null, "utf8");
    closeSync(fd);
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "UNKNOWN";
    return { ok: false, code };
  }
}

/** A plain (non-exclusive) overwrite — safe ONLY for a caller who has already verified it is the current, real holder (see ./resolver.ts's renewLock). Never used to claim a new lock. */
export function overwriteLockFile(path: string, contents: string): boolean {
  try {
    writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function readLockFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function unlinkLockFile(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export { DEFAULT_LOCK_DIR };
