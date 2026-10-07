/**
 * หน้าที่: the persistence boundary for normalized expenses — an append-only
 * JSONL store, the same shape DNA OS's canonical registry already uses, so
 * this introduces no second database technology.
 * Deduplication is by `source_message_id`: one Gmail message can only ever
 * produce one expense row, no matter how many discovery queries return it or
 * how many times ingestion re-runs.
 * Input: NormalizedExpense rows.
 * Output: WriteOutcome, readExpenses().
 * Dependency ที่อนุญาต: ./types, node:fs, node:path, node:url.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนทับหรือลบแถวเดิม — ไฟล์นี้ append อย่างเดียว
 * เพื่อให้ทุกแถวในรายงานย้อนกลับไปหาอีเมลต้นทางได้ตลอด.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizedExpense } from "./types";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const EXPENSE_STORE = join(MODULE_DIR, "data", "expenses.jsonl");

export interface WriteOutcome {
  readonly inserted: number;
  readonly duplicates: number;
  readonly duplicate_message_ids: readonly string[];
}

export function readExpenses(): readonly NormalizedExpense[] {
  if (!existsSync(EXPENSE_STORE)) return [];
  return readFileSync(EXPENSE_STORE, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as NormalizedExpense);
}

export function persistExpenses(rows: readonly NormalizedExpense[]): WriteOutcome {
  mkdirSync(dirname(EXPENSE_STORE), { recursive: true });
  const known = new Set(readExpenses().map((row) => row.source_message_id));
  const duplicates: string[] = [];
  const fresh: NormalizedExpense[] = [];
  for (const row of rows) {
    if (known.has(row.source_message_id)) { duplicates.push(row.source_message_id); continue; }
    known.add(row.source_message_id);
    fresh.push(row);
  }
  if (fresh.length > 0) {
    appendFileSync(EXPENSE_STORE, fresh.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  }
  return { inserted: fresh.length, duplicates: duplicates.length, duplicate_message_ids: duplicates };
}
