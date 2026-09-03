/**
 * Phase 1 — Owner authentication: UNAUTHENTICATED→DENY, FAKE OWNER STRING→DENY,
 * AUTHENTICATED→ALLOW, EXPIRED→DENY, REVOKED→DENY + grant ต้องมี session จริง
 * รัน: npx tsx control/owner-authentication/tests/owner-auth.test.ts
 */
import { authenticateOwner, validateOwnerSession, revokeOwnerSession } from "../authenticate";
import type { OwnerAuthDeps } from "../authenticate";
import { grantAuthorityAsOwner } from "../owner-grant";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const FIXED = new Date("2026-09-01T00:00:00.000Z");
let tmpN = 0;
function deps(consoleUser: string | null, nowDate = FIXED): OwnerAuthDeps {
  return { readConsoleUser: () => consoleUser, now: () => nowDate, newId: () => `owner-session-fixed-${++tmpN}`, baseDir: `/tmp/owner-auth-test-${tmpN}-${Math.random().toString(36).slice(2)}` };
}

// FAKE OWNER STRING → DENY (console user ไม่ตรง = แค่ประกาศชื่อไม่พอ)
{
  const d = deps("someone-else");
  const r = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, d);
  ok("FAKE OWNER: console user ไม่ตรง → DENY", r.ok === false && r.reason_code === "OWNER_SIGNAL_MISMATCH");
}
// NO CONSOLE SESSION → DENY
ok("UNAUTHENTICATED: ไม่มี console session → DENY", authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, deps(null)).ok === false);
// touch-id ยังไม่มี helper → DENY (ไม่แกล้ง)
ok("touch-id ไม่มี helper → DENY (ไม่แกล้งผล biometric)", authenticateOwner({ method: "touch-id", expected_owner: "tam", ttl_seconds: 300 }, deps("tam")).ok === false);

// AUTHENTICATED → ALLOW
let sid = "";
{
  const d = deps("tam");
  const r = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, d);
  ok("AUTHENTICATED: console user ตรง → ออก session", r.ok === true && r.session.owner_identity === "tam");
  if (r.ok) {
    sid = r.session.session_id;
    ok("session validate ผ่าน", validateOwnerSession(sid, d).ok === true);
    // grant ต้องมี session — ใช้ session จริง → ผ่าน
    const g = grantAuthorityAsOwner(sid, { requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: ["display-read"], ttl_seconds: 120 }, d);
    ok("grant ด้วย Owner session จริง → ผ่าน และ owner ผูกกับ session", g.ok === true && "lease" in g && g.lease.owner.startsWith("owner-session:"));
  }
}

// grant โดยไม่มี session (string ล้วน) → DENY
ok("grant โดยไม่มี Owner session → DENY", grantAuthorityAsOwner("no-such-session", { requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: [], ttl_seconds: 120 }, deps("tam")).ok === false);

// EXPIRED → DENY
{
  const d = deps("tam");
  const r = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 100 }, d);
  if (r.ok) {
    const later = { ...d, now: () => new Date(FIXED.getTime() + 101_000) };
    ok("EXPIRED session → validate DENY", validateOwnerSession(r.session.session_id, later).ok === false);
    ok("EXPIRED session → grant DENY", grantAuthorityAsOwner(r.session.session_id, { requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: [], ttl_seconds: 60 }, later).ok === false);
  }
}

// REVOKED → DENY
{
  const d = deps("tam");
  const r = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, d);
  if (r.ok) {
    revokeOwnerSession(r.session.session_id, d);
    ok("REVOKED session → validate DENY", validateOwnerSession(r.session.session_id, d).ok === false);
    ok("REVOKED session → grant DENY", grantAuthorityAsOwner(r.session.session_id, { requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: [], ttl_seconds: 60 }, d).ok === false);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
