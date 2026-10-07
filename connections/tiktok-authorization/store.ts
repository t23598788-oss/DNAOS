/**
 * หน้าที่: read/write path จริงตัวเดียวของ `TiktokAuthorizationRecord` — หนึ่ง
 * row ต่อ connection_id, append-only JSONL, "record ล่าสุดต่อ key ชนะ" —
 * convention เดียวกับ `connections/provider-authorization/store.ts` และ
 * `connections/connection-registry/registry.ts` (ใช้ซ้ำ ไม่คิดใหม่)
 *
 * Input: `TiktokAuthorizationRecord` writes ผ่าน `upsertRecord`.
 * Output: `createTiktokAuthorizationStore`, `findRecord`, `upsertRecord`,
 *   `listRecords`.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: ห้ามรับหรือ persist ค่า secret ดิบ — record ที่เก็บมีได้เฉพาะ
 *   `credential_ref` (อ้างอิงล้วน) และ `code_verifier` ชั่วคราว (PKCE proof ที่
 *   authorize อะไรไม่ได้ด้วยตัวเอง) ห้ามมี access_token/refresh_token.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TiktokAuthorizationRecord } from "./types";

const DEFAULT_DATA_DIR_RELATIVE = "connections/tiktok-authorization/data";
const FILENAME = "authorizations.jsonl";

export interface TiktokAuthorizationStore {
  findRecord(connection_id: string): TiktokAuthorizationRecord | null;
  upsertRecord(record: TiktokAuthorizationRecord): TiktokAuthorizationRecord;
  listRecords(): readonly TiktokAuthorizationRecord[];
}

/** ยามป้องกันเชิงโครงสร้าง: ต่อให้มีบั๊กที่อื่น token ดิบก็เข้าไฟล์ไม่ได้ */
function assertNoRawSecret(record: TiktokAuthorizationRecord): void {
  const forbidden = ["access_token", "refresh_token", "client_secret"];
  for (const key of Object.keys(record)) {
    if (forbidden.includes(key)) throw new Error(`REFUSING_TO_PERSIST_SECRET: field "${key}" must never be stored`);
  }
}

export function createTiktokAuthorizationStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE)
): TiktokAuthorizationStore {
  const file = join(baseDir, FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): TiktokAuthorizationRecord[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TiktokAuthorizationRecord);
  }

  function readLatest(): Map<string, TiktokAuthorizationRecord> {
    const latest = new Map<string, TiktokAuthorizationRecord>();
    for (const record of readAll()) latest.set(record.connection_id, record);
    return latest;
  }

  return {
    findRecord(connection_id) {
      return readLatest().get(connection_id) ?? null;
    },
    upsertRecord(record) {
      assertNoRawSecret(record);
      ensureFile();
      appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      return record;
    },
    listRecords() {
      return [...readLatest().values()];
    },
  };
}

const defaultStore = createTiktokAuthorizationStore();

export function findRecord(connection_id: string): TiktokAuthorizationRecord | null {
  return defaultStore.findRecord(connection_id);
}
export function upsertRecord(record: TiktokAuthorizationRecord): TiktokAuthorizationRecord {
  return defaultStore.upsertRecord(record);
}
export function listRecords(): readonly TiktokAuthorizationRecord[] {
  return defaultStore.listRecords();
}
