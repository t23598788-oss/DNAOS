/**
 * Path guard: canonicalize, resolve symlinks, verify worktree + task scope.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { canonicalizePath } from "./host-runtime";
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

function resolveAgainstReadRoots(scope: CanonicalAgentScope, requested: string): string | null {
  if (requested.split(/[\\/]/).includes("..")) return null;
  const roots = scope.read_allowed_paths.length > 0 ? scope.read_allowed_paths : [scope.worktree_path];
  const candidates: string[] = [];
  if (requested.startsWith("/")) {
    candidates.push(requested);
  } else {
    for (const root of roots) candidates.push(canonicalizePath(requested, root));
  }
  for (const interpreted of candidates) {
    const existing = deepestExisting(interpreted);
    try {
      if (existsSync(existing) && lstatSync(existing).isSymbolicLink()) {
        const target = realpathSync(existing);
        if (!roots.some((root) => pathInsideRoot(root, target))) continue;
      }
    } catch {
      continue;
    }
    if (!roots.some((root) => pathInsideRoot(root, interpreted))) continue;
    return existsSync(interpreted) ? realpathIfExists(interpreted) : interpreted;
  }
  return null;
}

export function guardReadPath(scope: CanonicalAgentScope, requested: string): PathGuardResult {
  const resolved = resolveAgainstReadRoots(scope, requested);
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
