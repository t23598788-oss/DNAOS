/**
 * หน้าที่: พิสูจน์ที่ runtime ว่า Owner ถือ root authority จริง — revoke แล้วต้อง DENY ทันที
 * ไม่มี cached authorization (Phase 7) ใช้ operation ที่ไม่ถูกบล็อก = screenshot
 *
 * grant → execute(screenshot)=PASS → revoke → execute(screenshot)=DENY
 * รัน: npx tsx control/computer-use-executor/tools/revocation-proof.ts
 */

import { grantAuthority, revokeAuthority } from "../../computer-use-authority/contract";
import { executeComputerUse, EXECUTOR_IDENTITY } from "../executor";

async function main(): Promise<void> {
  const g = grantAuthority({
    owner: "OWNER", requester: "agent:claude", executor: EXECUTOR_IDENTITY,
    capability: "connections/os-ui", operations: ["screenshot"], target: "screen",
    scope: ["display-read"], ttl_seconds: 120,
  });
  if (!g.ok) { console.log("GRANT FAILED"); process.exit(1); }
  const id = g.lease.authority_id;
  const req = { authority_id: id, requester: "agent:claude", operation: "screenshot" as const, target: "screen", scope_needed: ["display-read"], ui: { target: "", scope: "screen", risk_confirmed: true } };

  const before = await executeComputerUse({ work_order_id: `wo-before-${id}`, ...req });
  console.log(`BEFORE revoke: authorized=${before.evidence.authorized} executed=${before.evidence.executed} status=${before.evidence.result_status}`);

  const rv = revokeAuthority(id);
  console.log(`OWNER revoke: ${rv.ok ? rv.lease.state : "FAILED"} at ${rv.ok ? rv.lease.revoked_at : "-"}`);

  const after = await executeComputerUse({ work_order_id: `wo-after-${id}`, ...req });
  console.log(`AFTER revoke:  authorized=${after.evidence.authorized} executed=${after.evidence.executed} reason=${after.evidence.authorization_reason}`);

  const pass = before.evidence.executed === true && after.evidence.executed === false && after.evidence.authorized === false;
  console.log(`\nREVOCATION_PROOF = ${pass ? "PASS" : "FAIL"} (execution_owner=${after.evidence.execution_owner}, no cached authorization after revoke)`);
  process.exit(pass ? 0 : 1);
}
void main();
