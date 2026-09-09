/**
 * Pending Google Workspace authorization store — TikTok append-only discipline.
 * Never persist access_token / refresh_token / client_secret.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GoogleAuthorizationRecord } from "./types";

const DEFAULT_DATA_DIR_RELATIVE = "connections/google-workspace/oauth/data";
const FILENAME = "authorizations.jsonl";

export interface GoogleAuthorizationStore {
  findRecord(connection_id: string): GoogleAuthorizationRecord | null;
  upsertRecord(record: GoogleAuthorizationRecord): GoogleAuthorizationRecord;
  listRecords(): readonly GoogleAuthorizationRecord[];
}

function assertNoRawSecret(record: GoogleAuthorizationRecord): void {
  for (const key of Object.keys(record)) {
    if (key === "access_token" || key === "refresh_token" || key === "client_secret") {
      throw new Error(`REFUSING_TO_PERSIST_SECRET: field "${key}" must never be stored`);
    }
  }
}

export function createGoogleAuthorizationStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE),
): GoogleAuthorizationStore {
  const file = join(baseDir, FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): GoogleAuthorizationRecord[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GoogleAuthorizationRecord);
  }

  function readLatest(): Map<string, GoogleAuthorizationRecord> {
    const latest = new Map<string, GoogleAuthorizationRecord>();
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

const defaultStore = createGoogleAuthorizationStore();

export function findRecord(connection_id: string): GoogleAuthorizationRecord | null {
  return defaultStore.findRecord(connection_id);
}
export function upsertRecord(record: GoogleAuthorizationRecord): GoogleAuthorizationRecord {
  return defaultStore.upsertRecord(record);
}
export function listRecords(): readonly GoogleAuthorizationRecord[] {
  return defaultStore.listRecords();
}
