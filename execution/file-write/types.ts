/**
 * หน้าที่: the type contracts for `execution/file-write/` — a SEPARATE
 * capability from `execution/run/` (shell command execution). Owner,
 * 2026-08-19: "สร้าง file-write execution เป็น capability แยกจาก shell
 * execution เดิม". This capability executes CREATE/MODIFY of a real FILE
 * target — it never runs a shell command, never touches
 * execution/run/registry.ts.
 *
 * Input: none (pure type definitions).
 * Output: `FileWriteRequest`, `FileWriteResult`, `FileWriteStatus`,
 * `FileWriteRefusalCode`.
 * Dependency ที่อนุญาต: `../../contracts/write-intent/write-intent.ts` (type only).
 * สิ่งที่ห้ามแตะ: never add a field that lets a caller assert its own
 * "already approved" — every request must carry the real `gate_decision_id`
 * it claims to be authorized by, and ./executor.ts always re-verifies the
 * full decision object, never just this id (same pattern as
 * execution/run/types.ts's own `permission_decision_id` comment).
 */

import type { WriteOperation, WriteTargetType } from "../../contracts/write-intent/write-intent";

export interface FileWriteRequest {
  correlation_id: string;
  intent_id: string;
  /** The WriteGateDecision.decision_id this request claims to be authorized by — ./executor.ts re-verifies the full decision object, not just this id. */
  gate_decision_id: string;
  operation: WriteOperation;
  target_type: WriteTargetType;
  /** Repo-relative path. Only target_type "FILE" is actually executable this round (see ./executor.ts's header). */
  target_path: string;
  /** Required for CREATE/MODIFY of a FILE target; null for DELETE/MOVE/RENAME (out of scope for real execution this round — see executor.ts). */
  content: string | null;
  requesting_identity_id: string;
}

export type FileWriteStatus = "completed" | "refused";

export type FileWriteRefusalCode =
  | "NO_GATE_DECISION"
  | "GATE_DECISION_MISMATCH"
  | "GATE_DECISION_NOT_ALLOW"
  | "UNSUPPORTED_TARGET_TYPE"
  | "UNSUPPORTED_OPERATION"
  | "MISSING_CONTENT"
  | "FS_ERROR";

export interface FileWriteResult {
  write_id: string;
  correlation_id: string;
  intent_id: string;
  gate_decision_id: string;
  status: FileWriteStatus;
  refusal_code: FileWriteRefusalCode | null;
  resolved_path: string | null;
  bytes_written: number | null;
  completed_at: string;
}
