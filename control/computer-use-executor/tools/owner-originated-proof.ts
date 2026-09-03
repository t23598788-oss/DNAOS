/**
 * หน้าที่: พิสูจน์ backend path ที่ runtime จริง (Phase 5-6):
 *   Authenticated Owner (console session จริง) → grant lease → screenshot PASS
 *   → revoke Owner session → grant ใหม่ DENY (ไม่มี cached authority)
 * ใช้ signal จริง (console user) + operation ที่ไม่ชน safety (screenshot)
 *
 * รัน: npx tsx control/computer-use-executor/tools/owner-originated-proof.ts
 */

import { authenticateOwner, revokeOwnerSession, grantAuthorityAsOwner } from "../../owner-authentication/contract";
import { executeComputerUse, EXECUTOR_IDENTITY } from "../executor";

async function main(): Promise<void> {
  // 1) พิสูจน์ Owner จาก console session จริง (expected = tam)
  const auth = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 120 });
  if (!auth.ok) { console.log("OWNER_AUTH FAILED:", auth.reason_code, auth.detail); process.exit(1); }
  console.log(`OWNER authenticated: session=${auth.session.session_id} via=${auth.session.authenticated_via} owner=${auth.session.owner_identity}`);

  // 2) grant lease ในนาม Owner ที่ auth แล้ว
  const g = grantAuthorityAsOwner(auth.session.session_id, {
    requester: "agent:claude", executor: EXECUTOR_IDENTITY, capability: "connections/os-ui",
    operations: ["screenshot"], target: "screen", scope: ["display-read"], ttl_seconds: 120,
  });
  if (!("lease" in g) || !g.ok) { console.log("GRANT FAILED:", (g as { reason_code?: string }).reason_code); process.exit(1); }
  const authorityId = g.lease.authority_id;
  console.log(`lease granted: ${authorityId} (owner=${g.lease.owner})`);

  const req = { authority_id: authorityId, requester: "agent:claude", operation: "screenshot" as const, target: "screen", scope_needed: ["display-read"], ui: { target: "", scope: "screen", risk_confirmed: true } };

  // 3) execute (screenshot) → PASS, execution_owner = DNA OS
  const run = await executeComputerUse({ work_order_id: `wo-owner-${authorityId}`, ...req });
  console.log(`EXECUTE: authorized=${run.evidence.authorized} executed=${run.evidence.executed} status=${run.evidence.result_status} execution_owner=${run.evidence.execution_owner}`);

  // 4) Owner revoke session → grant ใหม่ต้อง DENY (root authority)
  const rv = revokeOwnerSession(auth.session.session_id);
  console.log(`OWNER revoke session: ${rv.ok ? rv.session.state : "FAILED"}`);
  const g2 = grantAuthorityAsOwner(auth.session.session_id, {
    requester: "agent:claude", executor: EXECUTOR_IDENTITY, capability: "connections/os-ui",
    operations: ["screenshot"], target: "screen", scope: ["display-read"], ttl_seconds: 120,
  });
  console.log(`grant after session revoke: ok=${g2.ok} reason=${(g2 as { reason_code?: string }).reason_code ?? "-"}`);

  const pass = run.evidence.executed === true && run.evidence.execution_owner === EXECUTOR_IDENTITY && g2.ok === false;
  console.log(`\nOWNER_ORIGINATED_PROOF = ${pass ? "PASS" : "FAIL"}`);
  process.exit(pass ? 0 : 1);
}
void main();
