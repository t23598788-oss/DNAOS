/**
 * Path confinement for registered FILE_SYSTEM / GIT resources.
 * Rejects any path outside the resource logical root. Never returns raw Owner home paths.
 */

import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { repoRoot, resolve } from "./host-runtime";
import { resourceAbsoluteRoot } from "./resource-registry";
import type { LocalResourceV1 } from "./types";

export type PathResolveResult =
  | { ok: true; abs: string; logical: string; existed: boolean }
  | { ok: false; reason_code: "PATH_OUT_OF_SCOPE" | "PATH_NOT_FOUND" | "RESOURCE_HAS_NO_ROOT" | "SYMLINK_ESCAPE" };

function underRoot(abs: string, root: string): boolean {
  const a = resolve(abs);
  const r = resolve(root);
  return a === r || a.startsWith(`${r}${sep}`);
}

function rejectTraversal(logicalPath: string): boolean {
  const trimmed = logicalPath.replace(/^\/+/, "");
  return trimmed.includes("\0") || trimmed.split(/[/\\]/).includes("..");
}

function guardSymlink(abs: string, root: string): boolean {
  if (!existsSync(abs)) return true;
  const st = lstatSync(abs);
  if (!st.isSymbolicLink()) return true;
  try {
    return underRoot(realpathSync(abs), root);
  } catch {
    return false;
  }
}

export function resolveLogicalPath(resource: LocalResourceV1, logicalPath: string): PathResolveResult {
  return resolveLogicalTarget(resource, logicalPath, { must_exist: true });
}

export function resolveLogicalTarget(resource: LocalResourceV1, logicalPath: string, options: { readonly must_exist: boolean }): PathResolveResult {
  const root = resourceAbsoluteRoot(resource);
  if (!root) return { ok: false, reason_code: "RESOURCE_HAS_NO_ROOT" };
  if (rejectTraversal(logicalPath) || logicalPath.startsWith("/")) return { ok: false, reason_code: "PATH_OUT_OF_SCOPE" };
  const trimmed = logicalPath.replace(/^\/+/, "");
  const abs = resolve(root, trimmed);
  if (!underRoot(abs, root)) return { ok: false, reason_code: "PATH_OUT_OF_SCOPE" };
  if (!guardSymlink(abs, root) || !guardSymlink(dirname(abs), root)) return { ok: false, reason_code: "SYMLINK_ESCAPE" };
  if (options.must_exist && !existsSync(abs)) return { ok: false, reason_code: "PATH_NOT_FOUND" };
  return { ok: true, abs, logical: relative(root, abs).split(sep).join("/") || trimmed, existed: existsSync(abs) };
}

export function withinWriteScope(resource: LocalResourceV1, absDest: string): boolean {
  if (resource.write_scope.length === 0) return false;
  const root = resourceAbsoluteRoot(resource);
  if (!root || !underRoot(absDest, root)) return false;
  if (resource.write_scope.includes(resource.logical_root) || resource.write_scope.includes("*")) return true;
  return resource.write_scope.some((scope) => {
    const scopeAbs = scope.startsWith("/") ? scope : resolve(repoRoot(), scope);
    return underRoot(absDest, scopeAbs);
  });
}

export function classifyLocalFile(logical: string): "SECRET" | "CREDENTIAL" | "INTERNAL" {
  const lower = logical.toLowerCase();
  if (lower.includes("credential") || lower.endsWith(".env") || lower.includes("secret.key")) return "CREDENTIAL";
  if (lower.includes("secret")) return "SECRET";
  return "INTERNAL";
}

export function logicalRef(resourceId: string, logical: string): string {
  return `${resourceId}/${logical}`;
}

export function fileKind(abs: string): "file" | "directory" {
  return statSync(abs).isDirectory() ? "directory" : "file";
}
