/**
 * Phase 4 — daemon ingress fail-closed: malformed / missing WO / missing owner session /
 * invalid lease / out-of-scope / wrong executor → DENY (ไม่ execute)
 * รัน: npx tsx control/computer-use-executor/tests/daemon.test.ts
 */
import { processWorkOrder } from "../daemon";
import { grantAuthority } from "../../computer-use-authority/contract";

let passed = 0, failed = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { passed++; console.log(`PASS  ${n}`); } else { failed++; console.log(`FAIL  ${n}${d ? ` :: ${d}` : ""}`); } };

const okSession = { validateOwnerSession: (() => ({ ok: true, session: { session_id: "s", owner_identity: "tam" } })) as never };
const badSession = { validateOwnerSession: (() => ({ ok: false, reason_code: "OWNER_SESSION_NOT_FOUND", detail: "x" })) as never };

async function main() {
  // malformed → DENY (owner session ไม่ถูกแตะ)
  ok("malformed (missing operation) → DENY", (await processWorkOrder({ work_order_id: "w", owner_session_id: "s", authority_id: "a", requester: "agent:claude", target: "screen" }, okSession)).accepted === false);
  ok("unknown operation → DENY", (await processWorkOrder({ work_order_id: "w", owner_session_id: "s", authority_id: "a", requester: "agent:claude", operation: "nuke_everything", target: "screen" }, okSession)).accepted === false);
  ok("empty object → DENY", (await processWorkOrder({}, okSession)).accepted === false);

  // missing/invalid owner session → DENY (ก่อนถึง executor)
  {
    const r = await processWorkOrder({ work_order_id: "w", owner_session_id: "nope", authority_id: "a", requester: "agent:claude", operation: "screenshot", target: "screen" }, badSession);
    ok("invalid owner session → DENY, ไม่ execute", r.accepted === false && r.executed === false && r.reason.startsWith("OWNER_SESSION"));
  }

  // valid owner session + ไม่มี lease จริง → executeComputerUse DENY (AUTHORITY_NOT_FOUND)
  {
    const r = await processWorkOrder({ work_order_id: "w", owner_session_id: "s", authority_id: "no-such-lease", requester: "agent:claude", operation: "screenshot", target: "screen", ui: {} }, okSession);
    ok("valid session + ไม่มี lease → DENY, ไม่ execute", r.accepted === false && r.executed === false);
    ok("execution_owner ยังเป็น DNA OS แม้ถูก DENY", r.execution_owner === "control/computer-use-executor");
  }

  // out-of-scope: lease จริงมีแค่ screenshot แต่ Work Order ขอ type → DENY
  {
    const g = grantAuthority({ owner: "OWNER", requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: [], ttl_seconds: 120 });
    const authId = g.ok ? g.lease.authority_id : "";
    const r = await processWorkOrder({ work_order_id: "w", owner_session_id: "s", authority_id: authId, requester: "agent:claude", operation: "type", target: "screen", ui: { text: "x" } }, okSession);
    ok("out-of-scope operation (type ไม่อยู่ใน lease screenshot) → DENY", r.accepted === false && r.executed === false);
  }

  // wrong requester: lease requester=agent:claude แต่ WO requester=other → DENY
  {
    const g = grantAuthority({ owner: "OWNER", requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: [], ttl_seconds: 120 });
    const authId = g.ok ? g.lease.authority_id : "";
    const r = await processWorkOrder({ work_order_id: "w", owner_session_id: "s", authority_id: authId, requester: "someone-else", operation: "screenshot", target: "screen", ui: {} }, okSession);
    ok("requester ไม่ตรง lease → DENY", r.accepted === false && r.executed === false);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
