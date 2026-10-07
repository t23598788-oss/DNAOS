/**
 * หน้าที่: TikTok Login Kit OAuth 2.0 client ตัวจริงตัวเดียว — สร้าง authorize
 * URL (พร้อม PKCE), แลก authorization code เป็น token, อ่านข้อมูลผู้ใช้เพื่อ
 * ยืนยันตัวตน, และเพิกถอน token
 *
 * ── ที่มาของ endpoint (ตรวจสดก่อนเขียน ไม่เดา) ──
 * ตรวจผ่าน WebFetch จากเอกสารทางการของ TikTok ก่อนเขียนไฟล์นี้ (2026-09-01):
 *   authorize   https://www.tiktok.com/v2/auth/authorize/
 *               params: client_key, scope, response_type=code, redirect_uri, state
 *               (developers.tiktok.com/doc/login-kit-web)
 *   token       POST https://open.tiktokapis.com/v2/oauth/token/
 *               form: client_key, client_secret, code, grant_type=authorization_code,
 *                     redirect_uri, code_verifier (required for desktop app)
 *               (developers.tiktok.com/doc/oauth-user-access-token-management)
 *   revoke      POST https://open.tiktokapis.com/v2/oauth/revoke/
 *               form: client_key, client_secret, token
 *   user info   GET https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,username
 *               header: Authorization: Bearer <access_token>
 *               (developers.tiktok.com/doc/tiktok-api-v2-get-user-info)
 *
 * ── สิ่งที่ยังยืนยันสด ๆ ไม่ได้ (บอกตรง ๆ ไม่แกล้งว่ารู้) ──
 * เอกสาร PKCE ของ TikTok ที่เข้าถึงได้ ไม่ได้ระบุชัดว่า code_challenge derive จาก
 * code_verifier อย่างไร ไฟล์นี้ทำตาม spec desktop ที่ TikTok ใช้ทั่วไป คือ
 *   code_challenge = sha256Hex(code_verifier)   (hex ตัวพิมพ์เล็ก ไม่ใช่ base64url)
 * และ **ไม่ส่ง** code_challenge_method (TikTok desktop อนุมานเอง) การ derive นี้
 * ถูกปักไว้ด้วย test vector ใน tests/ ถ้า TikTok ปฏิเสธ มันจะตอบ error จริง
 * (invalid_request/invalid_grant) — ไม่มีทางกลายเป็น success ปลอม เพราะ token
 * ที่ใช้ได้ต้องมาจาก TikTok เท่านั้น
 *
 * ไฟล์นี้ไม่ใช่ TikTok execution (การโพสต์/อ่านฟีดอยู่ที่ capability อื่น) หน้าที่
 * เดียวคือเปลี่ยน "Owner กดอนุญาตใน browser" ให้เป็น access_token จริงในหน่วยความจำ
 * ส่งกลับ ./lifecycle.ts ครั้งเดียว
 *
 * Input: client_key/client_secret/redirect_uri (Owner-provided ผ่าน env),
 *   code_verifier/code จาก flow.
 * Output: `buildAuthorizeUrl`, `deriveCodeChallenge`, `exchangeCodeForToken`,
 *   `getUserInfo`, `revokeAccessToken`, และ config reader.
 * Dependency ที่อนุญาต: ./host-runtime.ts เท่านั้น.
 * สิ่งที่ห้ามแตะ: ห้าม log/persist access_token/refresh_token/client_secret
 *   เกินกว่าการ return กลับ caller หนึ่งครั้ง. ห้ามเดา endpoint/param อื่น.
 */

import { hostFetchGet, hostFetchPost, readEnvVar, sha256Hex } from "./host-runtime";

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const REVOKE_URL = "https://open.tiktokapis.com/v2/oauth/revoke/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const USER_INFO_FIELDS = "open_id,union_id,display_name,username";

export interface TiktokOauthConfig {
  client_key: string;
  client_secret: string;
  redirect_uri: string;
}

/**
 * อ่าน config ของ TikTok app จาก env — client_key/redirect_uri เป็นค่าสาธารณะ,
 * client_secret เป็นความลับ (อ่านเข้าหน่วยความจำเฉพาะตอนแลก/เพิกถอน token เท่านั้น
 * ไม่เคยถูกเก็บลง record) env จึงเป็นแหล่ง canonical ของมัน ไม่ใช่ fallback
 *
 * DNA OS สร้าง TikTok app เองไม่ได้ — ต้องเป็น Owner สร้างที่
 * developers.tiktok.com แล้วตั้ง TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET /
 * TIKTOK_REDIRECT_URI เอง (วินัยเดียวกับ GITHUB_OAUTH_CLIENT_ID)
 */
export function readTiktokOauthConfig(): TiktokOauthConfig | { missing: string[] } {
  const client_key = readEnvVar("TIKTOK_CLIENT_KEY");
  const client_secret = readEnvVar("TIKTOK_CLIENT_SECRET");
  const redirect_uri = readEnvVar("TIKTOK_REDIRECT_URI");
  const missing: string[] = [];
  if (!client_key) missing.push("TIKTOK_CLIENT_KEY");
  if (!client_secret) missing.push("TIKTOK_CLIENT_SECRET");
  if (!redirect_uri) missing.push("TIKTOK_REDIRECT_URI");
  if (missing.length > 0) return { missing };
  return { client_key: client_key!, client_secret: client_secret!, redirect_uri: redirect_uri! };
}

/** PKCE: code_challenge = sha256Hex(code_verifier). ปักไว้ด้วย test vector. */
export function deriveCodeChallenge(codeVerifier: string): string {
  return sha256Hex(codeVerifier);
}

/**
 * สร้าง URL ที่ Owner ต้องเปิดเพื่อกดอนุญาต — DNA OS สร้างให้ ไม่กดแทน
 * ทุก parameter เข้ารหัส URL ตามมาตรฐาน state คือ nonce กัน CSRF ที่ต้อง
 * ตรงกันตอน callback
 */
export function buildAuthorizeUrl(config: TiktokOauthConfig, params: { scope: readonly string[]; state: string; codeVerifier: string }): string {
  const query = new URLSearchParams({
    client_key: config.client_key,
    scope: params.scope.join(","),
    response_type: "code",
    redirect_uri: config.redirect_uri,
    state: params.state,
    code_challenge: deriveCodeChallenge(params.codeVerifier),
  });
  return `${AUTHORIZE_URL}?${query.toString()}`;
}

export type TokenExchangeResult =
  | { ok: true; access_token: string; refresh_token: string | null; open_id: string; scope: string; expires_in: number }
  | { ok: false; reason_code: string; detail: string };

export async function exchangeCodeForToken(config: TiktokOauthConfig, params: { code: string; codeVerifier: string }): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    client_key: config.client_key,
    client_secret: config.client_secret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: config.redirect_uri,
    code_verifier: params.codeVerifier,
  }).toString();
  const outcome = await hostFetchPost(TOKEN_URL, { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, 10_000);
  if (outcome.kind === "transport_error") return { ok: false, reason_code: "TRANSPORT_ERROR", detail: outcome.reason };
  const parsed = (await outcome.response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!parsed) return { ok: false, reason_code: "MALFORMED_TOKEN_RESPONSE", detail: `HTTP ${outcome.response.status}` };
  // TikTok v2 คืน error เป็น field ระดับบน (error, error_description) เมื่อไม่สำเร็จ
  if (typeof parsed.error === "string" && parsed.error.length > 0) {
    return { ok: false, reason_code: String(parsed.error), detail: typeof parsed.error_description === "string" ? parsed.error_description : String(parsed.error) };
  }
  const { access_token, refresh_token, open_id, scope, expires_in } = parsed;
  if (typeof access_token !== "string" || typeof open_id !== "string" || typeof scope !== "string" || typeof expires_in !== "number") {
    return { ok: false, reason_code: "MALFORMED_TOKEN_RESPONSE", detail: JSON.stringify({ ...parsed, access_token: "<redacted>", refresh_token: "<redacted>" }) };
  }
  return { ok: true, access_token, refresh_token: typeof refresh_token === "string" ? refresh_token : null, open_id, scope, expires_in };
}

export type UserInfoResult =
  | { kind: "found"; open_id: string; union_id: string | null; display_name: string | null; username: string | null }
  | { kind: "failed"; reason: string };

export async function getUserInfo(accessToken: string): Promise<UserInfoResult> {
  const outcome = await hostFetchGet(`${USER_INFO_URL}?fields=${USER_INFO_FIELDS}`, { authorization: `Bearer ${accessToken}` }, 10_000);
  if (outcome.kind === "transport_error") return { kind: "failed", reason: `TRANSPORT_ERROR: ${outcome.reason}` };
  const parsed = (await outcome.response.json().catch(() => null)) as { data?: { user?: Record<string, unknown> }; error?: Record<string, unknown> } | null;
  if (!parsed) return { kind: "failed", reason: `MALFORMED_USER_INFO_RESPONSE: HTTP ${outcome.response.status}` };
  const errCode = parsed.error && typeof parsed.error.code === "string" ? parsed.error.code : null;
  if (errCode && errCode !== "ok") return { kind: "failed", reason: `${errCode}: ${typeof parsed.error?.message === "string" ? parsed.error.message : "user info error"}` };
  const user = parsed.data?.user ?? null;
  if (!user || typeof user.open_id !== "string") return { kind: "failed", reason: "USER_INFO_MISSING_OPEN_ID" };
  return {
    kind: "found",
    open_id: user.open_id,
    union_id: typeof user.union_id === "string" ? user.union_id : null,
    display_name: typeof user.display_name === "string" ? user.display_name : null,
    username: typeof user.username === "string" ? user.username : null,
  };
}

export type RevokeResult = { ok: true } | { ok: false; reason_code: string; detail: string };

export async function revokeAccessToken(config: TiktokOauthConfig, accessToken: string): Promise<RevokeResult> {
  const body = new URLSearchParams({ client_key: config.client_key, client_secret: config.client_secret, token: accessToken }).toString();
  const outcome = await hostFetchPost(REVOKE_URL, { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body, 10_000);
  if (outcome.kind === "transport_error") return { ok: false, reason_code: "TRANSPORT_ERROR", detail: outcome.reason };
  if (!outcome.response.ok) return { ok: false, reason_code: "REVOKE_FAILED", detail: `HTTP ${outcome.response.status}` };
  return { ok: true };
}

export const TIKTOK_OAUTH_ENDPOINTS = { AUTHORIZE_URL, TOKEN_URL, REVOKE_URL, USER_INFO_URL, USER_INFO_FIELDS } as const;
