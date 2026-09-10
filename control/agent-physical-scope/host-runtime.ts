/**
 * Path helpers for physical-scope. Audit/port stores live in audit.ts and
 * port-allocator.ts.
 */

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";

export function canonicalizePath(input: string, root: string): string {
  const combined = isAbsolute(input) ? input : join(root, input);
  return normalize(resolve(combined));
}

export function realExistingPath(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return realpathSync(path);
  } catch {
    return null;
  }
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function isInsideRoot(candidate: string, root: string): boolean {
  const realRoot = realExistingPath(root) ?? canonicalizePath(root, "/");
  const realCandidate = realExistingPath(candidate) ?? canonicalizePath(candidate, "/");
  const rel = relative(realRoot.endsWith(sep) ? realRoot : realRoot + sep, realCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
