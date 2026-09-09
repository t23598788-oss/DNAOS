/**
 * หน้าที่: รูปร่างของ Owner session ที่ผ่านการพิสูจน์ตัวตนจริง — ไม่ใช่สตริง "OWNER"
 *
 * ── หลักฐาน authentication ที่ยอมรับ ──
 * "macos-console-session"  = ผู้ใช้ที่ล็อกอิน GUI จริงบนเครื่อง (stat /dev/console) ตรงกับ
 *                            owner ที่คาดไว้ — พิสูจน์ว่า operation รันอยู่ใน session จริง
 *                            ของ Owner (session-presence) ไม่ใช่ biometric
 * "touch-id"               = ต้องมี LocalAuthentication helper จริง (ยังไม่ build รอบนี้ —
 *                            ไม่แกล้งว่ามี) เป็น method ที่ contract รองรับไว้สำหรับอนาคต
 *
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามสร้างผล biometric ปลอม; ห้ามให้สตริงชื่อผ่านเป็น authentication.
 */

/**
 * วิธีที่ผู้เรียก "ขอ" ใช้ยืนยัน — ไม่ใช่สิ่งที่ระบบเชื่อ
 *
 * ADDITIVE 2026-09-05: "human-verification" คือทางเดียวที่ออก session ได้จริง
 * ส่วนอีกสองตัวคงไว้เพื่อไม่ให้ผู้เรียกเดิมพัง แต่ ./authenticate.ts ปฏิเสธทั้งคู่
 * ด้วย HUMAN_VERIFICATION_REQUIRED แล้ว — `macos-console-session` เหลือความหมาย
 * เป็น OWNER_PRESENCE_CHECK เท่านั้น
 */
export type OwnerAuthMethod = "macos-console-session" | "touch-id" | "human-verification";
export type OwnerSessionState = "ACTIVE" | "EXPIRED" | "REVOKED";

export interface OwnerSession {
  session_id: string;
  owner_identity: string;         // ผู้ใช้จริงที่พิสูจน์แล้ว เช่น "tam"
  /** วิธีที่ผ่านจริง — สำหรับ human-verification จะมีชั้นของวิธีต่อท้าย เช่น "human-verification:BIOMETRIC" */
  authenticated_via: OwnerAuthMethod | `human-verification:${string}`;
  device_binding: string | null;  // machine identity (reuse machine-binding ถ้ามี)
  issued_at: string;
  expires_at: string;
  state: OwnerSessionState;
  revoked_at: string | null;
  evidence_reference: string | null;
}

export interface AuthenticateOwnerInput {
  method: OwnerAuthMethod;
  /** ต้องมีเมื่อ method = "human-verification" — challenge ที่ macOS ยืนยันแล้วและยังไม่ถูกใช้ */
  verified_challenge_id?: string;
  /** owner ที่ระบบคาดว่าเป็นเจ้าของ — ต้องตรงกับ signal จริง ไม่ใช่แค่ประกาศ */
  expected_owner: string;
  ttl_seconds: number;
}

export type AuthenticateOwnerResult =
  | { ok: true; session: OwnerSession }
  | { ok: false; reason_code: string; detail: string };

export type ValidateOwnerSessionResult =
  | { ok: true; session: OwnerSession }
  | { ok: false; reason_code: string; detail: string };

export type RevokeOwnerSessionResult =
  | { ok: true; session: OwnerSession }
  | { ok: false; reason_code: "OWNER_SESSION_NOT_FOUND" };
