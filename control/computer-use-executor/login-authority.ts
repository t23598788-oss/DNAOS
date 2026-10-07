/**
 * หน้าที่: ประตู LOGIN ของ DNA OS — agent ขอ LOGIN(provider) ได้ แต่ **ไม่มีวันได้ secret**
 *
 * เส้นทาง:
 *   requester(agent) ขอ LOGIN(provider)
 *   → validateAuthority (lease ต้องมี operation=login, target=provider, high_risk_explicit)
 *   → resolve credential_reference (จาก credentials registry — reference เท่านั้น ไม่ใช่ค่า)
 *   → คืนให้ agent เฉพาะ { authorized, credential_reference, session_action }
 *
 * ── กฎเหล็ก ──
 * - ไม่มี field ใดในผลลัพธ์ที่เป็น secret (โครงสร้างบังคับ)
 * - ถ้า agent ขอ raw secret ตรง ๆ (want_raw_secret) → DENY เสมอ
 * - login เป็น LEVEL 4 → lease ต้อง high_risk_explicit (บังคับที่ validateAuthority แล้ว)
 * - executor เป็นผู้ใช้ credential ที่ execution boundary ไม่ส่งค่ากลับ requester
 *
 * Input: LoginRequest.
 * Output: requestLogin -> LoginAuthorizationResult (ไม่มี secret).
 * Dependency ที่อนุญาต: ../computer-use-authority/contract.ts,
 *   ../../credentials/registry/api-credential-registry.ts.
 * สิ่งที่ห้ามแตะ: ห้าม return/log ค่า secret; ห้ามให้ requester เป็น executor.
 */

import { validateAuthority, revokeAuthority } from "../computer-use-authority/contract";
import { findApiCredential } from "../../credentials/registry/api-credential-registry";
import { EXECUTOR_IDENTITY } from "./executor";

export interface LoginRequest {
  authority_id: string;
  requester: string;
  provider: string;                 // เช่น "tiktok", "github"
  credential_ref: string;           // reference ที่ agent อ้าง (ไม่ใช่ secret)
  /** ถ้า agent พยายามขอค่า secret ดิบ — ต้องถูกปฏิเสธเสมอ */
  want_raw_secret?: boolean;
}

export type LoginAuthorizationResult =
  | {
      ok: true;
      provider: string;
      /** reference เท่านั้น — ไม่ใช่ secret */
      credential_reference: string;
      credential_status: string;
      session_action: "EXECUTOR_MAY_START_LOGIN_FLOW";
      execution_owner: string;
    }
  | { ok: false; reason_code: string; detail: string };

export interface LoginDeps {
  validateAuthority: typeof validateAuthority;
  findApiCredential: typeof findApiCredential;
}
const defaultDeps: LoginDeps = { validateAuthority, findApiCredential };

export function requestLogin(req: LoginRequest, deps: LoginDeps = defaultDeps): LoginAuthorizationResult {
  // 0) agent ขอ secret ดิบ = ปฏิเสธทันที ไม่ว่าอะไร
  if (req.want_raw_secret === true) {
    return { ok: false, reason_code: "RAW_SECRET_DENIED", detail: "requester ขอค่า secret ดิบไม่ได้ — DNA OS ใช้ credential ที่ execution boundary เท่านั้น" };
  }
  // 1) lease: ต้อง login (LEVEL4), target=provider, high_risk_explicit — validate บังคับหมด
  const auth = deps.validateAuthority({
    authority_id: req.authority_id, requester: req.requester, executor: EXECUTOR_IDENTITY,
    operation: "login", target: req.provider,
  });
  if (!auth.ok) return { ok: false, reason_code: auth.reason_code, detail: auth.detail };

  // 2) resolve credential_reference (registry คืน metadata + reference เท่านั้น ไม่มี secret)
  const cred = deps.findApiCredential(req.credential_ref);
  if (!cred) return { ok: false, reason_code: "CREDENTIAL_REFERENCE_NOT_FOUND", detail: req.credential_ref };
  if (cred.provider !== req.provider) return { ok: false, reason_code: "CREDENTIAL_PROVIDER_MISMATCH", detail: `${cred.provider} != ${req.provider}` };
  if (cred.status !== "ACTIVE") return { ok: false, reason_code: "CREDENTIAL_NOT_ACTIVE", detail: cred.status };

  // 3) คืนให้ agent เฉพาะ reference — executor เท่านั้นที่จะใช้ค่าจริงตอน login
  return {
    ok: true,
    provider: req.provider,
    credential_reference: cred.credential_ref,
    credential_status: cred.status,
    session_action: "EXECUTOR_MAY_START_LOGIN_FLOW",
    execution_owner: EXECUTOR_IDENTITY,
  };
}

export interface LoginAttemptResult {
  provider: string;
  authorized: boolean;
  login_authorization_revoked: boolean;   // ต้อง true เสมอหลัง attempt (success หรือ fail)
  credential_reference: string | null;    // reference เท่านั้น
  reason: string;
}

/**
 * ดำเนิน login attempt แล้ว **auto-revoke authorization ทันที** ไม่ว่าจะสำเร็จหรือล้ม
 * (LOGIN_ATTEMPT_COMPLETED => LOGIN_AUTH_REVOKED) — login authorization ใช้ครั้งเดียว
 * ห้ามเอาไปใช้ operation อื่นต่อ และ secret ไม่กลับ agent
 *
 * NB: การ "perform login" จริง (browser/network) อยู่ที่ execution boundary ของ executor
 * ฟังก์ชันนี้พิสูจน์ขอบเขต authorization + auto-revoke; ตัว perform ไม่ส่ง secret กลับ
 */
export function performLoginAttempt(
  req: LoginRequest,
  attempt: (credential_reference: string) => { success: boolean; reason: string },
  deps: LoginDeps = defaultDeps,
  revoke: typeof revokeAuthority = revokeAuthority,
): LoginAttemptResult {
  const auth = requestLogin(req, deps);
  if (!auth.ok) {
    // ไม่มี authorization ให้ revoke อยู่แล้ว — แต่ถ้ามี authority_id ให้ล้างกันเหนียว
    revoke(req.authority_id);
    return { provider: req.provider, authorized: false, login_authorization_revoked: true, credential_reference: null, reason: auth.reason_code };
  }
  // executor ใช้ credential_reference ทำ login ที่ boundary — ผล success/fail ไม่มี secret
  const result = attempt(auth.credential_reference);
  // auto-revoke ทันทีหลัง attempt ไม่ว่าผลอะไร
  const rv = revoke(req.authority_id);
  return { provider: req.provider, authorized: true, login_authorization_revoked: rv.ok, credential_reference: auth.credential_reference, reason: result.success ? "LOGIN_SUCCESS_AUTO_REVOKED" : `LOGIN_FAILURE_AUTO_REVOKED: ${result.reason}` };
}
