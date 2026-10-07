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
/**
 * type-only: `RuntimeObservationResult` เป็นรูปร่างของ "สิ่งที่วัดได้" ซึ่งนิยาม
 * อยู่ที่ ./target-observer.ts แล้ว การประกาศสคีมาการวัดซ้ำที่นี่จะทำให้มีสอง
 * แหล่งความจริงของหน่วยเดียวกัน — อ้างถึงของเดิมแทน (import เป็น type จึงถูกลบ
 * ตอนคอมไพล์ ไม่เกิดวงอ้างอิงตอนรัน)
 */
import type { RuntimeObservationResult } from "./target-observer";

const fs = require("node:fs");
const path = require("node:path");

/**
 * ที่เก็บของผู้สังเกต — resolve ตอน "เรียกใช้" ไม่ใช่ตอน "โหลดโมดูล"
 *
 * เหตุการณ์ 2026-08-29 พิสูจน์แล้วว่า path ที่ผูกตอนโหลดโมดูลเป็นกับดักจริง:
 * ESM ยก `import` ขึ้นก่อนเสมอ การตั้ง env ในบรรทัดบน ๆ ของไฟล์ทดสอบจึงเกิด
 * *หลัง* โมดูลถูกประเมินไปแล้ว ค่าที่ได้จึงเป็น path จริง แล้วเทสต์ก็เขียนทับ
 * หลักฐานจริง (187 แถวหายถาวร)
 *
 * รูปแบบนี้ลอกจาก `control/agent-gateway/memory-store.ts#dataDir()` ซึ่งอ่าน env
 * ทุกครั้งที่ถูกเรียก จึงไม่ขึ้นกับลำดับ import เลย
 *
 * ไม่ตั้ง `MACHINE_OBSERVATION_DATA_DIR` = path เดิมทุกประการ
 */
function dataDir(): string {
  const override = process.env.MACHINE_OBSERVATION_DATA_DIR;
  if (override && override.length > 0) return override;
  return path.join(__dirname, "data");
}

/** path ที่ใช้จริง ณ เวลาที่เรียก — ทุกจุดในไฟล์นี้ต้องผ่านฟังก์ชันนี้ */
export function observationStoreFile(): string {
  return path.join(dataDir(), "observations.jsonl");
}

/**
 * path เริ่มต้นของ production เก็บชื่อเดิมไว้เพื่อความเข้ากันได้ย้อนหลัง
 *
 * ระวัง: นี่คือ "ค่าเริ่มต้น" ไม่ใช่ "ค่าที่กำลังใช้อยู่" — เมื่อมี override
 * ค่านี้จะไม่ตรงกับที่เขียนจริง ผู้เรียกที่ต้องการ path ที่ใช้จริงต้องเรียก
 * `observationStoreFile()`
 */
export const OBSERVATION_STORE_FILE: string = path.join(__dirname, "data", "observations.jsonl");

function rotateLockFile(): string {
  return path.join(dataDir(), "observations.rotate.lock");
}
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
  /** CANDIDATE PRESSURE ONLY (Owner, 2026-08-26). Archives beyond this count are named as lifecycle candidates and handed to the existing storage lifecycle. Nothing in this module deletes them; this number no longer bounds disk use by itself, and saying it did would be false. */
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
  /**
   * ADDITIVE (Owner, DECISION 5). ตัวตนของงานที่ทำให้เกิดการสังเกตนี้ เมื่อผู้ผลิต
   * พิสูจน์ได้จริงเท่านั้น
   *
   * เดิมความสัมพันธ์นี้มีอยู่แล้วแต่ถูกฝังไว้ใน `source` เป็นข้อความ
   * (`dna-os:work=<id>;execution=<id>`) ซึ่งอ่านย้อนได้ก็จริงแต่ต้อง parse prose
   * — ฟิลด์เหล่านี้คือค่าเดียวกันที่ถูกยกขึ้นมาเป็นชนิด `source` ยังคงถูกเขียน
   * เหมือนเดิมเพื่อความเข้ากันได้ย้อนหลังกับ 20 แถวที่อยู่บนดิสก์แล้ว แต่ **ไม่ใช่
   * แหล่งตัวตนที่เชื่อถือได้อีกต่อไป**
   *
   * ไม่มีค่า = UNKNOWN ห้ามเติม "UNTRACKED" หรือเดาจาก path
   */
  work_id?: string | null;
  execution_id?: string | null;
  workspace_id?: string | null;
  agent_run_id?: string | null;
  task_id?: string | null;
  capability_id?: string | null;
  /**
   * ADDITIVE (Owner, IMPLEMENT_TYPED_RUNTIME_OBSERVATION_PERSISTENCE).
   *
   * ตัวตนของเป้าหมายที่ถูกวัด และ **ค่าที่วัดได้แบบมีชนิด**
   *
   * ก่อนหน้านี้ค่า pid/uptime/http ของเส้นทาง QUERY อยู่แค่ในสตริง
   * `SystemEvent.state` ("pid 21988 uptime_s 177 http 200") ซึ่งอ่านย้อนได้ด้วยตา
   * แต่เครื่องต้อง parse ข้อความ ฟิลด์สองช่องนี้ทำให้ตัวเลขเป็นตัวเลข
   *
   * ความหมายของแถวไม่เปลี่ยน: ยังคงเป็น "ที่เวลา observed_at ผู้สังเกตวัดได้
   * เท่านี้" เท่านั้น ไม่ได้แปลว่า capability ผ่านการยืนยัน ไม่ได้แปลว่าบริการ
   * แข็งแรงตลอดไป และไม่ได้มอบสิทธิ์ควบคุมใด ๆ (ดู `record_type` ด้านบน)
   */
  runtime_target_id?: string | null;
  runtime_measurement?: RuntimeObservationResult | null;
}

/*
 * DELETE PATH REMOVED — THE SECOND ONE (Owner, 2026-08-26).
 *
 * `pruneClassifiedFiles(request)` stood here: it took a list of candidate
 * paths, kept the newest N, and `fs.unlinkSync()`d the rest. It was exported
 * from ./contract.ts and called by
 * ../ui-render-verification/screenshot-lifecycle.ts to delete render
 * screenshots.
 *
 * It is gone for the same reason the rotation prune below it is gone, and the
 * reason is not that deleting screenshots is wrong. It is that this made the
 * observation layer a deletion authority for a SECOND time, and by a route
 * that looked harmless: the caller classified, this function only "carried
 * out" the classification. But carrying out is exactly the authority in
 * question. Nothing in the call cleared a retention window, checked a live
 * consumer, checked recoverability, or produced a verdict — the gates every
 * other resource on this machine must clear before a single byte moves. A
 * caller passing a well-reasoned list does not supply those gates; it supplies
 * a list.
 *
 * The classification was good and is kept. What is removed is this module's
 * ability to act on it. Callers now receive named candidates and hand them to
 * the storage lifecycle, whose trash adapter is the one mutation boundary.
 *
 * Do not reintroduce a delete here under any name — `prune`, `evict`,
 * `reclaim`, `cleanup`, `gc`. The absence is the design.
 */

/** Archives, newest last. Named by the instant they were sealed, so ordering never depends on the filesystem's own listing order. */
export function rotatedFiles(): readonly string[] {
  try {
    return fs.readdirSync(dataDir())
      .filter((name: string) => name.startsWith(ARCHIVE_PREFIX) && name.endsWith(".jsonl"))
      .sort()
      .map((name: string) => path.join(dataDir(), name));
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
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(rotateLockFile(), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
  } catch {
    try {
      const age = Date.now() - fs.statSync(rotateLockFile()).mtimeMs;
      if (age < 60_000) return null;                       // someone else is rotating right now
      fs.unlinkSync(rotateLockFile());                     // stale: the holder died mid-rotation
      fs.writeFileSync(rotateLockFile(), JSON.stringify({ pid: process.pid, at: new Date().toISOString(), took_over_stale_lock: true }), { flag: "wx" });
    } catch {
      return null;
    }
  }
  try {
    return body();
  } finally {
    try { fs.unlinkSync(rotateLockFile()); } catch { /* already gone */ }
  }
}

function shouldRotate(): { rotate: boolean; reason: string } {
  let stat: { size: number; birthtimeMs: number; mtimeMs: number };
  try {
    stat = fs.statSync(observationStoreFile());
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
  /**
   * Always empty since 2026-08-26. Kept so existing readers of this shape do
   * not break, and kept EMPTY so no caller can mistake rotation for something
   * that still deletes. Deletion is not this module's authority any more.
   */
  pruned: readonly string[];
  /** Archives beyond the declared bound. Named, never removed. */
  lifecycle_candidates: readonly string[];
  candidate_reason: string;
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
  if (!decision.rotate) return { rotated: false, reason: decision.reason, archive: null, pruned: [], lifecycle_candidates: [], candidate_reason: "no rotation, so no candidate pressure was evaluated" };

  const result = withRotationLock<RotationResult>(() => {
    // Re-check inside the lock: another process may have rotated while we waited.
    const recheck = shouldRotate();
    if (!recheck.rotate) return { rotated: false, reason: `another process rotated first (${recheck.reason})`, archive: null, pruned: [], lifecycle_candidates: [], candidate_reason: "another process rotated first" };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archive = path.join(dataDir(), `${ARCHIVE_PREFIX}${stamp}.jsonl`);
    fs.renameSync(observationStoreFile(), archive);

    // DIRECT PRUNE AUTHORITY REMOVED (Owner, 2026-08-26).
    //
    // This block used to call fs.unlinkSync() on the oldest archives. That made
    // rotation a second deletion authority: it decided on its own that an
    // observation archive had no further value and removed it, with no
    // retention check, no consumer check, no recoverability check and no
    // verdict — none of the gates every other resource on this machine has to
    // clear before anything is moved.
    //
    // max_rotated_files now expresses CANDIDATE PRESSURE only. Archives beyond
    // the bound are named as lifecycle candidates and left exactly where they
    // are. Whether any of them may be reclaimed is decided by the existing
    // storage lifecycle (resource graph -> retention -> protection -> verdict),
    // and only its cleanup boundary may act on that decision.
    //
    // NOTE ON THE OTHER TWO unlinkSync CALLS IN THIS FILE: both operate on
    // rotateLockFile() (stale-lock recovery and normal release) and are
    // untouched. They are lock hygiene, not data deletion, and removing either
    // would wedge rotation after a crash.
    const archives = rotatedFiles();
    const excess = Math.max(0, archives.length - OBSERVATION_RETENTION_POLICY.max_rotated_files);
    const lifecycle_candidates = archives.slice(0, excess).map((file: string) => path.basename(file));
    return {
      rotated: true,
      reason: decision.reason,
      archive: path.basename(archive),
      pruned: [],
      lifecycle_candidates,
      candidate_reason: lifecycle_candidates.length > 0
        ? `${archives.length} archives exceed the declared bound of ${OBSERVATION_RETENTION_POLICY.max_rotated_files}; the oldest ${lifecycle_candidates.length} are offered to the storage lifecycle as candidates and were NOT deleted`
        : `${archives.length} archives is within the declared bound of ${OBSERVATION_RETENTION_POLICY.max_rotated_files}`,
    };
  });

  return result ?? { rotated: false, reason: "another process holds the rotation lock", archive: null, pruned: [], lifecycle_candidates: [], candidate_reason: "rotation lock held elsewhere" };
}

export type ObservationListener = (record: ObservationRecord) => void;
const observationListeners = new Set<ObservationListener>();

/**
 * PRODUCER-TIME subscription — ผู้ฟังได้รับเฉพาะแถวที่โปรเซสนี้เพิ่งผลิต ไม่เคย
 * ได้รับแถวเก่า เพราะไม่มีจุดใดอ่านไฟล์กลับมาป้อนผู้ฟัง (ไม่มี poll ไม่มี replay)
 *
 * อ่านอย่างเดียวโดยโครงสร้าง: ค่าที่คืนถูกทิ้ง และผู้ฟังที่ throw ถูกกลืน — การ
 * สังเกตต้องไม่พังเพราะผู้บริโภคปลายทาง
 */
export function onObservation(listener: ObservationListener): () => void {
  observationListeners.add(listener);
  return () => { observationListeners.delete(listener); };
}

export function appendObservation(record: Omit<ObservationRecord, "record_type">): ObservationRecord {
  const complete: ObservationRecord = { ...record, record_type: "MACHINE_OBSERVATION" };
  fs.mkdirSync(path.dirname(observationStoreFile()), { recursive: true });
  // Bound checked BEFORE the append, so the active file is rotated at the
  // boundary rather than after it has already grown past it.
  rotateIfNeeded();
  fs.appendFileSync(observationStoreFile(), `${JSON.stringify(complete)}\n`);
  // แจ้งผู้ฟังหลังบันทึกลงดิสก์แล้วเท่านั้น — ผู้ฟังจะไม่เห็นสิ่งที่ยังไม่เป็นหลักฐาน
  for (const listener of observationListeners) {
    try { listener(complete); } catch { /* ผู้ฟังพังต้องไม่ทำให้การสังเกตพัง */ }
  }
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
  return [...rotatedFiles().flatMap(readFileRecords), ...readFileRecords(observationStoreFile())];
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
    active_bytes: sizeOf(observationStoreFile()),
    rotated_files: archives.map((file) => path.basename(file)),
    rotated_bytes: archives.reduce((total, file) => total + sizeOf(file), 0),
    policy: OBSERVATION_RETENTION_POLICY,
  };
}
