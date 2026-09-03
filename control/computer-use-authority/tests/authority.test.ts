/**
 * หน้าที่: พิสูจน์ permission lease + executor แบบ deterministic (inject now/id/store)
 * ครอบ: ALLOW / DENY / expired / wrong operation / wrong target / wrong requester /
 * executor ไม่ใช่ DNA OS / malformed / revoke / executor fail-closed / execution_owner
 *
 * รัน: npx tsx control/computer-use-authority/tests/authority.test.ts
 */

import { grantAuthority, validateAuthority, revokeAuthority, isDnaOsExecutor } from "../lease";
import type { LeaseDeps } from "../lease";
import type { ComputerUseAuthorityLease } from "../types";
import { executeComputerUse } from "../../computer-use-executor/executor";
import type { ExecutorDeps } from "../../computer-use-executor/executor";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const FIXED = new Date("2026-09-01T00:00:00.000Z");
function memDeps(seed: ComputerUseAuthorityLease[] = [], nowDate = FIXED): LeaseDeps & { rows: ComputerUseAuthorityLease[] } {
  const rows = [...seed];
  let counter = 0;
  return {
    rows,
    findLease: (id) => [...rows].reverse().find((r) => r.authority_id === id) ?? null,
    upsertLease: (l) => { rows.push(l); return l; },
    now: () => nowDate,
    newId: () => `authority-fixed-${++counter}`,
  };
}

const GRANT = {
  owner: "OWNER", requester: "agent:claude", executor: "control/computer-use-executor",
  capability: "connections/os-ui", operations: ["screenshot", "click"] as const,
  target: "developers.tiktok.com", scope: ["read"], ttl_seconds: 600,
};

// ── executor identity rule ──
ok("executor DNA OS ผ่าน", isDnaOsExecutor("control/computer-use-executor"));
ok("executor = claude ถูกปฏิเสธ", !isDnaOsExecutor("agent:claude"));
ok("executor = codex ถูกปฏิเสธ", !isDnaOsExecutor("codex"));
ok("executor ว่างถูกปฏิเสธ", !isDnaOsExecutor(""));

// ── grant ──
{
  const d = memDeps();
  const r = grantAuthority(GRANT, d);
  ok("grant สำเร็จ (executor เป็น DNA OS)", r.ok === true);
  ok("grant ให้ Claude เป็น executor ไม่ได้", grantAuthority({ ...GRANT, executor: "agent:claude" }, d).ok === false);
  ok("grant target=* ไม่ได้", grantAuthority({ ...GRANT, target: "*" }, d).ok === false);
  ok("grant ttl เกิน 1 วันไม่ได้", grantAuthority({ ...GRANT, ttl_seconds: 999999 }, d).ok === false);
}

// ── validate: ALLOW ──
{
  const d = memDeps();
  const g = grantAuthority(GRANT, d);
  const id = g.ok ? g.lease.authority_id : "";
  const v = validateAuthority({ authority_id: id, requester: "agent:claude", executor: "control/computer-use-executor", operation: "screenshot", target: "developers.tiktok.com", scope_needed: ["read"] }, d);
  ok("ALLOW: ครบเงื่อนไข → อนุญาต", v.ok === true);
}

// ── validate: DENY cases (fail closed) ──
{
  const d = memDeps();
  const g = grantAuthority(GRANT, d);
  const id = g.ok ? g.lease.authority_id : "";
  const base = { authority_id: id, requester: "agent:claude", executor: "control/computer-use-executor", operation: "screenshot" as const, target: "developers.tiktok.com" };
  ok("DENY: authority ไม่มีอยู่", validateAuthority({ ...base, authority_id: "nope" }, d).ok === false);
  ok("DENY: operation นอกใบ (type)", validateAuthority({ ...base, operation: "type" }, d).ok === false);
  ok("DENY: target ไม่ตรง", validateAuthority({ ...base, target: "evil.com" }, d).ok === false);
  ok("DENY: requester ไม่ตรง", validateAuthority({ ...base, requester: "someone-else" }, d).ok === false);
  ok("DENY: executor ไม่ใช่ DNA OS", validateAuthority({ ...base, executor: "agent:claude" }, d).ok === false);
  ok("DENY: scope ไม่พอ", validateAuthority({ ...base, scope_needed: ["write"] } as never, d).ok === false);
}

// ── validate: expired ──
{
  const d = memDeps();
  const g = grantAuthority(GRANT, d); // ttl 600s, issued at FIXED
  const id = g.ok ? g.lease.authority_id : "";
  const later = { ...d, now: () => new Date(FIXED.getTime() + 601_000) };
  const v = validateAuthority({ authority_id: id, requester: "agent:claude", executor: "control/computer-use-executor", operation: "screenshot", target: "developers.tiktok.com" }, later as never);
  ok("DENY: หมดอายุ", v.ok === false && v.reason_code === "AUTHORITY_EXPIRED");
}

// ── revoke ──
{
  const d = memDeps();
  const g = grantAuthority(GRANT, d);
  const id = g.ok ? g.lease.authority_id : "";
  const rv = revokeAuthority(id, d);
  ok("revoke สำเร็จ", rv.ok === true && rv.lease.state === "REVOKED");
  const v = validateAuthority({ authority_id: id, requester: "agent:claude", executor: "control/computer-use-executor", operation: "screenshot", target: "developers.tiktok.com" }, d);
  ok("DENY: หลัง revoke ใช้ไม่ได้", v.ok === false && v.reason_code === "AUTHORITY_REVOKED");
}

// ── AUTHORIZATION LEVELS (Phase 4) ──
{
  const d = memDeps();
  // L4 login: grant โดยไม่ตั้ง high_risk_explicit → DENY
  const noHR = grantAuthority({ ...GRANT, operations: ["login"], high_risk_explicit: false }, d);
  ok("LEVEL4 login: grant ไม่มี high_risk_explicit → ปฏิเสธ", noHR.ok === false && noHR.reason_code === "HIGH_RISK_REQUIRES_EXPLICIT_AUTHORITY");
  // L4 login: grant พร้อม high_risk_explicit → OK
  const withHR = grantAuthority({ ...GRANT, operations: ["login"], high_risk_explicit: true, target: "tiktok" }, d);
  ok("LEVEL4 login: grant พร้อม high_risk_explicit → อนุญาต", withHR.ok === true);
  // validate login บน lease L1 ปกติ (ไม่มี high_risk) → DENY ถึงจะ list ไว้
  const g1 = grantAuthority({ ...GRANT, operations: ["click"], target: "tiktok" }, d);
  const id1 = g1.ok ? g1.lease.authority_id : "";
  const vLogin = validateAuthority({ authority_id: id1, requester: "agent:claude", executor: "control/computer-use-executor", operation: "login", target: "tiktok" }, d);
  ok("LEVEL4: login ไม่อยู่ใน lease click → ปฏิเสธ", vLogin.ok === false);
  // external commit: lease UI ธรรมดา (click/type) แต่ผู้เรียกประกาศ is_external_commit → DENY
  const g2 = grantAuthority({ ...GRANT, operations: ["click", "type"], target: "tiktok" }, d);
  const id2 = g2.ok ? g2.lease.authority_id : "";
  const vCommit = validateAuthority({ authority_id: id2, requester: "agent:claude", executor: "control/computer-use-executor", operation: "click", target: "tiktok", is_external_commit: true }, d);
  ok("LEVEL3 external commit: lease UI ไม่มี external_commit_authorized → ปฏิเสธ", vCommit.ok === false && vCommit.reason_code === "EXTERNAL_COMMIT_NOT_AUTHORIZED");
  // external commit พร้อมอำนาจแยก → OK
  const g3 = grantAuthority({ ...GRANT, operations: ["click"], target: "tiktok", external_commit_authorized: true }, d);
  const id3 = g3.ok ? g3.lease.authority_id : "";
  const vCommitOk = validateAuthority({ authority_id: id3, requester: "agent:claude", executor: "control/computer-use-executor", operation: "click", target: "tiktok", is_external_commit: true }, d);
  ok("LEVEL3 external commit: มี external_commit_authorized → อนุญาต", vCommitOk.ok === true);
}

async function main() {
// ── executor: fail closed เมื่อไม่มี authority + execution_owner = DNA OS ──
{
  let ran = false;
  const exDeps: ExecutorDeps = {
    validateAuthority: () => ({ ok: false, reason_code: "AUTHORITY_NOT_FOUND", detail: "x" }),
    runUiWorkOrder: (async () => { ran = true; return { ok: true, status: "COMPLETED", summary: "", evidence: [], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null }; }) as never,
    now: () => FIXED, newEvidenceId: () => "cue-fixed-1", evidenceDir: "/tmp/cue-test-data",
  };
  const { outcome, evidence } = await executeComputerUse({ work_order_id: "wo1", authority_id: "none", requester: "agent:claude", operation: "screenshot", target: "developers.tiktok.com", ui: {} }, exDeps);
  ok("executor: ไม่มี authority → ไม่ execute (fail closed)", outcome === null && ran === false && evidence.executed === false);
  ok("executor: execution_owner = DNA OS (ไม่ใช่ Claude)", evidence.execution_owner === "control/computer-use-executor");
  ok("executor: requester ถูกบันทึกแยกจาก execution_owner", evidence.requester === "agent:claude" && evidence.execution_owner !== evidence.requester);
}

// ── executor: authorized → execute ผ่าน os-ui + evidence executed ──
{
  let calledWith: unknown = null;
  const exDeps: ExecutorDeps = {
    validateAuthority: () => ({ ok: true, lease: {} as never }),
    runUiWorkOrder: (async (o: unknown) => { calledWith = o; return { ok: true, status: "COMPLETED", summary: "shot", evidence: [], artifacts: [{ kind: "screenshot_file", ref: "/x.png" }], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null }; }) as never,
    now: () => FIXED, newEvidenceId: () => "cue-fixed-2", evidenceDir: "/tmp/cue-test-data",
  };
  const { outcome, evidence } = await executeComputerUse({ work_order_id: "wo2", authority_id: "ok", requester: "agent:claude", operation: "screenshot", target: "screen", ui: { target: "", scope: "screen" } }, exDeps);
  ok("executor: authorized → execute ผ่าน os-ui", outcome?.status === "COMPLETED" && calledWith !== null && evidence.executed === true);
  ok("executor: os-ui ได้ ui_action=screenshot จาก operation", (calledWith as { ui_action?: string })?.ui_action === "screenshot");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
}
void main();
