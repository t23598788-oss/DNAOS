/**
 * หน้าที่: รูปร่างของ record หนึ่งวงจรการอนุญาต TikTok และ input/output ของ
 * public API — คู่ขนานกับ `connections/provider-authorization/types.ts` แต่เป็น
 * ของตัวเอง เพราะ TikTok ใช้ authorization-code + PKCE (redirect) ไม่ใช่ device
 * flow และ "ปลายทาง" คือ TikTok account (open_id/username) ไม่ใช่ git repo
 *
 * Input: none (types only).
 * Output: `TiktokAuthorizationState`, `TiktokAuthorizationRecord`, และผลลัพธ์ของ
 *   begin/complete/revoke/status.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่ม field ที่อาจเก็บ secret ดิบ — เก็บได้เฉพาะ
 *   `credential_ref` (สตริงอ้างอิง) ห้ามเก็บ access_token/refresh_token/code_verifier
 *   ค่าจริง. `code_verifier` เก็บชั่วคราวระหว่าง begin→complete เท่านั้น และมัน
 *   authorize อะไรไม่ได้ด้วยตัวเอง (PKCE proof) เหมือน device_code ของ GitHub.
 */

export type TiktokAuthorizationState =
  | "NOT_CONNECTED"
  | "AUTHORIZATION_REQUIRED"
  | "AUTHORIZATION_PENDING"
  | "CONNECTED"
  | "AUTHORIZATION_FAILED"
  | "REVOKED";

/**
 * Persisted record — ทุก field ปลอดภัยที่จะโผล่ใน log/registry/HTTP response
 *
 * `code_verifier` กับ `state_nonce` เป็น session material ชั่วคราวของ PKCE/CSRF
 * ที่ authorize อะไรไม่ได้ด้วยตัวเอง (ต้องมีการกดอนุญาตของ Owner ใน browser จริง
 * เท่านั้น) เก็บไว้แค่พอให้ completeAuthorization แลก code ได้ แล้วถูกล้างทันที
 */
export interface TiktokAuthorizationRecord {
  connection_id: string;
  provider: "tiktok";
  /** TikTok open_id ของบัญชีที่ยืนยันแล้ว — null จนกว่าจะ CONNECTED */
  open_id: string | null;
  /** username/display ที่อ่านจาก user info หลังยืนยัน — เพื่อให้ Owner จำได้ว่าเป็นบัญชีไหน */
  account: string | null;
  state: TiktokAuthorizationState;
  credential_ref: string | null;
  granted_scope: readonly string[] | null;
  /** PKCE proof material ชั่วคราว — null เมื่อไม่มี pending flow */
  code_verifier: string | null;
  state_nonce: string | null;
  authorize_expires_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface BeginTiktokAuthorizationInput {
  /** scope ที่จะขอ — ต้องเป็นชุดที่ TikTok app ของ Owner ได้รับอนุมัติแล้วเท่านั้น */
  scope: readonly string[];
}

export type BeginTiktokAuthorizationResult =
  | {
      ok: true;
      connection_id: string;
      /** URL ที่ Owner ต้องเปิดใน browser เพื่อกดอนุญาต — DNA OS สร้างให้ ไม่กดแทน */
      authorize_url: string;
      state_nonce: string;
      expires_in_seconds: number;
    }
  | { ok: false; reason_code: string; detail: string; owner_action: string | null };

export interface CompleteTiktokAuthorizationInput {
  connection_id: string;
  /** authorization code ที่ TikTok ส่งกลับมาที่ redirect_uri หลัง Owner อนุมัติ */
  code: string;
  /** state ที่ TikTok ส่งกลับ — ต้องตรงกับ state_nonce ที่ออกไป (กัน CSRF) */
  state: string;
}

export type CompleteTiktokAuthorizationResult =
  | {
      ok: true;
      record: TiktokAuthorizationRecord;
      account_verification: { open_id: string; username: string | null; display_name: string | null };
    }
  | { ok: false; reason_code: string; detail: string; record: TiktokAuthorizationRecord | null };

export type TiktokAuthorizationStatusResult =
  | { ok: true; record: TiktokAuthorizationRecord }
  | { ok: false; reason_code: "AUTHORIZATION_NOT_FOUND" };

export type RevokeTiktokAuthorizationResult =
  | { ok: true; record: TiktokAuthorizationRecord }
  | { ok: false; reason_code: string; detail: string; record: TiktokAuthorizationRecord | null };

/** UI-facing read model — ไม่มี token, code_verifier หรือ field ใกล้ secret ใดๆ */
export interface TiktokPluginStatusReadModel {
  provider: "tiktok";
  display_name: string;
  logo_key: "tiktok";
  login_status: "LOGGED_IN" | "NOT_LOGGED_IN" | "PENDING";
  plugin_status: "READY" | "NOT_READY" | "PENDING" | "ERROR";
  account: string | null;
  authorization_status: TiktokAuthorizationState;
}
