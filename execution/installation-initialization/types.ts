/**
 * หน้าที่: ผลลัพธ์ที่มีชนิดของการอ่าน/สร้างระเบียนการเริ่มต้นการติดตั้ง
 *
 * ── ความล้มเหลวเชิงปฏิบัติการ ≠ การไม่มีอยู่เชิงความหมาย ──
 * `UNINITIALIZED` มีความหมายเดียว: ไฟล์ตามเส้นทางมาตรฐาน **ไม่มีอยู่จริง**
 * สิทธิ์ไม่พอ, I/O พัง, symlink ไม่ปลอดภัย, JSON เสีย, ไฟล์ว่าง, ไฟล์ขาดครึ่ง,
 * schema ผิด, digest ไม่ตรง — ทั้งหมดนี้คือ CORRUPT ไม่ใช่ "ยังไม่ได้เริ่มต้น"
 * ถ้าปล่อยให้อ่านผิดเป็น UNINITIALIZED พิธีเริ่มต้นในอนาคตจะสร้างตัวตนใหม่ทับ
 * การติดตั้งที่มีอยู่แล้วโดยไม่มีใครเห็น
 *
 * `MACHINE_BINDING_MISMATCH` **ไม่มีในชุดนี้โดยเจตนา** เพราะยังตรวจไม่ได้จริง
 * การประกาศสถานะที่ไม่มีใครผลิตได้ ทำให้ผู้อ่านเข้าใจว่าระบบตรวจการคัดลอกได้
 *
 * Input: none
 * Output: `ReadOutcome`, `CreateOutcome`, `StoreReasonCode`
 * Dependency ที่อนุญาต: type-only จาก contracts/installation
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มสถานะที่ทำให้ความล้มเหลวกลายเป็นการไม่มีอยู่ และ
 * ห้ามเพิ่ม MACHINE_BINDING_MISMATCH จนกว่าจะมี primitive ที่ผลิตมันได้จริง
 */

import type { InstallationInitializationV1 } from "../../contracts/installation/installation-initialization";

export type StoreReasonCode =
  | "FILE_ABSENT"
  | "INVALID_JSON"
  | "INVALID_CONTRACT"
  | "DIGEST_MISMATCH"
  | "UNSAFE_PATH"
  | "PERMISSION_DENIED"
  | "IO_FAILURE"
  | "EXCLUSIVE_CREATE_LOST"
  | "STATE_ROOT_UNAVAILABLE";

export type ReadOutcome =
  | { readonly state: "UNINITIALIZED"; readonly path: string }
  | { readonly state: "INITIALIZED"; readonly initialization: InstallationInitializationV1; readonly path: string }
  | { readonly state: "CORRUPT"; readonly reason_code: StoreReasonCode; readonly detail: string; readonly path: string | null };

export type CreateOutcome =
  | { readonly result: "CREATED"; readonly initialization: InstallationInitializationV1; readonly path: string }
  | { readonly result: "REPLAY"; readonly initialization: InstallationInitializationV1; readonly path: string }
  | { readonly result: "CONFLICT"; readonly existing: InstallationInitializationV1; readonly detail: string; readonly path: string }
  | { readonly result: "CORRUPT"; readonly reason_code: StoreReasonCode; readonly detail: string; readonly path: string | null }
  | { readonly result: "FAILED"; readonly reason_code: StoreReasonCode; readonly detail: string; readonly path: string | null };
