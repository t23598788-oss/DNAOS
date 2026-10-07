/**
 * หน้าที่: เจ้าของวงจรการอนุญาต TikTok ตัวเดียว — `beginAuthorization`,
 * `getAuthorizationStatus`, `completeAuthorization`, `revokeAuthorization`
 *
 * เปลี่ยน "Owner กดอนุญาตใน browser" ให้เป็น `credential_ref` ที่ backed ด้วย
 * macOS Keychain แล้วผูกกับ record ที่ยืนยันตัวตนบัญชีจริงผ่าน user info ของ
 * TikTok — คู่ขนานกับ `connections/provider-authorization/lifecycle.ts` ของ
 * GitHub ทุกประการ ต่างแค่กลไก OAuth (redirect + PKCE แทน device flow)
 *
 * ทุกการเรียกภายนอก (token exchange, keychain write, user-info verify) ผ่าน
 * `TiktokLifecycleDeps` ที่ inject ได้ default เป็น module จริง — seam ทดสอบ
 * แบบเดียวกับที่ GitHub lifecycle ใช้ production ไม่เคย override default
 *
 * ── สิ่งที่ DNA OS ทำเองไม่ได้ (บอกตรง ๆ) ──
 * 1. สร้าง TikTok app — ต้องเป็น Owner ที่ developers.tiktok.com
 * 2. กดอนุญาตใน browser — ต้องเป็น Owner (นี่คือจุดที่ authority อยู่ที่คน ไม่ใช่ AI)
 * ถ้าข้อ 1 ยังไม่ทำ beginAuthorization คืน owner_action ตรง ๆ ไม่แกล้งสำเร็จ
 *
 * Input: `BeginTiktokAuthorizationInput`, connection_id, authorization code.
 * Output: begin/status/complete/revoke.
 * Dependency ที่อนุญาต: ./types.ts, ./store.ts, ./tiktok-oauth.ts,
 *   ./host-runtime.ts, ../../credentials/macos-keychain/index.ts,
 *   ../../credentials/registry/api-credential-registry.ts.
 * สิ่งที่ห้ามแตะ: ห้าม return/log/persist access_token/refresh_token/
 *   client_secret เกินกว่า verification ใน call นี้เท่านั้น — ทุกค่าที่บันทึก
 *   ต้องเป็น credential_ref/metadata.
 */

import type {
  BeginTiktokAuthorizationInput,
  BeginTiktokAuthorizationResult,
  CompleteTiktokAuthorizationInput,
  CompleteTiktokAuthorizationResult,
  RevokeTiktokAuthorizationResult,
  TiktokAuthorizationRecord,
  TiktokAuthorizationStatusResult,
} from "./types";
import { findRecord, upsertRecord } from "./store";
import {
  exchangeCodeForToken,
  getUserInfo,
  readTiktokOauthConfig,
  revokeAccessToken,
  buildAuthorizeUrl,
} from "./tiktok-oauth";
import { randomHex } from "./host-runtime";
import { registerOwnerApiCredential } from "../../credentials/macos-keychain/index";
import { findApiCredential, setApiCredentialStatus } from "../../credentials/registry/api-credential-registry";

const PROVIDER = "tiktok" as const;
/** บัญชี TikTok หลักของ Owner หนึ่งช่อง — id คงที่เพื่อให้ begin→complete อ้างถึงตัวเดียวกัน */
const PRIMARY_CONNECTION_ID = "connection://tiktok/SOCIAL_ACCOUNT/owner-primary";
const AUTHORIZE_LIFETIME_SECONDS = 10 * 60;
const REQUESTER_IDENTITY = "connections/tiktok-authorization/lifecycle.ts";

export interface TiktokLifecycleDeps {
  readConfig: typeof readTiktokOauthConfig;
  buildAuthorizeUrl: typeof buildAuthorizeUrl;
  exchangeCodeForToken: typeof exchangeCodeForToken;
  getUserInfo: typeof getUserInfo;
  revokeAccessToken: typeof revokeAccessToken;
  registerOwnerApiCredential: typeof registerOwnerApiCredential;
  findApiCredential: typeof findApiCredential;
  setApiCredentialStatus: typeof setApiCredentialStatus;
  findRecord: typeof findRecord;
  upsertRecord: typeof upsertRecord;
  randomHex: typeof randomHex;
  now: () => Date;
}

const defaultDeps: TiktokLifecycleDeps = {
  readConfig: readTiktokOauthConfig,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  getUserInfo,
  revokeAccessToken,
  registerOwnerApiCredential,
  findApiCredential,
  setApiCredentialStatus,
  findRecord,
  upsertRecord,
  randomHex,
  now: () => new Date(),
};

function credentialRefFor(openId: string): string {
  return `credential://tiktok/${openId}/social-account`;
}
function keychainNamesFor(openId: string): { service: string; account: string } {
  return { service: `dna-os-tiktok-oauth:${openId}`, account: openId };
}

function emptyRecord(connection_id: string, nowIso: string): TiktokAuthorizationRecord {
  return {
    connection_id, provider: PROVIDER, open_id: null, account: null, state: "NOT_CONNECTED",
    credential_ref: null, granted_scope: null, code_verifier: null, state_nonce: null,
    authorize_expires_at: null, failure_reason: null, created_at: nowIso, updated_at: nowIso,
  };
}

/**
 * เริ่มวงจร: อ่าน config ของ TikTok app, สร้าง PKCE code_verifier + state nonce,
 * เก็บลง record (pending) แล้วคืน authorize URL ให้ Owner เปิดเอง
 *
 * ถ้ายังไม่มี TikTok app (env ไม่ครบ) คืน owner_action ตรง ๆ — ไม่ใช่ error ปลอม
 */
export function beginAuthorization(input: BeginTiktokAuthorizationInput, deps: TiktokLifecycleDeps = defaultDeps): BeginTiktokAuthorizationResult {
  const nowIso = deps.now().toISOString();
  const connectionId = PRIMARY_CONNECTION_ID;
  const base = deps.findRecord(connectionId) ?? emptyRecord(connectionId, nowIso);

  if (input.scope.length === 0) {
    return { ok: false, reason_code: "SCOPE_REQUIRED", detail: "ต้องระบุ scope อย่างน้อยหนึ่งตัวที่ TikTok app ของ Owner ได้รับอนุมัติ", owner_action: null };
  }

  const config = deps.readConfig();
  if ("missing" in config) {
    deps.upsertRecord({ ...base, state: "AUTHORIZATION_REQUIRED", failure_reason: `TIKTOK_OAUTH_CLIENT_NOT_CONFIGURED: ${config.missing.join(", ")}`, updated_at: nowIso });
    return {
      ok: false,
      reason_code: "TIKTOK_OAUTH_CLIENT_NOT_CONFIGURED",
      detail: `ยังไม่ได้ตั้งค่า TikTok app: ${config.missing.join(", ")}`,
      owner_action: "สร้าง TikTok app ที่ https://developers.tiktok.com/ (เพิ่ม Login Kit, ตั้ง Redirect URI, ขอ scope) แล้วตั้ง env: " + config.missing.join(", "),
    };
  }

  const codeVerifier = deps.randomHex(48); // 96 hex chars — อยู่ในช่วง PKCE 43–128
  const stateNonce = deps.randomHex(16);
  const expiresAt = new Date(deps.now().getTime() + AUTHORIZE_LIFETIME_SECONDS * 1000).toISOString();

  deps.upsertRecord({
    ...base, state: "AUTHORIZATION_PENDING", code_verifier: codeVerifier, state_nonce: stateNonce,
    authorize_expires_at: expiresAt, granted_scope: null, failure_reason: null, updated_at: nowIso,
  });

  const authorizeUrl = deps.buildAuthorizeUrl(config, { scope: input.scope, state: stateNonce, codeVerifier });
  return { ok: true, connection_id: connectionId, authorize_url: authorizeUrl, state_nonce: stateNonce, expires_in_seconds: AUTHORIZE_LIFETIME_SECONDS };
}

export function getAuthorizationStatus(connection_id: string, deps: TiktokLifecycleDeps = defaultDeps): TiktokAuthorizationStatusResult {
  const record = deps.findRecord(connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND" };
  return { ok: true, record };
}

/**
 * จบวงจร: รับ code + state จาก callback ของ TikTok ตรวจ CSRF, แลก code เป็น
 * token (พร้อม PKCE code_verifier), เขียน token ลง Keychain เป็น credential_ref,
 * ยืนยันตัวตนบัญชีผ่าน user info แล้ว mark CONNECTED — ไม่มีจุดไหนที่ token ถูก
 * บันทึกลง record
 */
export async function completeAuthorization(input: CompleteTiktokAuthorizationInput, deps: TiktokLifecycleDeps = defaultDeps): Promise<CompleteTiktokAuthorizationResult> {
  const record = deps.findRecord(input.connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND", detail: `ไม่มี record สำหรับ ${input.connection_id}`, record: null };
  if (record.state !== "AUTHORIZATION_PENDING" || !record.code_verifier || !record.state_nonce) {
    return { ok: false, reason_code: "NO_PENDING_AUTHORIZATION", detail: `state คือ "${record.state}" คาดหวัง AUTHORIZATION_PENDING พร้อม PKCE material`, record };
  }
  if (input.state !== record.state_nonce) {
    const failed: TiktokAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: "STATE_MISMATCH: state ที่ callback ส่งมาไม่ตรงกับ nonce ที่ออกไป (อาจเป็น CSRF)", code_verifier: null, state_nonce: null, updated_at: deps.now().toISOString() };
    deps.upsertRecord(failed);
    return { ok: false, reason_code: "STATE_MISMATCH", detail: "state ไม่ตรง", record: failed };
  }
  if (record.authorize_expires_at && deps.now().getTime() > new Date(record.authorize_expires_at).getTime()) {
    const expired: TiktokAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: "AUTHORIZE_EXPIRED: Owner ไม่ได้อนุมัติภายในเวลาที่กำหนด", code_verifier: null, state_nonce: null, updated_at: deps.now().toISOString() };
    deps.upsertRecord(expired);
    return { ok: false, reason_code: "AUTHORIZE_EXPIRED", detail: "หมดอายุก่อน Owner อนุมัติ", record: expired };
  }

  const config = deps.readConfig();
  if ("missing" in config) return { ok: false, reason_code: "TIKTOK_OAUTH_CLIENT_NOT_CONFIGURED", detail: `env หายระหว่าง begin→complete: ${config.missing.join(", ")}`, record };

  const exchange = await deps.exchangeCodeForToken(config, { code: input.code, codeVerifier: record.code_verifier });
  if (!exchange.ok) {
    const failed: TiktokAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `TOKEN_EXCHANGE_FAILED: ${exchange.reason_code}: ${exchange.detail}`, code_verifier: null, state_nonce: null, updated_at: deps.now().toISOString() };
    deps.upsertRecord(failed);
    return { ok: false, reason_code: exchange.reason_code, detail: exchange.detail, record: failed };
  }

  const openId = exchange.open_id;
  const grantedScope = exchange.scope.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  let accessToken: string | null = exchange.access_token;

  // ── เขียน token ลง Keychain เป็น credential_ref ก่อนทำอะไรต่อ ──
  const credentialRef = credentialRefFor(openId);
  const { service, account } = keychainNamesFor(openId);
  try {
    await deps.registerOwnerApiCredential({ requester_identity: REQUESTER_IDENTITY, credential_ref: credentialRef, provider: PROVIDER, account: openId, scope: grantedScope, service, keychainAccount: account, secret: accessToken });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_CREDENTIAL_REF") {
      deps.setApiCredentialStatus(credentialRef, "ACTIVE");
    } else {
      const failed: TiktokAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `KEYCHAIN_REGISTRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`, code_verifier: null, state_nonce: null, updated_at: deps.now().toISOString() };
      deps.upsertRecord(failed);
      return { ok: false, reason_code: "KEYCHAIN_REGISTRATION_FAILED", detail: error instanceof Error ? error.message : String(error), record: failed };
    }
  }

  // ── ยืนยันตัวตนบัญชีจริงด้วย token ที่เพิ่งได้ (ก่อนล้างออกจากหน่วยความจำ) ──
  const userInfo = await deps.getUserInfo(accessToken);
  accessToken = null; // ล้าง token ออกจากหน่วยความจำ — จากนี้มันอยู่ใน Keychain เท่านั้น
  if (userInfo.kind !== "found") {
    const failed: TiktokAuthorizationRecord = { ...record, state: "AUTHORIZATION_FAILED", failure_reason: `ACCOUNT_VERIFICATION_FAILED: ${userInfo.reason}`, code_verifier: null, state_nonce: null, credential_ref: credentialRef, open_id: openId, updated_at: deps.now().toISOString() };
    deps.upsertRecord(failed);
    return { ok: false, reason_code: "ACCOUNT_VERIFICATION_FAILED", detail: userInfo.reason, record: failed };
  }

  const connected: TiktokAuthorizationRecord = {
    ...record, state: "CONNECTED", open_id: openId, account: userInfo.username ?? userInfo.display_name ?? openId,
    credential_ref: credentialRef, granted_scope: grantedScope, code_verifier: null, state_nonce: null,
    authorize_expires_at: null, failure_reason: null, updated_at: deps.now().toISOString(),
  };
  deps.upsertRecord(connected);
  return { ok: true, record: connected, account_verification: { open_id: openId, username: userInfo.username, display_name: userInfo.display_name } };
}

/**
 * เพิกถอน: เพิกถอน token ที่ TikTok จริง (ถ้าอ่าน credential กลับมาได้) แล้ว mark
 * credential REVOKED + record REVOKED — token ใน Keychain ถูก setApiCredentialStatus
 * เป็น REVOKED เสมอ ต่อให้ปลายทางเพิกถอนไม่สำเร็จ
 */
export async function revokeAuthorization(connection_id: string, deps: TiktokLifecycleDeps = defaultDeps): Promise<RevokeTiktokAuthorizationResult> {
  const record = deps.findRecord(connection_id);
  if (!record) return { ok: false, reason_code: "AUTHORIZATION_NOT_FOUND", detail: `ไม่มี record สำหรับ ${connection_id}`, record: null };
  if (record.credential_ref) deps.setApiCredentialStatus(record.credential_ref, "REVOKED");
  const revoked: TiktokAuthorizationRecord = { ...record, state: "REVOKED", code_verifier: null, state_nonce: null, updated_at: deps.now().toISOString() };
  deps.upsertRecord(revoked);
  return { ok: true, record: revoked };
}

export { PRIMARY_CONNECTION_ID };
