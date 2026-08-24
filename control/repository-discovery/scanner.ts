/**
 * หน้าที่: `runDiscovery()` — the one file in this capability folder
 * allowed to touch the real filesystem (`node:fs`, `node:crypto`), same
 * isolation pattern as `../../software/registry-database/adapters/
 * persistent-file-store.ts`. Walks the real repository tree from a given
 * root, hard-pruning `node_modules/` and `.git/` (never descended into,
 * never appear in the inventory at all — the only two exclusions
 * unambiguous enough in this repo to prune by name; every other file is
 * walked and classified by `./rules.ts`, never silently dropped). Never
 * writes, renames, or deletes anything — read-only, always.
 *
 * Input: `repoRoot` (absolute path).
 * Output: `runDiscovery` -> `DiscoveryInventory`.
 * Dependency ที่อนุญาต: node:fs, node:path, node:crypto, ./rules.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never call fs.writeFile/unlink/rename here — this file only
 * reads. Never widen EXCLUDED_DIR_NAMES with a guessed name — node_modules
 * and .git are the only two unambiguous, universal exclusions; every other
 * directory in this repo (including e.g. execution/build/, a real source
 * folder despite its name) is walked and classified on its actual content,
 * never pruned by a name guess.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { classifyFile, isHidden } from "./rules";
import type { DiscoveryInventory, DiscoveryRecord, DuplicateGroup, FileKind, FileKindTotals } from "./types";

const EXCLUDED_DIR_NAMES: readonly string[] = ["node_modules", ".git"];

const ALL_KINDS: readonly FileKind[] = ["SOURCE_CODE", "TEST", "MIGRATION", "CONFIG", "DOCUMENTATION", "DATA", "RUNTIME_DATA", "GENERATED", "TEMP", "UNKNOWN"];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function sha256File(absolutePath: string): string {
  const buffer = readFileSync(absolutePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function walk(dir: string, repoRoot: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.includes(entry.name)) continue;
      walk(join(dir, entry.name), repoRoot, out);
      continue;
    }
    if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
    // symlinks and other special entry kinds are neither a directory nor a
    // regular file here — deliberately never followed, never counted.
  }
}

function buildRecord(absolutePath: string, repoRoot: string, discoveredAt: string): DiscoveryRecord {
  const relativePath = toPosix(relative(repoRoot, absolutePath));
  const fileName = relativePath.split("/").pop()!;
  const rawExt = extname(fileName);
  const extension = rawExt.startsWith(".") ? rawExt.slice(1).toLowerCase() : "";
  const stats = statSync(absolutePath);
  const contentHash = sha256File(absolutePath);
  const detectedFileKind = classifyFile(relativePath, fileName, extension);
  const discoveryId = `discovery-${createHash("sha256").update(relativePath).digest("hex").slice(0, 24)}`;

  return {
    discovery_id: discoveryId,
    relative_path: relativePath,
    file_name: fileName,
    extension,
    size_bytes: stats.size,
    content_hash: contentHash,
    detected_file_kind: detectedFileKind,
    is_source: detectedFileKind === "SOURCE_CODE",
    is_test: detectedFileKind === "TEST",
    is_documentation: detectedFileKind === "DOCUMENTATION",
    is_migration: detectedFileKind === "MIGRATION",
    is_runtime_data: detectedFileKind === "RUNTIME_DATA",
    is_generated: detectedFileKind === "GENERATED",
    is_temp: detectedFileKind === "TEMP",
    is_hidden: isHidden(fileName),
    discovered_at: discoveredAt,
  };
}

function groupDuplicates(records: readonly DiscoveryRecord[], keyOf: (r: DiscoveryRecord) => string): DuplicateGroup[] {
  const byKey = new Map<string, string[]>();
  for (const record of records) {
    const key = keyOf(record);
    const list = byKey.get(key);
    if (list) list.push(record.relative_path);
    else byKey.set(key, [record.relative_path]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, paths] of byKey) {
    if (paths.length > 1) groups.push({ key, relative_paths: paths.sort() });
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

export function runDiscovery(repoRoot: string): DiscoveryInventory {
  const scannedAt = new Date().toISOString();
  const absolutePaths: string[] = [];
  walk(repoRoot, repoRoot, absolutePaths);

  const records = absolutePaths.map((p) => buildRecord(p, repoRoot, scannedAt)).sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  const totalsByKind: Record<FileKind, number> = Object.fromEntries(ALL_KINDS.map((k) => [k, 0])) as Record<FileKind, number>;
  for (const record of records) totalsByKind[record.detected_file_kind] += 1;

  return {
    repo_root: repoRoot,
    scanned_at: scannedAt,
    excluded_directories: EXCLUDED_DIR_NAMES,
    total_files_discovered: records.length,
    totals_by_kind: totalsByKind,
    duplicate_content_hash_groups: groupDuplicates(records, (r) => r.content_hash),
    duplicate_file_name_groups: groupDuplicates(records, (r) => r.file_name),
    records,
  };
}
