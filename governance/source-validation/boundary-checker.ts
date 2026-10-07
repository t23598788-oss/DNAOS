/**
 * หน้าที่: `checkImportBoundaries()` — the real, mechanical Capability
 * Folder Law ข้อ 9 checker `./README.md`'s G-VAL-004 reserved but never
 * built ("สถานะ: ยังไม่มี mechanical checker ที่ตรวจ 4 ข้อนี้อัตโนมัติ").
 * Only the ข้อ 9 slice — "การเข้าถึง implementation ข้าม capability
 * folder ตรงๆ" — is implemented here; the other three G-VAL-004 gates
 * (new-capability-without-folder, out-of-scope new file, duplicate
 * capability) stay manual review, same as before.
 *
 * Same technique `reports/SYSTEM_JOINT_AND_SEARCH_WASTE_AUDIT_2026-08-22.md`'s
 * own `joint_graph.cjs` used and proved out on the whole repo (179 real
 * joints found, 91 real bypasses) — ported here as a real, importable
 * capability instead of a one-off scratch script: regex over
 * `import`/`export ... from` lines, resolve each relative specifier to a
 * real file, flag it when the source and resolved-target's top-two-path-
 * segment "capability folder" differ AND the resolved target is not a
 * `contract.ts`/`contracts/` shared-type file.
 *
 * Input: `filePaths?` — repo-relative paths to check. Omit to scan the
 * whole repo (matches the original audit script's default; used by a
 * future repo-wide remediation pass, never by `control/circuit-breaker/`,
 * which always passes a scoped list to keep its per-poll cost bounded to
 * one agent-host workspace).
 * Output: `readonly BoundaryViolation[]`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never widen "compliant target" beyond a literal
 * `contract.ts`/`contracts/` match — Rule 9's own text is exact, this
 * checker must not editorialize about what "close enough" means (see
 * the joint-map audit's own note that some `research-engine-adapter.ts`-
 * style imports are folder-README-documented single entry points under a
 * non-`contract.ts` name; this checker still flags them literally,
 * honestly — reconciling that nuance is a human call, not this file's).
 */

import { basenamePath, dirnamePath, fileExists, isDirectory, isFile, joinPath, listDirEntries, readFileUtf8, relativePath, repoRootDirname } from "./host-runtime";
import type { BoundaryViolation } from "./types";

const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", ".git", "tests", "__sandbox__", "test-fixtures", "data"]);

function capabilityOf(relPath: string): string {
  const parts = relPath.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function discoverAllTsFiles(root: string): string[] {
  const results: string[] = [];
  function walk(absDir: string): void {
    for (const entry of listDirEntries(absDir)) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry)) continue;
      const absPath = joinPath(absDir, entry);
      if (isDirectory(absPath)) {
        walk(absPath);
      } else if (isFile(absPath) && entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
        results.push(relativePath(root, absPath));
      }
    }
  }
  walk(root);
  return results;
}

const IMPORT_LINE_RE = /^\s*import\s+(type\s+)?(?:[^'"]+?from\s+)?["'](\.[^"']+)["']/;
const EXPORT_LINE_RE = /^\s*export\s+(type\s+)?(?:\{[^}]*\}|\*)\s+from\s+["'](\.[^"']+)["']/;

function resolveImport(root: string, fromRelFile: string, spec: string): string | null {
  const fromAbsDir = dirnamePath(joinPath(root, fromRelFile));
  const targetNoExt = joinPath(fromAbsDir, spec);
  const candidates = [`${targetNoExt}.ts`, `${targetNoExt}.tsx`, joinPath(targetNoExt, "index.ts"), targetNoExt];
  for (const candidate of candidates) {
    if (fileExists(candidate) && isFile(candidate)) return relativePath(root, candidate);
  }
  return null;
}

function extractImportSpecs(source: string): { spec: string }[] {
  const specs = new Map<string, true>();
  for (const line of source.split("\n")) {
    const match = IMPORT_LINE_RE.exec(line) ?? EXPORT_LINE_RE.exec(line);
    if (match) specs.set(match[2], true);
  }
  return Array.from(specs.keys()).map((spec) => ({ spec }));
}

function isCompliantTarget(toRelFile: string, toCapability: string): boolean {
  return /contract/i.test(basenamePath(toRelFile)) || toCapability.startsWith("contracts/");
}

export function checkImportBoundaries(filePaths?: readonly string[]): readonly BoundaryViolation[] {
  const root = repoRootDirname();
  const files = filePaths ?? discoverAllTsFiles(root);
  const violations: BoundaryViolation[] = [];

  for (const relFile of files) {
    const absFile = joinPath(root, relFile);
    if (!fileExists(absFile) || !isFile(absFile)) continue; // a file the caller named may have been deleted/renamed since — report nothing rather than guess.
    const source = readFileUtf8(absFile);
    const fromCapability = capabilityOf(relFile);

    for (const { spec } of extractImportSpecs(source)) {
      const toRelFile = resolveImport(root, relFile, spec);
      if (!toRelFile) continue; // dangling import — not this checker's job; a real `tsc --noEmit` run already catches that.
      const toCapability = capabilityOf(toRelFile);
      if (toCapability === fromCapability) continue; // same-capability internal wiring, not a boundary crossing.
      if (isCompliantTarget(toRelFile, toCapability)) continue;
      violations.push({ from_file: relFile, from_capability: fromCapability, to_file: toRelFile, to_capability: toCapability, import_specifier: spec });
    }
  }

  return violations;
}
