/**
 * Phase 6 — LOGIN authority: NO LEASE→DENY, VALID→ref only, WRONG PROVIDER→DENY,
 * EXPIRED/REVOKED→DENY, AGENT RAW SECRET→DENY, secret ไม่โผล่ในผลลัพธ์
 * รัน: npx tsx control/computer-use-executor/tests/login-authority.test.ts
 */
import { requestLogin } from "../login-authority";
import type { LoginDeps } from "../login-authority";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const CRED = { credential_ref: "credential://tiktok/open-x/social-account", provider: "tiktok", account: "open-x", scope: ["user.info.basic"], status: "ACTIVE" as const, created_at: "", updated_at: "", resolver_kind: "macos_keychain" as const, resolver_service: "s", resolver_account: "a" };
const okAuth = { ok: true as const, lease: {} as never };

function deps(over: Partial<LoginDeps> = {}): LoginDeps {
  return { validateAuthority: (() => okAuth) as never, findApiCredential: (() => CRED) as never, ...over };
}

// agent ขอ raw secret → DENY
ok("agent ขอ raw secret → DENY", requestLogin({ authority_id: "a", requester: "agent:claude", provider: "tiktok", credential_ref: CRED.credential_ref, want_raw_secret: true }, deps()).ok === false);

// no lease → DENY
ok("no lease → DENY", requestLogin({ authority_id: "a", requester: "agent:claude", provider: "tiktok", credential_ref: CRED.credential_ref }, deps({ validateAuthority: (() => ({ ok: false, reason_code: "AUTHORITY_NOT_FOUND", detail: "x" })) as never })).ok === false);

// valid → คืน reference เท่านั้น (ไม่มี secret)
{
  const r = requestLogin({ authority_id: "a", requester: "agent:claude", provider: "tiktok", credential_ref: CRED.credential_ref }, deps());
  ok("valid lease → authorized", r.ok === true);
  ok("คืน credential_reference (ไม่ใช่ secret)", r.ok === true && r.credential_reference === CRED.credential_ref);
  const serialized = JSON.stringify(r);
  ok("ผลลัพธ์ไม่มีคำว่า secret/token/password ใด ๆ", !/secret|token|password|access_tok/i.test(serialized));
  ok("execution_owner = DNA OS executor", r.ok === true && r.execution_owner === "control/computer-use-executor");
}

// wrong provider → DENY
ok("wrong provider → DENY", requestLogin({ authority_id: "a", requester: "agent:claude", provider: "github", credential_ref: CRED.credential_ref }, deps()).ok === false);

// credential not active → DENY
ok("credential REVOKED → DENY", requestLogin({ authority_id: "a", requester: "agent:claude", provider: "tiktok", credential_ref: CRED.credential_ref }, deps({ findApiCredential: (() => ({ ...CRED, status: "REVOKED" })) as never })).ok === false);

// credential ref not found → DENY
ok("credential ref not found → DENY", requestLogin({ authority_id: "a", requester: "agent:claude", provider: "tiktok", credential_ref: "nope" }, deps({ findApiCredential: (() => null) as never })).ok === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
