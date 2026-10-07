/**
 * หน้าที่: พิสูจน์ runtime ว่า DNA OS Computer-Use Executor เป็น execution owner จริง
 *
 * ขั้นตอน (ใช้ operation ที่ไม่ถูก Claude classifier บล็อก = screenshot):
 *   1. Owner grant permission lease ให้ DNA OS executor (ไม่ใช่ Claude)
 *   2. เรียก executor (process นี้เป็น DNA OS runtime) ให้ทำ screenshot ผ่าน os-ui
 *   3. อ่าน evidence กลับมา — ต้องเห็น execution_owner = DNA OS + pid ของ process นี้
 *      และ requester = agent:claude แยกออกจาก execution_owner
 *
 * รัน: npx tsx control/computer-use-executor/tools/runtime-proof.ts
 */

import { grantAuthority } from "../../computer-use-authority/contract";
import { executeComputerUse, EXECUTOR_IDENTITY } from "../executor";

async function main(): Promise<void> {
  console.log(`executor identity = ${EXECUTOR_IDENTITY}`);
  console.log(`this process pid = ${process.pid} (DNA OS runtime, not Claude reasoning loop)`);

  // 1) Owner grant lease -> DNA OS executor (Claude เป็นได้แค่ requester)
  const g = grantAuthority({
    owner: "OWNER",
    requester: "agent:claude",
    executor: EXECUTOR_IDENTITY,
    capability: "connections/os-ui",
    operations: ["screenshot"],
    target: "screen",
    scope: ["display-read"],
    ttl_seconds: 120,
  });
  if (!g.ok) { console.log("GRANT FAILED:", g.reason_code, g.detail); process.exit(1); }
  console.log(`granted authority_id = ${g.lease.authority_id} (owner=${g.lease.owner} executor=${g.lease.executor} requester=${g.lease.requester})`);

  // 2) requester ส่ง request -> DNA OS executor เป็นคน execute
  const { outcome, evidence } = await executeComputerUse({
    work_order_id: `wo-proof-${g.lease.authority_id}`,
    authority_id: g.lease.authority_id,
    requester: "agent:claude",
    operation: "screenshot",
    target: "screen",
    scope_needed: ["display-read"],
    ui: { target: "", scope: "screen", risk_confirmed: true },
  });

  // 3) evidence readback
  console.log("--- EXECUTION EVIDENCE ---");
  console.log(JSON.stringify({
    execution_owner: evidence.execution_owner,
    executor_pid: evidence.executor_pid,
    requester: evidence.requester,
    authorized: evidence.authorized,
    executed: evidence.executed,
    result_status: evidence.result_status,
    owner_is_dna_os: evidence.execution_owner === EXECUTOR_IDENTITY,
    requester_is_not_owner: evidence.requester !== evidence.execution_owner,
    outcome_artifacts: outcome?.artifacts ?? [],
  }, null, 1));
}

void main();
