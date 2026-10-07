/**
 * หน้าที่: the durable evidence chain — Owner, 2026-08-19: "requesting_identity
 * → WriteIntent → registry evidence → gate decision → file-write execution
 * → resulting artifact/change ... ทุก ID ต้อง trace ย้อนกลับได้". Real,
 * append-only JSON file (same durability pattern already proven in
 * `dna-os-circuit/runtime/finding-decider.ts`'s evidence files), not an
 * in-memory placeholder — Owner explicitly wants trace-back to be testable
 * against real, persisted evidence.
 *
 * Input: the fields of one completed or refused file-write.
 * Output: `WriteAuditEvent`, `recordWriteAudit`, `listWriteAudit`,
 * `onWriteAudit` (producer-time subscription — read-only).
 * Dependency ที่อนุญาต: ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: ห้ามเก็บ `content` ของไฟล์ลงในแถว audit — ที่นี่เป็นสาย
 * หลักฐาน ไม่ใช่ที่เก็บ source. Never omit `intent_id`/`gate_decision_id` from a record —
 * those two fields are what makes the chain traceable back through
 * permissions/write-gate/ and control/ai-write-control/ to the original
 * requesting identity. Never delete a record (same rule as
 * `audit/ai-execution-audit/README.md`'s own "ห้ามลบ record").
 */

import { fileExistsReal, joinPath, nowIso, readFileReal, repoRootDirname, writeFileReal } from "./host-runtime";
import type { FileWriteRefusalCode, FileWriteStatus } from "./types";
import type { WriteOperation, WriteTargetType } from "../../contracts/write-intent/write-intent";

export interface WriteAuditEvent {
  write_id: string;
  correlation_id: string;
  requesting_identity_id: string;
  intent_id: string;
  gate_decision_id: string;
  gate_decision_value: string;
  /**
   * ADDITIVE (Owner, COMPLETE_WRITE_FAILURE_EVENT_CONTEXT PART 1). สามฟิลด์นี้
   * มาจาก `FileWriteRequest` ที่ ./executor.ts ถืออยู่แล้วตรง ๆ ไม่มีการแปลง
   * ไม่มีการเดา และไม่มีการอนุมานจาก refusal_code
   *
   * `target_path` = ปลายทางที่ "ถูกร้องขอ" — คนละอย่างกับ `resolved_path`
   * ด้านล่างซึ่งเป็นผลลัพธ์ที่ executor แก้ได้จริง แถวที่ถูกปฏิเสธจะมี
   * target_path ครบแต่ resolved_path เป็น null ตามเดิม
   *
   * แถว 289 แถวที่อยู่บนดิสก์ก่อน 2026-08-28 ไม่มีสามฟิลด์นี้ และจะไม่ถูก
   * เขียนย้อนหลัง (กฎ append-only เดิมของไฟล์นี้) — `listWriteAudit` จึงอาจ
   * คืนแถวเก่าที่ฟิลด์เหล่านี้ขาด ผู้อ่านต้องเผื่อไว้
   */
  operation: WriteOperation;
  target_path: string;
  target_type: WriteTargetType;
  status: FileWriteStatus;
  refusal_code: FileWriteRefusalCode | null;
  resolved_path: string | null;
  bytes_written: number | null;
  recorded_at: string;
}

const AUDIT_FILE_RELATIVE = "execution/file-write/write-audit-log.json";

function auditFilePath(): string {
  return joinPath(repoRootDirname(), AUDIT_FILE_RELATIVE);
}

export type WriteAuditListener = (event: WriteAuditEvent) => void;

const listeners = new Set<WriteAuditListener>();

/**
 * PRODUCER-TIME subscription (Owner, CONNECT_NEW_AUTHORIZED_WRITE_FAILURE_TO_CANONICAL_AGENT_WORK
 * PHASE 1). A subscriber is handed ONLY the row this process just produced —
 * never a historical row, because nothing here ever reads the file back to
 * feed a listener. That is the whole point: no polling, no replay, no tailing.
 *
 * READ-ONLY BY CONSTRUCTION: the listener receives a value and its return is
 * ignored. It cannot alter the record, cannot alter `recordWriteAudit`'s
 * return, and a listener that throws is swallowed below — a subscriber must
 * never be able to break, delay a decision on, or change a real file write.
 * This is an emission hook, not a second gate.
 *
 * Returns an unsubscribe function; subscriptions live only as long as the
 * process, exactly like `control/owner-backbone/events.ts#onSystemEvent`.
 */
export function onWriteAudit(listener: WriteAuditListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function recordWriteAudit(event: Omit<WriteAuditEvent, "recorded_at">): WriteAuditEvent {
  const full: WriteAuditEvent = { ...event, recorded_at: nowIso() };
  const p = auditFilePath();
  let existing: WriteAuditEvent[] = [];
  if (fileExistsReal(p)) {
    try {
      const parsed = JSON.parse(readFileReal(p));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      // A corrupt audit file must never crash write execution — start fresh rather than throw.
    }
  }
  existing.push(full);
  writeFileReal(p, JSON.stringify(existing, null, 2));
  // หลังบันทึกลงดิสก์แล้วเท่านั้น — ผู้ฟังจะไม่มีวันเห็น event ที่ยังไม่เป็นหลักฐาน
  for (const listener of listeners) {
    try {
      listener(full);
    } catch {
      // ผู้ฟังพังต้องไม่ทำให้การเขียนไฟล์จริงพัง — hook นี้เป็นการแจ้ง ไม่ใช่ประตู
    }
  }
  return full;
}

export function listWriteAudit(): readonly WriteAuditEvent[] {
  const p = auditFilePath();
  if (!fileExistsReal(p)) return [];
  try {
    const parsed = JSON.parse(readFileReal(p));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
