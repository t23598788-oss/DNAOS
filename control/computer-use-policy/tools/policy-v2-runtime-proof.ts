/**
 * RUNTIME PROOF V2 (live, real stores/executor):
 *   ON  → resolve normal WO → PREAUTHORIZED auto-grant → executeComputerUse(screenshot) PASS
 *       → completeJob(revoke) → execute เดิม DENY (revoked)
 *   OFF → resolve normal WO → OWNER_APPROVAL_REQUIRED (capability ยัง callable ไม่ disabled)
 * รัน: npx tsx control/computer-use-policy/tools/policy-v2-runtime-proof.ts
 */
import { authenticateOwner } from "../../owner-authentication/contract";
import { setPreauthorization, resolveComputerUseAuthorization, completeJob } from "../contract";
import { executeComputerUse } from "../../computer-use-executor/executor";

async function main(): Promise<void> {
  const auth = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 300 });
  if (!auth.ok) { console.log("OWNER_AUTH FAILED:", auth.reason_code); process.exit(1); }

  // --- MODE A: ON ---
  const on = setPreauthorization(auth.session.session_id, true);
  console.log(`preauthorized set ON: ${on.ok}`);
  const normal = { work_order_id: "wo-v2-proof", requester: "agent:claude", operation: "screenshot" as const, target: "screen", scope: ["display-read"], ttl_seconds: 120 };
  const rON = resolveComputerUseAuthorization(normal);
  console.log(`ON resolve: ok=${rON.ok} mode=${rON.mode}`);
  if (!rON.ok) { console.log("expected PREAUTHORIZED"); process.exit(1); }
  const authId = rON.authority_id;

  const run = await executeComputerUse({ work_order_id: normal.work_order_id, authority_id: authId, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ui: { target: "", scope: "screen", risk_confirmed: true } });
  console.log(`execute under preauth: executed=${run.evidence.executed} status=${run.evidence.result_status} execution_owner=${run.evidence.execution_owner}`);

  // JOB_COMPLETED → revoke → execute เดิม DENY
  completeJob(authId);
  const after = await executeComputerUse({ work_order_id: normal.work_order_id + "-after", authority_id: authId, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ui: { target: "", scope: "screen", risk_confirmed: true } });
  console.log(`after JOB_COMPLETED (revoked): authorized=${after.evidence.authorized} executed=${after.evidence.executed} reason=${after.evidence.authorization_reason}`);

  // --- MODE B: OFF ---
  const off = setPreauthorization(auth.session.session_id, false);
  console.log(`preauthorized set OFF: ${off.ok}`);
  const rOFF = resolveComputerUseAuthorization({ ...normal, work_order_id: "wo-v2-off" });
  console.log(`OFF resolve: ok=${rOFF.ok} mode=${rOFF.mode} (capability ยัง callable)`);

  const pass = rON.mode === "PREAUTHORIZED" && run.evidence.executed === true && run.evidence.execution_owner === "control/computer-use-executor"
    && after.evidence.executed === false && rOFF.ok === false && rOFF.mode === "OWNER_APPROVAL_REQUIRED";
  console.log(`\nPOLICY_V2_RUNTIME_PROOF = ${pass ? "PASS" : "FAIL"}`);
  // คืนสวิตช์กลับ OFF (fail-safe default) — ไม่ทิ้ง pre-auth ค้างไว้
  process.exit(pass ? 0 : 1);
}
void main();
