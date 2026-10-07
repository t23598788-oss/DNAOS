/**
 * หน้าที่: the GENERIC, provider-agnostic Change Detection log — same
 * append-only JSONL convention every real store in this repo already
 * uses (`connections/connection-registry/registry.ts`,
 * `providers/hostinger/live-check/change-log.ts`). Stores ONLY what
 * Section 3 (Owner correction) allows: source_id, detected_at,
 * old_fingerprint, new_fingerprint, change_type, verification_result —
 * never a copy of source content. One shared file across ALL providers
 * (keyed by `provider_id` prefix baked into each caller's `source_id`,
 * e.g. "digitalocean_..." / "hostinger_..."), so a second/third provider
 * never needs a second change-log implementation — Section 12's "GLOBAL
 * PROVIDER RULE."
 *
 * Input: `ChangeLogEntry` (append), `source_id` (read).
 * Output: `appendChangeLogEntry`, `listChangeLog`.
 * Dependency ที่อนุญาต: node:fs, node:path.
 * สิ่งที่ห้ามแตะ: never accept or write a `raw_content`/`body`/`html`/
 * `normalized_value` field — this store's row shape has no such field,
 * on purpose.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ChangeType = "INITIAL_BASELINE" | "CONTENT_CHANGED" | "NO_CHANGE" | "FETCH_FAILED";

export interface ChangeLogEntry {
  source_id: string;
  detected_at: string;
  old_fingerprint: string | null;
  new_fingerprint: string | null;
  change_type: ChangeType;
  verification_result: "DIRECT_FETCH_200" | "SHA256_FINGERPRINT" | "CONTRACT_SCHEMA_DIFF" | "MANUAL_REVIEW" | "UNVERIFIABLE_AUTOMATED";
}

const DEFAULT_DATA_DIR = join(process.cwd(), "providers/_shared/source-registry/data");
const FILENAME = "change-log.jsonl";

function file(baseDir: string): string {
  return join(baseDir, FILENAME);
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

export function listChangeLog(baseDir: string = DEFAULT_DATA_DIR): readonly ChangeLogEntry[] {
  return readAll(baseDir);
}

export function listChangeLogForSource(source_id: string, baseDir: string = DEFAULT_DATA_DIR): readonly ChangeLogEntry[] {
  return readAll(baseDir).filter((r) => r.source_id === source_id);
}
