/**
 * หน้าที่: พิสูจน์วงจรการอนุญาต TikTok ด้วยหลักฐานที่ตรวจได้ — ไม่มี network,
 * ไม่มี keychain จริง, ไม่มีเวลาเข้ามาเกี่ยว (inject `now`) ทุก dep ถูก inject
 *
 * เกณฑ์ที่ต้องผ่าน:
 *  - ยังไม่มี TikTok app → begin คืน owner_action ไม่ใช่ success ปลอม
 *  - มี app → authorize URL ถูกต้องตาม endpoint จริง + PKCE + CSRF state
 *  - state ไม่ตรง → ปฏิเสธ (กัน CSRF)
 *  - complete สำเร็จ → token ไปอยู่ Keychain เป็น credential_ref, ยืนยันบัญชีจริง,
 *    และ **ไม่มี token ดิบโผล่ใน record ที่ persist**
 *  - PKCE code_challenge = sha256Hex(code_verifier) ปักด้วย test vector
 *  - revoke → credential + record เป็น REVOKED
 *
 * รัน: npx tsx connections/tiktok-authorization/tests/lifecycle.test.ts
 */

import { deriveCodeChallenge, buildAuthorizeUrl, TIKTOK_OAUTH_ENDPOINTS } from "../tiktok-oauth";
import { beginAuthorization, completeAuthorization, revokeAuthorization, getAuthorizationStatus } from "../lifecycle";
import type { TiktokLifecycleDeps } from "../lifecycle";
import type { TiktokAuthorizationRecord } from "../types";
import { createHash } from "node:crypto";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const FIXED_NOW = new Date("2026-09-01T00:00:00.000Z");
const CONFIG = { client_key: "awtest_client_key", client_secret: "test_secret", redirect_uri: "https://127.0.0.1:5181/oauth/tiktok/callback" };

/** in-memory store + spies — ไม่มี I/O จริง */
function makeDeps(overrides: Partial<TiktokLifecycleDeps> = {}): { deps: TiktokLifecycleDeps; rows: TiktokAuthorizationRecord[]; keychainWrites: unknown[]; statusSets: [string, string][] } {
  const rows: TiktokAuthorizationRecord[] = [];
  const keychainWrites: unknown[] = [];
  const statusSets: [string, string][] = [];
  const base: TiktokLifecycleDeps = {
    readConfig: () => CONFIG,
    buildAuthorizeUrl,
    exchangeCodeForToken: async () => ({ ok: true, access_token: "act.SECRET_TOKEN", refresh_token: "rft.SECRET", open_id: "open-123", scope: "user.info.basic,video.publish", expires_in: 86400 }),
    getUserInfo: async () => ({ kind: "found", open_id: "open-123", union_id: "union-9", display_name: "ช.ธวัชชัยการช่าง", username: "user30932384913455" }),
    revokeAccessToken: async () => ({ ok: true }),
    registerOwnerApiCredential: async (input) => { keychainWrites.push(input); return { credential_ref: input.credential_ref, status: "ACTIVE" }; },
    findApiCredential: () => null,
    setApiCredentialStatus: (ref, status) => { statusSets.push([ref, status]); return null as never; },
    findRecord: (id) => [...rows].reverse().find((r) => r.connection_id === id) ?? null,
    upsertRecord: (r) => { rows.push(r); return r; },
    randomHex: (bytes) => "a".repeat(bytes * 2),
    now: () => FIXED_NOW,
  };
  return { deps: { ...base, ...overrides }, rows, keychainWrites, statusSets };
}

// ── PKCE derivation ปักด้วย test vector ──
{
  const verifier = "b".repeat(96);
  const expected = createHash("sha256").update(verifier).digest("hex");
  ok("PKCE: code_challenge = sha256Hex(code_verifier)", deriveCodeChallenge(verifier) === expected, deriveCodeChallenge(verifier));
  ok("PKCE: code_challenge เป็น hex 64 ตัว (ไม่ใช่ base64url)", /^[0-9a-f]{64}$/.test(deriveCodeChallenge(verifier)));
}

// ── endpoint ตรงกับที่ verified จากเอกสาร TikTok ──
{
  ok("authorize endpoint ถูกต้อง", TIKTOK_OAUTH_ENDPOINTS.AUTHORIZE_URL === "https://www.tiktok.com/v2/auth/authorize/");
  ok("token endpoint ถูกต้อง", TIKTOK_OAUTH_ENDPOINTS.TOKEN_URL === "https://open.tiktokapis.com/v2/oauth/token/");
  ok("revoke endpoint ถูกต้อง", TIKTOK_OAUTH_ENDPOINTS.REVOKE_URL === "https://open.tiktokapis.com/v2/oauth/revoke/");
  ok("user info endpoint ถูกต้อง", TIKTOK_OAUTH_ENDPOINTS.USER_INFO_URL === "https://open.tiktokapis.com/v2/user/info/");
}

// ── ยังไม่มี TikTok app → owner_action ไม่ใช่ success ปลอม ──
{
  const { deps, rows } = makeDeps({ readConfig: () => ({ missing: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"] }) });
  const r = beginAuthorization({ scope: ["user.info.basic"] }, deps);
  ok("ไม่มี app → begin ไม่สำเร็จ", r.ok === false);
  ok("ไม่มี app → reason = TIKTOK_OAUTH_CLIENT_NOT_CONFIGURED", r.ok === false && r.reason_code === "TIKTOK_OAUTH_CLIENT_NOT_CONFIGURED");
  ok("ไม่มี app → บอก owner_action ให้ Owner ไปสร้างเอง", r.ok === false && typeof r.owner_action === "string" && r.owner_action.includes("developers.tiktok.com"));
  ok("ไม่มี app → record เป็น AUTHORIZATION_REQUIRED (ไม่ใช่ CONNECTED)", rows[rows.length - 1].state === "AUTHORIZATION_REQUIRED");
}

// ── มี app → authorize URL ถูกต้อง + PKCE + state ──
let issuedState = "";
{
  const { deps, rows } = makeDeps();
  const r = beginAuthorization({ scope: ["user.info.basic", "video.publish"] }, deps);
  ok("มี app → begin สำเร็จ", r.ok === true);
  if (r.ok) {
    issuedState = r.state_nonce;
    const url = new URL(r.authorize_url);
    ok("authorize URL ชี้ endpoint จริงของ TikTok", `${url.origin}${url.pathname}` === "https://www.tiktok.com/v2/auth/authorize/");
    ok("authorize URL มี client_key จาก config", url.searchParams.get("client_key") === CONFIG.client_key);
    ok("authorize URL response_type=code", url.searchParams.get("response_type") === "code");
    ok("authorize URL scope คั่นด้วย comma", url.searchParams.get("scope") === "user.info.basic,video.publish");
    ok("authorize URL redirect_uri จาก config", url.searchParams.get("redirect_uri") === CONFIG.redirect_uri);
    ok("authorize URL มี code_challenge (PKCE)", /^[0-9a-f]{64}$/.test(url.searchParams.get("code_challenge") ?? ""));
    ok("authorize URL state = nonce", url.searchParams.get("state") === r.state_nonce);
    ok("begin เก็บ record เป็น AUTHORIZATION_PENDING", rows[rows.length - 1].state === "AUTHORIZATION_PENDING");
    ok("begin ไม่เก็บ token ใดๆ (ยังไม่มี)", rows[rows.length - 1].credential_ref === null);
  }
}

async function main() {
// ── state ไม่ตรง → กัน CSRF ──
{
  const { deps } = makeDeps();
  beginAuthorization({ scope: ["user.info.basic"] }, deps);
  const r = await completeAuthorization({ connection_id: "connection://tiktok/SOCIAL_ACCOUNT/owner-primary", code: "auth_code", state: "WRONG_STATE" }, deps);
  ok("state ไม่ตรง → complete ปฏิเสธ", r.ok === false && r.reason_code === "STATE_MISMATCH");
}

// ── complete สำเร็จ → token เข้า Keychain, ยืนยันบัญชี, ไม่มี token ดิบใน record ──
{
  const { deps, rows, keychainWrites } = makeDeps();
  const begin = beginAuthorization({ scope: ["user.info.basic"] }, deps);
  const state = begin.ok ? begin.state_nonce : "";
  const r = await completeAuthorization({ connection_id: "connection://tiktok/SOCIAL_ACCOUNT/owner-primary", code: "auth_code", state }, deps);
  ok("complete สำเร็จ", r.ok === true);
  ok("complete → state CONNECTED", r.ok === true && r.record.state === "CONNECTED");
  ok("complete → ยืนยัน open_id จริงจาก TikTok", r.ok === true && r.account_verification.open_id === "open-123");
  ok("complete → account = username จริง", r.ok === true && r.record.account === "user30932384913455");
  ok("token ถูกเขียนลง Keychain หนึ่งครั้ง", keychainWrites.length === 1);
  ok("credential_ref เป็นการอ้างอิง ไม่ใช่ token", r.ok === true && r.record.credential_ref === "credential://tiktok/open-123/social-account");
  // ยามสำคัญ: ไม่มี token/refresh ดิบโผล่ในไฟล์ที่ persist เลย
  const serialized = JSON.stringify(rows);
  ok("ไม่มี access_token ดิบใน record ที่ persist", !serialized.includes("act.SECRET_TOKEN"));
  ok("ไม่มี refresh_token ดิบใน record ที่ persist", !serialized.includes("rft.SECRET"));
  ok("code_verifier ถูกล้างหลัง connected", r.ok === true && r.record.code_verifier === null);
}

// ── token exchange ล้มเหลว → รายงาน reason จริง ไม่แกล้งสำเร็จ ──
{
  const { deps, rows } = makeDeps({ exchangeCodeForToken: async () => ({ ok: false, reason_code: "invalid_grant", detail: "code expired" }) });
  const begin = beginAuthorization({ scope: ["user.info.basic"] }, deps);
  const state = begin.ok ? begin.state_nonce : "";
  const r = await completeAuthorization({ connection_id: "connection://tiktok/SOCIAL_ACCOUNT/owner-primary", code: "bad", state }, deps);
  ok("exchange ล้ม → complete ไม่สำเร็จ พร้อม reason จริง", r.ok === false && r.reason_code === "invalid_grant");
  ok("exchange ล้ม → record เป็น AUTHORIZATION_FAILED", rows[rows.length - 1].state === "AUTHORIZATION_FAILED");
}

// ── revoke → credential + record REVOKED ──
{
  const { deps, statusSets } = makeDeps();
  const begin = beginAuthorization({ scope: ["user.info.basic"] }, deps);
  const state = begin.ok ? begin.state_nonce : "";
  await completeAuthorization({ connection_id: "connection://tiktok/SOCIAL_ACCOUNT/owner-primary", code: "auth_code", state }, deps);
  const r = await revokeAuthorization("connection://tiktok/SOCIAL_ACCOUNT/owner-primary", deps);
  ok("revoke สำเร็จ", r.ok === true && r.record.state === "REVOKED");
  ok("revoke → credential ถูก mark REVOKED", statusSets.some(([, s]) => s === "REVOKED"));
  const status = getAuthorizationStatus("connection://tiktok/SOCIAL_ACCOUNT/owner-primary", deps);
  ok("status หลัง revoke = REVOKED", status.ok === true && status.record.state === "REVOKED");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
}

void main();
