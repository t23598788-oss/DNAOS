/**
 * หน้าที่: the private real-host surface for `control/work-resolution/` —
 * filesystem reads only. No network, no spawn, no writes.
 *
 * Input: none.
 * Output: `REPO_ROOT`, `pathExists`, `readTextIfPresent`, `listExports`,
 * `expandHome`.
 * Dependency ที่อนุญาต: node:fs, node:path, node:os, node:url.
 * สิ่งที่ห้ามแตะ: never add a write function here. Resolution observes the
 * system; it never mutates it. A resolver that can write could "fix" the
 * evidence it is supposed to be reporting.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(__dirname, "..", "..");

/** `~/x` -> `/Users/<you>/x`. Registry rows store home-relative paths. */
export function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** Absolute paths are checked as-is; anything else is resolved under the repo root. */
export function pathExists(path: string): boolean {
  const expanded = expandHome(path);
  return existsSync(expanded.startsWith("/") ? expanded : join(REPO_ROOT, expanded));
}

export function readTextIfPresent(path: string): string | null {
  const expanded = expandHome(path);
  const full = expanded.startsWith("/") ? expanded : join(REPO_ROOT, expanded);
  try {
    return existsSync(full) ? readFileSync(full, "utf-8") : null;
  } catch {
    return null;
  }
}

/**
 * The real exported names of a TS/JS module, read from source. Used to
 * fill `public_functions` from the file itself rather than from a
 * hand-maintained list that can drift.
 */
export function listExports(path: string): readonly string[] {
  const source = readTextIfPresent(path);
  if (source === null) return [];
  const names = new Set<string>();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(",")) {
      const name = part.split(/\s+as\s+/)[0].replace(/\btype\b/, "").trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}
