/**
 * หน้าที่: the public boundary of `execution/file-write/`. Deliberately
 * does NOT re-export `./host-runtime.ts`'s real fs primitives or
 * `./audit.ts`'s `recordWriteAudit` — `executeFileWrite` is the only real
 * write-capable surface a caller may reach from outside this folder.
 *
 * Input: re-exports only.
 * Output: `executeFileWrite` (สัญญาของด่านซอร์ส — executeFileWriteSandboxed
 * ย้ายไป ./sandboxed-contract.ts ฝั่ง DNA OS เมื่อ 2026-09-04) (added
 * 2026-08-22 — the real-jail variant, see ./sandboxed-executor.ts's own
 * header for the gate/scope discipline it shares with `executeFileWrite`),
 * `listWriteAudit` (read-only trace-back), `onWriteAudit` (producer-time
 * subscription — hands out records, never write capability), plus every type
 * a caller needs.
 * Dependency ที่อนุญาต: ./executor.ts, ./sandboxed-executor.ts,
 * ./audit.ts (listWriteAudit only), ./types.ts.
 * สิ่งที่ห้ามแตะ: never export `recordWriteAudit`, `writeFileReal`, or any
 * other write-capable primitive here.
 */

export { executeFileWrite } from "./executor";
export { listWriteAudit, onWriteAudit } from "./audit";
export type { WriteAuditEvent, WriteAuditListener } from "./audit";
export type { FileWriteRefusalCode, FileWriteRequest, FileWriteResult, FileWriteStatus } from "./types";
