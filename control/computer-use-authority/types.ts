/**
 * หน้าที่: รูปร่างของ "ใบมอบอำนาจควบคุมคอมพิวเตอร์" (permission lease) ของ DNA OS
 *
 * ── ทำไมต้องมี ──
 * ก่อนหน้านี้ os-ui admission ตอบได้แค่ "operation นี้รูปแบบถูกไหม" แต่ไม่มีชั้นที่ตอบ
 * "ใครอนุญาต ให้ใคร execute ทำ operation ไหน กับ target ไหน ในกรอบเวลาใด และเพิกถอนได้
 * ไหม" — นั่นคือ AUTHORIZATION_MODEL_GAP ไฟล์นี้ปิดช่องนั้น
 *
 * ── กฎเหล็ก ──
 * `executor` ต้องเป็น component ของ DNA OS เท่านั้น **ห้ามเป็น Claude/Codex/Agent**
 * — authority การควบคุมเครื่องเป็นของ DNA OS ไม่ใช่ของโมเดล โมเดลเป็นได้แค่ `requester`
 *
 * Input: none (types only).
 * Output: types ทั้งหมดของ lease + grant/validate.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่เก็บ secret ดิบ — เก็บได้แค่ evidence/credential
 *   reference (สตริงอ้างอิง) เท่านั้น.
 */

export type ComputerUseOperation =
  | "screenshot" | "read_screen"
  | "click" | "type" | "key" | "scroll" | "drag" | "focus" | "pointer_move" | "double_click"
  | "clipboard" | "file_chooser" | "file_upload"
  | "browser_navigate" | "browser_eval"
  | "login" | "credential_reference" | "provider_authorization";

export type AuthorityState = "GRANTED" | "EXPIRED" | "REVOKED";

/**
 * ใบมอบอำนาจหนึ่งใบ — ทุก field ปลอดภัยที่จะโผล่ใน log/registry/evidence
 * `executor` = DNA OS component ที่ได้รับมอบให้ execute (ไม่ใช่ requester)
 */
export interface ComputerUseAuthorityLease {
  authority_id: string;
  /** ROOT authority — Owner */
  owner: string;
  /** ผู้ร้องขอ (โมเดล/เสียง/flow) — ไม่ใช่ผู้ถืออำนาจ */
  requester: string;
  /** ผู้ execute จริง — ต้องเป็น DNA OS component เท่านั้น */
  executor: string;
  /** capability folder ที่เป็นขอบเขตการเรียกจริง เช่น "connections/os-ui" */
  capability: string;
  operations: readonly ComputerUseOperation[];
  /** เป้าหมาย เช่น host/app — ผูกแคบ ห้าม "*" */
  target: string;
  scope: readonly string[];
  issued_at: string;
  expires_at: string;
  state: AuthorityState;
  revoked_at: string | null;
  evidence_reference: string | null;
  /** LEVEL>=3 (external commit / security / credential) ต้องตั้ง true โดยชัดแจ้ง — ไม่สืบทอด */
  high_risk_explicit: boolean;
  /** อนุญาต external commit (submit/publish/send/delete/deploy/payment) — แยกจากสิทธิ์ UI */
  external_commit_authorized: boolean;
}

export interface GrantAuthorityInput {
  owner: string;
  requester: string;
  executor: string;
  capability: string;
  operations: readonly ComputerUseOperation[];
  target: string;
  scope: readonly string[];
  ttl_seconds: number;
  evidence_reference?: string | null;
  /** ต้อง true เมื่อ operations มี LEVEL>=3 (login/credential/…) — Owner ตั้งใจให้สิทธิ์เสี่ยงสูง */
  high_risk_explicit?: boolean;
  /** ต้อง true จึงจะ execute external commit ได้ (submit ฯลฯ) */
  external_commit_authorized?: boolean;
}

export type GrantAuthorityResult =
  | { ok: true; lease: ComputerUseAuthorityLease }
  | { ok: false; reason_code: string; detail: string };

export interface ValidateAuthorityInput {
  authority_id: string;
  requester: string;
  executor: string;
  operation: ComputerUseOperation;
  target: string;
  scope_needed?: readonly string[];
  /** ผู้เรียกประกาศว่า op นี้เป็น external commit (submit/publish/…) — ต้อง external_commit_authorized */
  is_external_commit?: boolean;
}

export type ValidateAuthorityResult =
  | { ok: true; lease: ComputerUseAuthorityLease }
  | { ok: false; reason_code: string; detail: string };

export type RevokeAuthorityResult =
  | { ok: true; lease: ComputerUseAuthorityLease }
  | { ok: false; reason_code: "AUTHORITY_NOT_FOUND" };
