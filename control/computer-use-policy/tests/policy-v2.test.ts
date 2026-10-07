/**
 * V2 authorization model — TEST_A..H (deterministic, injected deps)
 * รัน: npx tsx control/computer-use-policy/tests/policy-v2.test.ts
 */
import { resolveComputerUseAuthorization, completeJob } from "../resolve";
import type { ResolveDeps } from "../resolve";
import { performLoginAttempt } from "../../computer-use-executor/login-authority";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const preauth = (on: boolean) => () => ({ preauthorized: on, preauth_max_level: 2 as const, set_by_owner_session: "sess", owner_identity: "tam", updated_at: "" });
const grantOk = ((i: never) => ({ ok: true, lease: { authority_id: "auth-new" } })) as never;
const validate = (result: { ok: boolean; reason_code?: string }) => (() => result.ok ? { ok: true, lease: {} } : { ok: false, reason_code: result.reason_code ?? "DENY", detail: "" }) as never;
const deps = (on: boolean, validateResult: { ok: boolean; reason_code?: string } = { ok: true }): ResolveDeps => ({ readPreauthorization: preauth(on) as never, grantAuthority: grantOk, validateAuthority: validate(validateResult) });

const normal = { work_order_id: "w", requester: "agent:claude", operation: "screenshot" as const, target: "screen", scope: [], ttl_seconds: 120 };

// TEST_A: ON + normal WO → execute ได้โดยไม่ขอ approval ซ้ำ
{
  const r = resolveComputerUseAuthorization(normal, deps(true));
  ok("TEST_A: ON + normal → PREAUTHORIZED (auto-grant, ไม่ขอ approval)", r.ok === true && r.mode === "PREAUTHORIZED" && "authority_id" in r);
}
// TEST_B: OFF + ไม่มี task auth → OWNER_APPROVAL_REQUIRED
{
  const r = resolveComputerUseAuthorization(normal, deps(false));
  ok("TEST_B: OFF + ไม่มี task auth → OWNER_APPROVAL_REQUIRED (ไม่ใช่ disabled)", r.ok === false && r.mode === "OWNER_APPROVAL_REQUIRED");
}
// TEST_C: OFF + task auth valid → execute → JOB_COMPLETED → revoked
{
  const r = resolveComputerUseAuthorization({ ...normal, task_authority_id: "task-1" }, deps(false, { ok: true }));
  ok("TEST_C: OFF + task auth → TASK_SCOPED", r.ok === true && r.mode === "TASK_SCOPED");
  let revoked = false;
  const c = completeJob("task-1", (() => { revoked = true; return { ok: true, lease: {} }; }) as never);
  ok("TEST_C: JOB_COMPLETED → revoke ทันที (แม้ ttl เหลือ)", Boolean(c.revoked) && Boolean(revoked));
}
// TEST_D: TTL expired → DENY
{
  const r = resolveComputerUseAuthorization({ ...normal, task_authority_id: "task-x" }, deps(false, { ok: false, reason_code: "AUTHORITY_EXPIRED" }));
  ok("TEST_D: TTL expired → DENY", r.ok === false && r.mode === "DENY");
}
// TEST_E: Owner revoke ระหว่างงาน → operation ถัดไป DENY
{
  const r = resolveComputerUseAuthorization({ ...normal, task_authority_id: "task-r" }, deps(false, { ok: false, reason_code: "AUTHORITY_REVOKED" }));
  ok("TEST_E: revoked lease → operation ถัดไป DENY ทันที", r.ok === false && r.mode === "DENY");
}
// TEST_F: LOGIN → attempt → auto-revoke → raw secret never returned
{
  const CRED = { credential_ref: "credential://tiktok/x/social-account", provider: "tiktok", account: "x", scope: [], status: "ACTIVE" as const, created_at: "", updated_at: "", resolver_kind: "macos_keychain" as const, resolver_service: "s", resolver_account: "a" };
  const loginDeps = { validateAuthority: (() => ({ ok: true, lease: {} })) as never, findApiCredential: (() => CRED) as never };
  let revokedId = "";
  const res = performLoginAttempt(
    { authority_id: "login-auth", requester: "agent:claude", provider: "tiktok", credential_ref: CRED.credential_ref },
    (ref) => ({ success: true, reason: `used ${ref}` }),
    loginDeps,
    ((id: string) => { revokedId = id; return { ok: true, lease: {} }; }) as never,
  );
  ok("TEST_F: login attempt → auto-revoked", res.login_authorization_revoked === true && revokedId === "login-auth");
  ok("TEST_F: raw secret never returned (มีแค่ reference)", res.credential_reference === CRED.credential_ref && !/secret|token|password/i.test(JSON.stringify(res)));
}
// TEST_G: ON แต่ external commit / high-risk ไม่มี authorization → DENY
{
  const commit = resolveComputerUseAuthorization({ ...normal, operation: "click", is_external_commit: true }, deps(true));
  ok("TEST_G: ON + external commit ไม่มี task auth → SEPARATE_AUTH_REQUIRED", commit.ok === false && commit.mode === "SEPARATE_AUTH_REQUIRED");
  const login = resolveComputerUseAuthorization({ ...normal, operation: "login" }, deps(true));
  ok("TEST_G: ON + login (L4) ไม่มี task auth → SEPARATE_AUTH_REQUIRED", login.ok === false && login.mode === "SEPARATE_AUTH_REQUIRED");
}
// TEST_H: เปลี่ยน requester Claude→Codex ภายใต้ policy/op เดียวกัน → semantics ไม่เปลี่ยน
{
  const claude = resolveComputerUseAuthorization({ ...normal, requester: "agent:claude" }, deps(true));
  const codex = resolveComputerUseAuthorization({ ...normal, requester: "agent:codex" }, deps(true));
  const gemini = resolveComputerUseAuthorization({ ...normal, requester: "agent:gemini" }, deps(true));
  ok("TEST_H: requester-neutral — claude/codex/gemini ได้ mode เดียวกัน", claude.mode === codex.mode && codex.mode === gemini.mode && claude.mode === "PREAUTHORIZED");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
