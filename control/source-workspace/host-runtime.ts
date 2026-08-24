/**
 * หน้าที่: the ONLY file in this capability folder allowed to touch a real
 * host ambient (child process, filesystem, clock) — real `git worktree`
 * commands via `execFile`, same real, already-precedented pattern as
 * `connections/connection-registry/git-discovery.ts`'s own `execFile(git,
 * ...)` calls (never through `execution/run/`, which is Owner-hard-blocked
 * from any `control/` import — see ../README.md).
 *
 * Input: none.
 * Output: `runGit`, `nowIso`, `dirnameOf`, `joinPath`.
 * Dependency ที่อนุญาต: node:child_process, node:util, node:path.
 * สิ่งที่ห้ามแตะ: never invoke `git` with a caller-supplied raw string —
 * every argv element is a fixed literal or a value already validated by
 * ./resolver.ts (branch_ref/worktree_path are always derived here, never
 * caller-supplied verbatim).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

const run = promisify(execFile);
const GIT = "git";

export type GitCommandOutcome = { ok: true; stdout: string } | { ok: false; reason: string };

export async function runGit(args: readonly string[], cwd: string): Promise<GitCommandOutcome> {
  try {
    const result = await run(GIT, [...args], { cwd, maxBuffer: 64 * 1024 });
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return { ok: false, reason: e.stderr?.trim() || e.message || String(error) };
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function dirnameOf(path: string): string {
  return dirname(path);
}

export function joinPath(...parts: string[]): string {
  return join(...parts);
}

/** Every path handed to `git` (as a cwd or as an argv element) must be absolute — a relative worktree_path argument would otherwise be resolved by git's own subprocess relative to ITS cwd (repository_root), not the caller's, silently landing the real worktree somewhere other than what the caller's own relative-path joins expect. */
export function resolvePath(path: string): string {
  return resolve(path);
}
