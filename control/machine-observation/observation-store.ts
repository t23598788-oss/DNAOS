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
declare const process: { env: Record<string, string | undefined>; pid: number };

import type { MeaningRecord } from "./types";

const fs = require("node:fs");
const path = require("node:path");

export const OBSERVATION_STORE_FILE: string = path.join(__dirname, "data", "observations.jsonl");
const DATA_DIR: string = path.join(__dirname, "data");
const ROTATE_LOCK_FILE: string = path.join(DATA_DIR, "observations.rotate.lock");
const ARCHIVE_PREFIX = "observations-";

/**
 * THE DECLARED BOUND (Owner, 2026-08-26). Before this there was NO policy at
 * all — the file simply grew — so these numbers are stated here with their
 * reasons rather than buried as silent defaults, and each can be overridden by
 * an env var that is named in this same declaration.
 *
 * They bound observation records ONLY. `software/live-census`'s verification
 * ledger and every lifecycle evidence store are untouched by anything in this
 * file.
 */
export interface ObservationRetentionPolicy {
  /** Rotate once the active file passes this size. 8 MB ~ tens of thousands of records: large enough that rotation is rare, small enough to stay readable and to load without care. */
  max_file_bytes: number;
  /** Rotate a file older than this even if it is small, so a quiet week still produces a boundary to age out. 7 days. */
  max_age_ms: number;
  /** How many rotated files are kept. Beyond this the OLDEST archive is deleted — that is the actual bound on total disk use, and it is a real deletion of observation records, not of lifecycle evidence. */
  max_rotated_files: number;
  declared_by: string;
  reason: string;
}

export const OBSERVATION_RETENTION_POLICY: ObservationRetentionPolicy = {
  max_file_bytes: Number(process.env.OBSERVATION_MAX_FILE_BYTES ?? 8 * 1024 * 1024),
  max_age_ms: Number(process.env.OBSERVATION_MAX_AGE_MS ?? 7 * 24 * 60 * 60 * 1000),
  max_rotated_files: Number(process.env.OBSERVATION_MAX_ROTATED_FILES ?? 4),
  declared_by: "control/machine-observation/observation-store.ts#OBSERVATION_RETENTION_POLICY (env: OBSERVATION_MAX_FILE_BYTES / OBSERVATION_MAX_AGE_MS / OBSERVATION_MAX_ROTATED_FILES)",
  reason: "observations are a running record of what the machine was doing, not a permanent ledger; the bound is stated rather than assumed",
};

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

/** Archives, newest last. Named by the instant they were sealed, so ordering never depends on the filesystem's own listing order. */
export function rotatedFiles(): readonly string[] {
  try {
    return fs.readdirSync(DATA_DIR)
      .filter((name: string) => name.startsWith(ARCHIVE_PREFIX) && name.endsWith(".jsonl"))
      .sort()
      .map((name: string) => path.join(DATA_DIR, name));
  } catch {
    return [];
  }
}

/**
 * ONE ROTATION AT A TIME. The lock is an exclusive create (`wx`) — the
 * filesystem decides the winner, so two daemons racing cannot both rename the
 * same file. A lock left behind by a process that died is taken over only
 * after it is provably stale (older than a minute), never ignored.
 */
function withRotationLock<T>(body: () => T): T | null {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ROTATE_LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
  } catch {
    try {
      const age = Date.now() - fs.statSync(ROTATE_LOCK_FILE).mtimeMs;
      if (age < 60_000) return null;                       // someone else is rotating right now
      fs.unlinkSync(ROTATE_LOCK_FILE);                     // stale: the holder died mid-rotation
      fs.writeFileSync(ROTATE_LOCK_FILE, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), took_over_stale_lock: true }), { flag: "wx" });
    } catch {
      return null;
    }
  }
  try {
    return body();
  } finally {
    try { fs.unlinkSync(ROTATE_LOCK_FILE); } catch { /* already gone */ }
  }
}

function shouldRotate(): { rotate: boolean; reason: string } {
  let stat: { size: number; birthtimeMs: number; mtimeMs: number };
  try {
    stat = fs.statSync(OBSERVATION_STORE_FILE);
  } catch {
    return { rotate: false, reason: "no active file yet" };
  }
  if (stat.size >= OBSERVATION_RETENTION_POLICY.max_file_bytes) {
    return { rotate: true, reason: `size ${stat.size} >= max_file_bytes ${OBSERVATION_RETENTION_POLICY.max_file_bytes}` };
  }
  const age = Date.now() - stat.birthtimeMs;
  if (age >= OBSERVATION_RETENTION_POLICY.max_age_ms) {
    return { rotate: true, reason: `age ${Math.round(age / 1000)}s >= max_age_ms ${Math.round(OBSERVATION_RETENTION_POLICY.max_age_ms / 1000)}s` };
  }
  return { rotate: false, reason: `size ${stat.size} and age within bounds` };
}

export interface RotationResult {
  rotated: boolean;
  reason: string;
  archive: string | null;
  pruned: readonly string[];
}

/**
 * Safe rotate: RENAME the active file, then let the next append create a fresh
 * one. The active file is never truncated or rewritten in place — a writer
 * appending at that instant either lands in the file being renamed (and travels
 * with it into the archive) or creates the new one. Nothing is lost either way,
 * and no record is ever edited.
 */
export function rotateIfNeeded(): RotationResult {
  const decision = shouldRotate();
  if (!decision.rotate) return { rotated: false, reason: decision.reason, archive: null, pruned: [] };

  const result = withRotationLock<RotationResult>(() => {
    // Re-check inside the lock: another process may have rotated while we waited.
    const recheck = shouldRotate();
    if (!recheck.rotate) return { rotated: false, reason: `another process rotated first (${recheck.reason})`, archive: null, pruned: [] };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archive = path.join(DATA_DIR, `${ARCHIVE_PREFIX}${stamp}.jsonl`);
    fs.renameSync(OBSERVATION_STORE_FILE, archive);

    // Prune oldest beyond the declared bound. This is the only deletion in this
    // file, it removes whole archived files only, and it never touches the
    // active one.
    const archives = rotatedFiles();
    const excess = Math.max(0, archives.length - OBSERVATION_RETENTION_POLICY.max_rotated_files);
    const pruned: string[] = [];
    for (const victim of archives.slice(0, excess)) {
      try { fs.unlinkSync(victim); pruned.push(path.basename(victim)); } catch { /* already gone */ }
    }
    return { rotated: true, reason: decision.reason, archive: path.basename(archive), pruned };
  });

  return result ?? { rotated: false, reason: "another process holds the rotation lock", archive: null, pruned: [] };
}

export function appendObservation(record: Omit<ObservationRecord, "record_type">): ObservationRecord {
  const complete: ObservationRecord = { ...record, record_type: "MACHINE_OBSERVATION" };
  fs.mkdirSync(path.dirname(OBSERVATION_STORE_FILE), { recursive: true });
  // Bound checked BEFORE the append, so the active file is rotated at the
  // boundary rather than after it has already grown past it.
  rotateIfNeeded();
  fs.appendFileSync(OBSERVATION_STORE_FILE, `${JSON.stringify(complete)}\n`);
  return complete;
}

function readFileRecords(file: string): ObservationRecord[] {
  try {
    return String(fs.readFileSync(file, "utf8"))
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

/** History spans the archives AND the active file, oldest first — a rotation must not make the past unreadable. */
export function readObservations(): readonly ObservationRecord[] {
  return [...rotatedFiles().flatMap(readFileRecords), ...readFileRecords(OBSERVATION_STORE_FILE)];
}

export function observationsForResource(resourceId: string): readonly ObservationRecord[] {
  return readObservations().filter((record) => record.resource_id === resourceId);
}

/** The store's own summary — counts only, so a caller never has to load the whole history to know its shape. */
export function observationStoreStatus(): {
  file: string;
  records: number;
  distinct_resources: number;
  newest_observed_at: string | null;
  active_bytes: number;
  rotated_files: readonly string[];
  rotated_bytes: number;
  policy: ObservationRetentionPolicy;
} {
  const records = readObservations();
  const sizeOf = (file: string): number => { try { return fs.statSync(file).size; } catch { return 0; } };
  const archives = rotatedFiles();
  return {
    file: "control/machine-observation/data/observations.jsonl",
    records: records.length,
    distinct_resources: new Set(records.map((record) => record.resource_id).filter((id) => id !== null)).size,
    newest_observed_at: records.length > 0 ? records[records.length - 1].observed_at : null,
    active_bytes: sizeOf(OBSERVATION_STORE_FILE),
    rotated_files: archives.map((file) => path.basename(file)),
    rotated_bytes: archives.reduce((total, file) => total + sizeOf(file), 0),
    policy: OBSERVATION_RETENTION_POLICY,
  };
}
