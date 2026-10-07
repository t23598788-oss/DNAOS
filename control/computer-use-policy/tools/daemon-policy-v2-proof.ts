/**
 * RUNTIME PROOF: Policy V2 + revocation ผ่าน canonical daemon ingress (ไม่ใช่ direct library)
 * ทุก drain = spawn `daemon.ts --once` เป็น process แยก (pid ต่างหาก)
 *
 * 4A ON  : WorkOrder (ไม่มี authority) → daemon → resolve PREAUTHORIZED → execute screenshot → evidence
 * 4B OFF : WorkOrder เดียวกัน → daemon → OWNER_APPROVAL_REQUIRED → ไม่ execute
 * 5  REVOKE: task lease → execute → revoke → retry → DENY
 * รัน: npx tsx control/computer-use-policy/tools/daemon-policy-v2-proof.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { authenticateOwner } from "../../owner-authentication/contract";
import { setPreauthorization } from "../contract";
import { grantAuthority, revokeAuthority } from "../../computer-use-authority/contract";

const BASE = join(process.cwd(), "control/computer-use-executor/data");
const pexec = promisify(execFile);

async function drainDaemon(): Promise<number> {
  const { stdout } = await pexec("npx", ["tsx", "control/computer-use-executor/daemon.ts", "--once"], { cwd: process.cwd(), timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const line = stdout.split("\n").find((l) => l.includes("daemon starting")) ?? "";
  return Number((line.match(/pid=(\d+)/) ?? [])[1] ?? -1);
}
function writeWO(id: string, wo: object): void { mkdirSync(join(BASE, "inbox"), { recursive: true }); writeFileSync(join(BASE, "inbox", `${id}.json`), JSON.stringify({ work_order_id: id, ...wo }), "utf-8"); }
function readResult(id: string): Record<string, unknown> | null { const p = join(BASE, "results", `${id}.json`); return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null; }

async function main(): Promise<void> {
  const auth = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 600 });
  if (!auth.ok) { console.log("OWNER_AUTH FAILED"); process.exit(1); }
  const sid = auth.session.session_id;
  const uiSafe = { target: "", scope: "screen", risk_confirmed: true };

  // 4A: ON
  setPreauthorization(sid, true);
  const A = `v2-daemon-ON-${Date.now() % 100000}`;
  writeWO(A, { owner_session_id: sid, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ttl_seconds: 120, ui: uiSafe });
  const pidA = await drainDaemon();
  const rA = readResult(A);
  console.log(`4A ON : daemon pid=${pidA} | accepted=${rA?.accepted} executed=${rA?.executed} owner=${rA?.execution_owner} evidence=${rA?.evidence_id}`);

  // 4B: OFF
  setPreauthorization(sid, false);
  const B = `v2-daemon-OFF-${Date.now() % 100000}`;
  writeWO(B, { owner_session_id: sid, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ttl_seconds: 120, ui: uiSafe });
  const pidB = await drainDaemon();
  const rB = readResult(B);
  console.log(`4B OFF: daemon pid=${pidB} | accepted=${rB?.accepted} executed=${rB?.executed} reason=${rB?.reason}`);

  // 5: revocation through daemon (task lease)
  const g = grantAuthority({ owner: `owner-session:${sid}:tam`, requester: "agent:claude", executor: "control/computer-use-executor", capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: ["display-read"], ttl_seconds: 300 });
  const authId = g.ok ? g.lease.authority_id : "";
  const C = `v2-daemon-REVOKE1-${Date.now() % 100000}`;
  writeWO(C, { owner_session_id: sid, authority_id: authId, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ui: uiSafe });
  const pidC = await drainDaemon();
  const rC = readResult(C);
  console.log(`5a task : daemon pid=${pidC} | executed=${rC?.executed} authority=${authId} evidence=${rC?.evidence_id}`);
  revokeAuthority(authId);
  const D = `v2-daemon-REVOKE2-${Date.now() % 100000}`;
  writeWO(D, { owner_session_id: sid, authority_id: authId, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ui: uiSafe });
  const pidD = await drainDaemon();
  const rD = readResult(D);
  console.log(`5b revoked: daemon pid=${pidD} | accepted=${rD?.accepted} executed=${rD?.executed} reason=${rD?.reason}`);

  setPreauthorization(sid, false); // restore original (OFF)

  const pass = rA?.executed === true && rA?.execution_owner === "control/computer-use-executor"
    && rB?.executed === false && String(rB?.reason).includes("OWNER_APPROVAL_REQUIRED")
    && rC?.executed === true && rD?.executed === false
    && pidA !== process.pid && pidA > 0 && pidA !== pidB;
  console.log(`\nDAEMON_POLICY_V2_PROOF = ${pass ? "PASS" : "FAIL"} (proof pid=${process.pid}; daemon pids ${pidA}/${pidB}/${pidC}/${pidD} แยกจากกันและจาก proof)`);
  process.exit(pass ? 0 : 1);
}
void main();
