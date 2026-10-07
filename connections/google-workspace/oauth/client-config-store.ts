/**
 * Append-only store for admitted Google Workspace OAuth *client* public config.
 * Never persist client_secret / access_token / refresh_token.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GOOGLE_CONNECTION_ID } from "../contract";
import type { GoogleOauthClientConfigRecord } from "./client-config-types";

const DEFAULT_DATA_DIR_RELATIVE = "connections/google-workspace/oauth/data";
const FILENAME = "oauth-client-config.jsonl";

export interface GoogleOauthClientConfigStore {
  findLatest(): GoogleOauthClientConfigRecord | null;
  upsert(record: GoogleOauthClientConfigRecord): GoogleOauthClientConfigRecord;
}

function assertNoSecret(record: GoogleOauthClientConfigRecord): void {
  const blob = JSON.stringify(record);
  if (
    "client_secret" in (record as object) ||
    "google_oauth_client_secret" in (record as object) ||
    /"client_secret"\s*:/.test(blob) ||
    /"google_oauth_client_secret"\s*:/.test(blob)
  ) {
    throw new Error("REFUSING_TO_PERSIST_SECRET: client_secret must never be stored in oauth-client-config");
  }
  if (record.connection_id !== GOOGLE_CONNECTION_ID) {
    throw new Error("CONNECTION_ID_MISMATCH");
  }
}

export function createGoogleOauthClientConfigStore(
  baseDir: string = join(process.cwd(), DEFAULT_DATA_DIR_RELATIVE),
): GoogleOauthClientConfigStore {
  const file = join(baseDir, FILENAME);

  function ensureFile(): void {
    mkdirSync(baseDir, { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "", "utf-8");
  }

  function readAll(): GoogleOauthClientConfigRecord[] {
    ensureFile();
    return readFileSync(file, "utf-8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as GoogleOauthClientConfigRecord);
  }

  return {
    findLatest() {
      const rows = readAll();
      return rows.length > 0 ? rows[rows.length - 1]! : null;
    },
    upsert(record) {
      assertNoSecret(record);
      ensureFile();
      appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      return record;
    },
  };
}

const defaultStore = createGoogleOauthClientConfigStore();

export function findLatestClientConfig(): GoogleOauthClientConfigRecord | null {
  return defaultStore.findLatest();
}

export function upsertClientConfig(record: GoogleOauthClientConfigRecord): GoogleOauthClientConfigRecord {
  return defaultStore.upsert(record);
}
