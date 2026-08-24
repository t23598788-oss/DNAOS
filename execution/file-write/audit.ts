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
 * Output: `WriteAuditEvent`, `recordWriteAudit`, `listWriteAudit`.
 * Dependency ที่อนุญาต: ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never omit `intent_id`/`gate_decision_id` from a record —
 * those two fields are what makes the chain traceable back through
 * permissions/write-gate/ and control/ai-write-control/ to the original
 * requesting identity. Never delete a record (same rule as
 * `audit/ai-execution-audit/README.md`'s own "ห้ามลบ record").
 */

import { fileExistsReal, joinPath, nowIso, readFileReal, repoRootDirname, writeFileReal } from "./host-runtime";
import type { FileWriteRefusalCode, FileWriteStatus } from "./types";

export interface WriteAuditEvent {
  write_id: string;
  correlation_id: string;
  requesting_identity_id: string;
  intent_id: string;
  gate_decision_id: string;
  gate_decision_value: string;
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
