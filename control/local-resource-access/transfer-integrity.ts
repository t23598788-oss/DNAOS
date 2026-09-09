/**
 * Transfer integrity evidence for COPY / MOVE / UPLOAD / DOWNLOAD / EXPORT / IMPORT.
 * Success is recorded only when hashes match when both sides exist.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";
import type { TransferIntegrityRecord } from "./types";

function transferFile(): string {
  return dataPath("transfer-integrity.jsonl", "LOCAL_RESOURCE_TRANSFER_LOG");
}

export type TransferOpResult =
  | { ok: true; record: TransferIntegrityRecord }
  | { ok: false; reason_code: string; record?: TransferIntegrityRecord };

export function recordTransferIntegrity(row: TransferIntegrityRecord): TransferIntegrityRecord {
  const p = transferFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listTransferIntegrity(): readonly TransferIntegrityRecord[] {
  const p = transferFile();
  if (!existsSync(p)) return [];
  const rows: TransferIntegrityRecord[] = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as TransferIntegrityRecord); } catch { /* skip */ }
  }
  return rows;
}
