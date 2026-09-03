/**
 * Phase 5 — พิสูจน์ daemon ingress path ที่ runtime จริง โดย daemon เป็น process แยก
 *   authenticate owner → grant lease → เขียน Work Order เข้า inbox
 *   → spawn `daemon.ts --once` (process ของตัวเอง pid ต่างหาก)
 *   → daemon: schema→owner session→lease→executeComputerUse→evidence→result
 *   → อ่าน result กลับมา (screenshot, non-blocked; ห้าม browser_eval ใน phase นี้)
 * รัน: npx tsx control/computer-use-executor/tools/daemon-runtime-proof.ts
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { authenticateOwner, grantAuthorityAsOwner } from "../../owner-authentication/contract";
import { EXECUTOR_IDENTITY } from "../executor";

const BASE = join(process.cwd(), "control/computer-use-executor/data");

async function main(): Promise<void> {
  const auth = authenticateOwner({ method: "macos-console-session", expected_owner: "tam", ttl_seconds: 120 });
  if (!auth.ok) { console.log("OWNER_AUTH FAILED:", auth.reason_code); process.exit(1); }
  const g = grantAuthorityAsOwner(auth.session.session_id, { requester: "agent:claude", executor: EXECUTOR_IDENTITY, capability: "connections/os-ui", operations: ["screenshot"], target: "screen", scope: ["display-read"], ttl_seconds: 120 });
  if (!("lease" in g) || !g.ok) { console.log("GRANT FAILED"); process.exit(1); }

  const woId = `daemon-proof-${g.lease.authority_id}`;
  mkdirSync(join(BASE, "inbox"), { recursive: true });
  const wo = { work_order_id: woId, owner_session_id: auth.session.session_id, authority_id: g.lease.authority_id, requester: "agent:claude", operation: "screenshot", target: "screen", scope_needed: ["display-read"], ui: { target: "", scope: "screen", risk_confirmed: true } };
  writeFileSync(join(BASE, "inbox", `${woId}.json`), JSON.stringify(wo), "utf-8");
  console.log(`this proof pid = ${process.pid}; wrote Work Order to inbox: ${woId}`);

  // spawn daemon เป็น process แยก (pid ต่างหาก) ให้ drain inbox หนึ่งรอบ
  const { stdout } = await promisify(execFile)("npx", ["tsx", "control/computer-use-executor/daemon.ts", "--once"], { cwd: process.cwd(), timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const daemonPidLine = stdout.split("\n").find((l) => l.includes("daemon starting")) ?? "";
  console.log(`daemon output: ${daemonPidLine.trim()}`);

  const resultPath = join(BASE, "results", `${woId}.json`);
  if (!existsSync(resultPath)) { console.log("NO RESULT FILE"); process.exit(1); }
  const result = JSON.parse(readFileSync(resultPath, "utf-8"));
  console.log(`--- DAEMON RESULT ---\n${JSON.stringify(result, null, 1)}`);

  const daemonPid = Number((daemonPidLine.match(/pid=(\d+)/) ?? [])[1] ?? -1);
  const pass = result.executed === true && result.execution_owner === EXECUTOR_IDENTITY && daemonPid !== process.pid && daemonPid > 0;
  console.log(`\nDAEMON_RUNTIME_PROOF = ${pass ? "PASS" : "FAIL"} (daemon pid=${daemonPid} ≠ proof pid=${process.pid}; execution_owner=${result.execution_owner})`);
  process.exit(pass ? 0 : 1);
}
void main();
