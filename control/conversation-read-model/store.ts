/**
 * หน้าที่: private snapshot storage for `control/conversation-read-model/`.
 * Not the public boundary — `./contract.ts` is. Two whole-file snapshots
 * (command identities, capability summaries: static registries, overwritten
 * on every publish) and two append-only per-task logs (task status,
 * task evidence: read as "latest record for this task_id").
 *
 * This file performs disk I/O only. It has no opinion about who is allowed
 * to call `writeSnapshot`/`appendProjectionRecord` versus `readSnapshot`/
 * `readLatestProjectionRecord` — that separation is enforced by which
 * functions `./contract.ts` re-exports under a `read*` vs `publish*` name,
 * and by the header rule on `./contract.ts` that only producers may call
 * the latter.
 */

declare const require: any;
declare const process: { cwd(): string };

const fs = require("node:fs");
const path = require("node:path");

// `process.cwd()`, never `__dirname` — this repo's own convention (see
// `control/agent-gateway/host-runtime.ts#repoRootDirname`,
// `software/registry-database/adapters/persistent-file-store.ts`'s
// `DEFAULT_CANONICAL_DIR`) for exactly the reason it matters here: this file
// gets compiled to plain JS under `control/conversation-runtime/dist/` for
// the isolated runtime process (Owner UNLOCK 2026-09-06,
// REMOVE_TSX_FROM_PRODUCTION_CONVERSATION_RUNTIME) — `__dirname` of the
// COMPILED file would point into `dist/`, not this real data directory.
// `process.cwd()` is the repo root in both the source (tsx) and compiled
// (plain node) case, since neither changes the working directory.
const DATA_DIR = path.join(process.cwd(), "control/conversation-read-model/data");

function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function snapshotFileExists(fileName: string): boolean {
  return fs.existsSync(path.join(DATA_DIR, fileName));
}

export function writeSnapshot<T>(fileName: string, value: T): void {
  ensureDataDir();
  fs.writeFileSync(path.join(DATA_DIR, fileName), JSON.stringify(value));
}

export function readSnapshot<T>(fileName: string): T | null {
  try {
    return JSON.parse(String(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8"))) as T;
  } catch {
    return null;
  }
}

export function appendProjectionRecord<T>(fileName: string, record: T): void {
  ensureDataDir();
  fs.appendFileSync(path.join(DATA_DIR, fileName), `${JSON.stringify(record)}\n`);
}

/** Latest record in an append-only projection log matching `key`. */
export function readLatestProjectionRecord<T extends Record<string, unknown>>(fileName: string, keyField: string, keyValue: string): T | null {
  let lines: string[];
  try {
    lines = String(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8")).split("\n").filter((line: string) => line.trim().length > 0);
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const record = JSON.parse(lines[i]) as T;
    if (record[keyField] === keyValue) return record;
  }
  return null;
}

/** Every record in an append-only projection log, oldest first — for a log with no natural filter key (e.g. one metric's own measurement history). Never mutates the file. */
export function readAllProjectionRecords<T>(fileName: string): readonly T[] {
  let lines: string[];
  try {
    lines = String(fs.readFileSync(path.join(DATA_DIR, fileName), "utf8")).split("\n").filter((line: string) => line.trim().length > 0);
  } catch {
    return [];
  }
  return lines.map((line) => JSON.parse(line) as T);
}
