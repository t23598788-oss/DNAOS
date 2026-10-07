/**
 * หน้าที่: the one real, persistent read/write path for
 * `ProviderAuthorizationRecord` — one row per (provider, connection_id).
 * Same append-only JSONL, "latest record per key wins" convention as
 * `connections/connection-registry/registry.ts` and
 * `credentials/registry/api-credential-registry.ts` — reused, not
 * reinvented.
 *
 * Input: `ProviderAuthorizationRecord` writes via `upsertRecord`.
 * Output: `createProviderAuthorizationStore`,
 * `findAuthorizationRecord`, `upsertAuthorizationRecord`,
 * `listAuthorizationRecords`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: never accept or persist a raw secret value — only
 * `credential_ref` (already reference-only) ever appears in a stored
 * record.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderAuthorizationRecord } from "./types";

const DEFAULT_DATA_DIR_RELATIVE = "connections/provider-authorization/data";
const FILENAME = "authorizations.jsonl";

export interface ProviderAuthorizationStore {
  findAuthorizationRecord(connection_id: string): ProviderAuthorizationRecord | null;
  upsertAuthorizationRecord(record: ProviderAuthorizationRecord): ProviderAuthorizationRecord;
  listAuthorizationRecords(): readonly ProviderAuthorizationRecord[];
}

export function createProviderAuthorizationStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE)
): ProviderAuthorizationStore {
  const file = join(baseDir, FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): ProviderAuthorizationRecord[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ProviderAuthorizationRecord);
  }

  function readLatest(): Map<string, ProviderAuthorizationRecord> {
    const latest = new Map<string, ProviderAuthorizationRecord>();
    for (const record of readAll()) latest.set(record.connection_id, record);
    return latest;
  }

  function appendEntry(entry: ProviderAuthorizationRecord): void {
    ensureFile();
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  return {
    findAuthorizationRecord(connection_id) {
      return readLatest().get(connection_id) ?? null;
    },
    upsertAuthorizationRecord(record) {
      appendEntry(record);
      return record;
    },
    listAuthorizationRecords() {
      return [...readLatest().values()];
    },
  };
}

const defaultStore = createProviderAuthorizationStore();

export function findAuthorizationRecord(connection_id: string): ProviderAuthorizationRecord | null {
  return defaultStore.findAuthorizationRecord(connection_id);
}
export function upsertAuthorizationRecord(record: ProviderAuthorizationRecord): ProviderAuthorizationRecord {
  return defaultStore.upsertAuthorizationRecord(record);
}
export function listAuthorizationRecords(): readonly ProviderAuthorizationRecord[] {
  return defaultStore.listAuthorizationRecords();
}
