/**
 * Path guard: canonicalize, resolve symlinks, verify worktree + task scope.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { interpretAgentPath } from "./task-scope";
import type { CanonicalAgentScope, PathGuardResult } from "./types";

function deepestExisting(path: string): string {
  let current = resolve(path);
  for (;;) {
    if (existsSync(current)) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function realpathIfExists(path: string): string {
  try {
    if (existsSync(path)) return realpathSync(path);
  } catch {
    /* fall through */
  }
  return resolve(path);
}

export function pathInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = realpathIfExists(root);
  const existing = deepestExisting(candidate);
  let resolvedCandidate = resolve(candidate);
  try {
    if (existsSync(existing)) {
      const existingReal = realpathSync(existing);
      const tail = resolve(candidate).slice(resolve(existing).length);
      resolvedCandidate = existingReal + tail;
    }
  } catch {
    resolvedCandidate = resolve(candidate);
  }
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}

function resolveAgainstWorktree(scope: CanonicalAgentScope, requested: string): string | null {
  if (requested.startsWith("/") || requested.split(/[\\/]/).includes("..")) return null;
  const interpreted = interpretAgentPath(scope, requested);
  const existing = deepestExisting(interpreted);
  try {
    if (existsSync(existing) && lstatSync(existing).isSymbolicLink()) {
      const target = realpathSync(existing);
      if (!pathInsideRoot(scope.worktree_path, target)) return null;
    }
  } catch {
    return null;
  }
  if (!pathInsideRoot(scope.worktree_path, interpreted)) return null;
  return existsSync(interpreted) ? realpathIfExists(interpreted) : interpreted;
}

export function guardReadPath(scope: CanonicalAgentScope, requested: string): PathGuardResult {
  const resolved = resolveAgainstWorktree(scope, requested);
  if (!resolved) return { ok: false, reason: "PATH_SCOPE_DENIED", detail: "absolute, traversal, or symlink escape" };
  for (const sibling of scope.sibling_worktrees_denied) {
    if (pathInsideRoot(sibling, resolved) && !pathInsideRoot(scope.worktree_path, resolved)) {
      return { ok: false, reason: "PATH_SCOPE_DENIED", detail: "protected sibling worktree" };
    }
  }
  return { ok: true, resolved_path: resolved };
}

export function guardWritePath(scope: CanonicalAgentScope, requested: string): PathGuardResult {
  if (!scope.write_allowed || !scope.safe_for_current_execution) {
    return { ok: false, reason: "SNAPSHOT_MUTATION_DENIED", detail: "workspace is not a mutation target" };
  }
  const read = guardReadPath(scope, requested);
  if (!read.ok) return read;
  const resolved = read.resolved_path!;
  const allowed = scope.write_allowed_paths.some((root) => pathInsideRoot(root, resolved));
  if (!allowed) return { ok: false, reason: "PATH_SCOPE_DENIED", detail: "outside write_allowed_paths" };
  const rel = relative(realpathIfExists(scope.worktree_path), resolved);
  if (rel.split(sep).includes(".git")) {
    return { ok: false, reason: "PATH_SCOPE_DENIED", detail: ".git is protected" };
  }
  return { ok: true, resolved_path: resolved };
}
