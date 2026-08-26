/**
 * หน้าที่: the ONLY file here allowed to touch a real host ambient. Append-only
 * persistence for waiting-work rows, using the SAME convention as
 * `control/work-session-state/store.ts`'s checkpoints.jsonl — the current row
 * for a work_id is the LAST one carrying it, reduced deterministically, so a
 * crashed writer can never leave a half-updated state behind.
 *
 * Input: `WaitingWork` rows to append; nothing to read them but the file.
 * Output: `appendWaiting`, `loadWaiting`, `currentWaiting`, `WAITING_PATH`.
 * Dependency ที่อนุญาต: ./types.ts, node builtins.
 * สิ่งที่ห้ามแตะ: never rewrite or truncate the journal. A wrong row is corrected
 * by appending a newer one, never by editing history — the same rule the
 * verification ledger and the checkpoint journal already live by.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { WaitingWork } from "./types";

export const WAITING_PATH = resolve(process.cwd(), "control/work-continuation/data/waiting-work.jsonl");

export function appendWaiting(row: WaitingWork, path: string = WAITING_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}

/** Every row ever appended, in order. A malformed line is skipped, never guessed at. */
export function loadWaiting(path: string = WAITING_PATH): WaitingWork[] {
  if (!existsSync(path)) return [];
  const out: WaitingWork[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as WaitingWork); } catch { /* a half-written line is not a row */ }
  }
  return out;
}

/** The CURRENT row per work_id — last write wins, which is what makes the journal reducible. */
export function currentWaiting(path: string = WAITING_PATH): WaitingWork[] {
  const byId = new Map<string, WaitingWork>();
  for (const row of loadWaiting(path)) byId.set(row.work_id, row);
  return [...byId.values()];
}
