/**
 * Owner authentication: presence alone cannot mint; human verification is required.
 * Unverified/unauthenticated paths fail closed with no session and no grant.
 * รัน: npx tsx control/owner-authentication/tests/owner-auth.test.ts
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { authenticateOwner, validateOwnerSession, revokeOwnerSession } from "../authenticate";
import type { OwnerAuthDeps } from "../authenticate";
import { grantAuthorityAsOwner } from "../owner-grant";
import type { OwnerSession } from "../types";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const FIXED = new Date("2026-09-01T00:00:00.000Z");
let tmpN = 0;
function deps(consoleUser: string | null, nowDate = FIXED): OwnerAuthDeps {
  return { readConsoleUser: () => consoleUser, now: () => nowDate, newId: () => `owner-session-fixed-${++tmpN}`, baseDir: `/tmp/owner-auth-test-${tmpN}-${Math.random().toString(36).slice(2)}` };
}

function seedHumanVerifiedSession(d: OwnerAuthDeps, overrides: Partial<OwnerSession> = {}): OwnerSession {
  mkdirSync(d.baseDir, { recursive: true });
  const issued = d.now();
  const session: OwnerSession = {
    session_id: d.newId(),
    owner_identity: "tam",
    authenticated_via: "human-verification:TEST",
    device_binding: null,
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + 300_000).toISOString(),
    state: "ACTIVE",
    revoked_at: null,
    evidence_reference: "verification-challenges.jsonl#test",
    ...overrides,
  };
  appendFileSync(join(d.baseDir, "owner-sessions.jsonl"), `${JSON.stringify(session)}\n`, { encoding: "utf8", mode: 0o600 });
  return session;
}

const grantInput = {
  requester: "agent:claude",
  executor: "control/computer-use-executor",
  capability: "connections/os-ui",
  operations: ["screenshot"] as const,
  target: "screen",
  scope: ["display-read"] as const,
  ttl_seconds: 120,
};

// FAKE OWNER STRING → DENY (console user ไม่ตรง = แค่ประกาศชื่อไม่พอ)
{
  const d = deps("someone-else");
  const r = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, d);
  ok("FAKE OWNER: console user ไม่ตรง → DENY", r.ok === false && r.reason_code === "OWNER_SIGNAL_MISMATCH");
}
// NO CONSOLE SESSION → DENY
ok("UNAUTHENTICATED: ไม่มี console session → DENY", authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, deps(null)).ok === false);
// touch-id ยังไม่มี helper และไม่ใช่ human-verification → ไม่มินต์ session
{
  const r = authenticateOwner({ method: "touch-id", expected_owner: "tam", ttl_seconds: 300 }, deps("tam"));
  ok("touch-id unverified → HUMAN_VERIFICATION_REQUIRED (ไม่แกล้งผล biometric)",
    r.ok === false && r.reason_code === "HUMAN_VERIFICATION_REQUIRED");
}

// macos-console-session presence alone must NOT mint — canonical HUMAN_VERIFICATION_REQUIRED
{
  const d = deps("tam");
  const r = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 }, d);
  ok("presence-only macos-console-session → HUMAN_VERIFICATION_REQUIRED (no session mint)",
    r.ok === false && r.reason_code === "HUMAN_VERIFICATION_REQUIRED" && !("session" in r && r.session));
  ok("presence-only path does not leave a grantable session",
    grantAuthorityAsOwner("no-session-from-presence", grantInput, d).ok === false);
}

// human-verification without verified_challenge_id → no mint
{
  const r = authenticateOwner({ method: "human-verification", expected_owner: "tam", ttl_seconds: 300 }, deps("tam"));
  ok("human-verification without challenge → HUMAN_VERIFICATION_REQUIRED",
    r.ok === false && r.reason_code === "HUMAN_VERIFICATION_REQUIRED");
}

// grant โดยไม่มี session (string ล้วน) → DENY
ok("grant โดยไม่มี Owner session → DENY",
  grantAuthorityAsOwner("no-such-session", { ...grantInput, scope: [] as const }, deps("tam")).ok === false);

// Seeded human-verified session → validate + grant
{
  const d = deps("tam");
  const session = seedHumanVerifiedSession(d);
  ok("human-verified session validate ผ่าน", validateOwnerSession(session.session_id, d).ok === true);
  const g = grantAuthorityAsOwner(session.session_id, grantInput, d);
  ok("grant ด้วย human-verified Owner session จริง → ผ่าน และ owner ผูกกับ session",
    g.ok === true && "lease" in g && g.lease.owner.startsWith("owner-session:"));
}

// EXPIRED → DENY
{
  const d = deps("tam");
  const session = seedHumanVerifiedSession(d, {
    expires_at: new Date(FIXED.getTime() + 100_000).toISOString(),
  });
  const later = { ...d, now: () => new Date(FIXED.getTime() + 101_000) };
  ok("EXPIRED session → validate DENY", validateOwnerSession(session.session_id, later).ok === false);
  ok("EXPIRED session → grant DENY",
    grantAuthorityAsOwner(session.session_id, { ...grantInput, scope: [] as const, ttl_seconds: 60 }, later).ok === false);
}

// REVOKED → DENY
{
  const d = deps("tam");
  const session = seedHumanVerifiedSession(d);
  revokeOwnerSession(session.session_id, d);
  ok("REVOKED session → validate DENY", validateOwnerSession(session.session_id, d).ok === false);
  ok("REVOKED session → grant DENY",
    grantAuthorityAsOwner(session.session_id, { ...grantInput, scope: [] as const, ttl_seconds: 60 }, d).ok === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
