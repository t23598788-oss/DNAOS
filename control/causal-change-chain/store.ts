/**
 * หน้าที่: private append-only storage for `control/causal-change-chain/`.
 * Not the public boundary — `./contract.ts` is. Same discipline as
 * `software/registry-database/adapters/persistent-file-store.ts#persist`:
 * `appendFileSync` only, never a rewrite — every record, once written,
 * stays exactly as written forever (PHASE 9: old history is never
 * rewritten).
 *
 * `dataDir()` reads an env override every call (never resolved once at
 * import time) — same pattern as `control/agent-gateway/memory-store.ts#dataDir`
 * and `control/machine-observation/observation-store.ts#dataDir`, for the
 * exact reason both document: a path resolved at module-load time cannot
 * be redirected by a test that sets the env var after this module is
 * already loaded.
 */

declare const require: any;
declare const process: { cwd(): string; env: Record<string, string | undefined> };

const fs = require("node:fs");
const path = require("node:path");

function dataDir(): string {
  const override = process.env.CAUSAL_CHANGE_CHAIN_DATA_DIR;
  if (override && override.length > 0) return override;
  return path.join(process.cwd(), "control/causal-change-chain/data");
}

function ensureDataDir(): void {
  fs.mkdirSync(dataDir(), { recursive: true });
}

export function appendRecord<T>(fileName: string, record: T): void {
  ensureDataDir();
  fs.appendFileSync(path.join(dataDir(), fileName), `${JSON.stringify(record)}\n`);
}

export function readAllRecords<T>(fileName: string): readonly T[] {
  try {
    return String(fs.readFileSync(path.join(dataDir(), fileName), "utf8"))
      .split("\n")
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}
