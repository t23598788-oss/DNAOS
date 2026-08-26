/**
 * หน้าที่: the append-only store for MACHINE OBSERVATIONS (Owner, 2026-08-26).
 *
 * IT IS NOT THE VERIFICATION LEDGER, and must never become it.
 * `software/live-census/data/verification-ledger.jsonl` records a claim of a
 * different kind — "this capability was VERIFIED against this digest by this
 * evidence" — and mixing observations into it would quietly redefine what
 * VERIFIED means. Every record here carries
 * `record_type: "MACHINE_OBSERVATION"` so the two can never be read as the
 * same thing even by accident.
 *
 * APPEND ONLY. There is no update and no delete in this file. A process that
 * stops holding a file open produces a NEW observation; the old one stays,
 * because "it was open at 14:02" remains true afterwards. That is what makes
 * the history usable over time rather than a snapshot that overwrites itself.
 *
 * Input: `IngestionRecord`-shaped facts.
 * Output: `appendObservation`, `readObservations`, `observationsForResource`.
 * Dependency ที่อนุญาต: ./types.ts, ./lifecycle-bridge.ts (type only), node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเขียนลง verification-ledger.jsonl จากที่นี่.
 * - ห้าม update/delete record — append เท่านั้น.
 * - ห้ามเขียน record ที่ไม่มี `record_type`.
 */

declare const require: any;
declare const __dirname: string;

import type { MeaningRecord } from "./types";

const fs = require("node:fs");
const path = require("node:path");

export const OBSERVATION_STORE_FILE: string = path.join(__dirname, "data", "observations.jsonl");

export interface ObservationRecord {
  event_id: string;
  /** The one field that keeps observation semantics apart from verification semantics. */
  record_type: "MACHINE_OBSERVATION";
  resource_id: string | null;
  path: string;
  observed_at: string;
  process_evidence: readonly string[];
  relationship_evidence: readonly string[];
  meaning_records: readonly MeaningRecord[];
  source: string;
  derived_by: string;
}

export function appendObservation(record: Omit<ObservationRecord, "record_type">): ObservationRecord {
  const complete: ObservationRecord = { ...record, record_type: "MACHINE_OBSERVATION" };
  fs.mkdirSync(path.dirname(OBSERVATION_STORE_FILE), { recursive: true });
  fs.appendFileSync(OBSERVATION_STORE_FILE, `${JSON.stringify(complete)}\n`);
  return complete;
}

export function readObservations(): readonly ObservationRecord[] {
  try {
    return String(fs.readFileSync(OBSERVATION_STORE_FILE, "utf8"))
      .split("\n")
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => JSON.parse(line) as ObservationRecord)
      // A record without the marker is not an observation record; it is
      // refused rather than assumed, so a foreign line can never be read as one.
      .filter((record) => record.record_type === "MACHINE_OBSERVATION");
  } catch {
    return [];
  }
}

export function observationsForResource(resourceId: string): readonly ObservationRecord[] {
  return readObservations().filter((record) => record.resource_id === resourceId);
}

/** The store's own summary — counts only, so a caller never has to load the whole history to know its shape. */
export function observationStoreStatus(): { file: string; records: number; distinct_resources: number; newest_observed_at: string | null } {
  const records = readObservations();
  return {
    file: "control/machine-observation/data/observations.jsonl",
    records: records.length,
    distinct_resources: new Set(records.map((record) => record.resource_id).filter((id) => id !== null)).size,
    newest_observed_at: records.length > 0 ? records[records.length - 1].observed_at : null,
  };
}
