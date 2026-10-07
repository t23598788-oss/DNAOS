/**
 * หน้าที่: let a running DNA OS process state which source revision it is
 * actually running — the one thing the delivery circuit could not answer
 * before (Railway knew the deployed commit; the process itself did not).
 *
 * The revision is only ever REPORTED, never invented. It is read from the
 * first real source that exists, in this order, and the source is reported
 * alongside it so a reader can tell a build-injected value from a local
 * working-tree one:
 *   1. RAILWAY_GIT_COMMIT_SHA   — injected by Railway for a GitHub-connected
 *                                 service; the deployed revision itself.
 *   2. DNA_OS_SOURCE_REVISION   — explicit override for any other host.
 *   3. the local git working tree — only when the process runs from one.
 * If none of those exist the revision is `null` with a stated reason. A null
 * revision is an honest "this process cannot prove what it is running", which
 * is information; a guessed revision would be a lie the whole circuit rests on.
 *
 * Input: none (reads env + the local git tree).
 * Output: RuntimeRevision.
 * Dependency ที่อนุญาต: node:child_process, node:process.
 * สิ่งที่ห้ามแตะ: ห้ามคืน revision ที่ไม่ได้มาจากแหล่งจริงสามแหล่งนี้ และ
 * ห้ามเดา/เติมค่าเพื่อให้ REVISION_MATCH ผ่าน.
 */
import { execFileSync } from "node:child_process";

export type RevisionSource = "RAILWAY_BUILD" | "EXPLICIT_ENV" | "LOCAL_GIT_WORKTREE" | "NONE";

export interface RuntimeRevision {
  readonly revision: string | null;
  readonly source: RevisionSource;
  /** Present only when revision is null — why this process cannot state its revision. */
  readonly reason: string | null;
  /** True only for LOCAL_GIT_WORKTREE with uncommitted changes: the running code is not exactly that commit. */
  readonly dirty: boolean;
}

const SHA = /^[0-9a-f]{40}$/;

function fromEnv(name: string, source: RevisionSource): RuntimeRevision | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!SHA.test(value)) return null;
  return { revision: value, source, reason: null, dirty: false };
}

export function readRuntimeRevision(): RuntimeRevision {
  const railway = fromEnv("RAILWAY_GIT_COMMIT_SHA", "RAILWAY_BUILD");
  if (railway) return railway;
  const explicit = fromEnv("DNA_OS_SOURCE_REVISION", "EXPLICIT_ENV");
  if (explicit) return explicit;

  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8", timeout: 5_000, maxBuffer: 1024 }).trim();
    if (!SHA.test(head)) {
      return { revision: null, source: "NONE", reason: `git rev-parse HEAD returned ${JSON.stringify(head)}, which is not a commit sha`, dirty: false };
    }
    let dirty = false;
    try {
      dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf-8", timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }).trim().length > 0;
    } catch { /* a status failure does not invalidate the revision itself */ }
    return { revision: head, source: "LOCAL_GIT_WORKTREE", reason: null, dirty };
  } catch {
    return {
      revision: null,
      source: "NONE",
      reason: "no RAILWAY_GIT_COMMIT_SHA, no DNA_OS_SOURCE_REVISION, and this process is not running from a git working tree",
      dirty: false,
    };
  }
}
