/**
 * หน้าที่: the append-only Change Detection log for Hostinger source
 * pointers — same convention as `connections/connection-registry/registry.ts`
 * and every other real store in this repo (JSONL, `appendFileSync`, mode
 * 0o600, "latest record per source_id wins" for lookups). Stores ONLY
 * what the Owner's task allowed: WHAT_CHANGED / WHEN_DETECTED /
 * SOURCE_POINTER / OLD_FINGERPRINT / NEW_FINGERPRINT / VERIFICATION_STATE
 * — never a copy of either version's raw content.
 *
 * Input: `ChangeLogEntry` (append), `source_id` (read).
 * Output: `appendChangeLogEntry`, `readLatestFingerprint`, `listChangeLog`.
 * Dependency ที่อนุญาต: node:fs, node:path.
 * สิ่งที่ห้ามแตะ: never accept or write a `raw_content`/`body`/`html`
 * field — this store's row shape has no such field, on purpose.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ChangeLogEntry {
  source_id: string;
  what_changed: "INITIAL_BASELINE" | "CONTENT_CHANGED" | "NO_CHANGE" | "FETCH_FAILED";
  when_detected: string;
  source_pointer: string;
  old_fingerprint: string | null;
  new_fingerprint: string | null;
  verification_state: "VERIFIED" | "PARTIAL" | "UNVERIFIED";
}

const DEFAULT_DATA_DIR = join(process.cwd(), "providers/hostinger/data");
const CHANGE_LOG_FILENAME = "change-log.jsonl";

function file(baseDir: string): string {
  return join(baseDir, CHANGE_LOG_FILENAME);
}

function ensureFile(baseDir: string): void {
  mkdirSync(baseDir, { recursive: true });
  const f = file(baseDir);
  if (!existsSync(f)) writeFileSync(f, "", "utf-8");
}

function readAll(baseDir: string = DEFAULT_DATA_DIR): ChangeLogEntry[] {
  ensureFile(baseDir);
  return readFileSync(file(baseDir), "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ChangeLogEntry);
}

export function appendChangeLogEntry(entry: ChangeLogEntry, baseDir: string = DEFAULT_DATA_DIR): void {
  ensureFile(baseDir);
  appendFileSync(file(baseDir), `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** Latest known fingerprint for a source, or null if never checked before — this is the ONLY durable trace of a prior fetch; the fetched content itself is never stored anywhere. */
export function readLatestFingerprint(source_id: string, baseDir: string = DEFAULT_DATA_DIR): string | null {
  const rows = readAll(baseDir).filter((r) => r.source_id === source_id);
  if (rows.length === 0) return null;
  return rows[rows.length - 1].new_fingerprint;
}

export function listChangeLog(baseDir: string = DEFAULT_DATA_DIR): readonly ChangeLogEntry[] {
  return readAll(baseDir);
}
