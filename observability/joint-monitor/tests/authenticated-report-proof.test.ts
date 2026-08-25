/**
 * หน้าที่: live proof that `../client.ts`'s `reportJoint`/`reportViolation`
 * can actually write into a joint-monitor that has
 * `JOINT_MONITOR_SHARED_SECRET` configured — the exact production shape
 * (the Railway `joint-monitor` service has that secret set). Before
 * 2026-08-26 they could not: `../host-runtime.ts`'s `hostPostJson` sent no
 * `Authorization` header at all, so every real report from
 * `control/command-router/`, `control/agent-gateway/` and
 * `control/circuit-breaker/` was answered 401 and dropped silently
 * (`reportJoint` is fire-and-forget by design, so nothing surfaced the
 * failure). Proven live against
 * https://joint-monitor-production.up.railway.app before the fix: an
 * unauthenticated `POST /joints` returned a real 401.
 *
 * This asserts BOTH directions, because a reporter that always sends a
 * header would be just as wrong as one that never does: the wrong secret
 * must still be refused, and the right one must land.
 *
 * How to run (Node >=18 required for global fetch — see ../../../.nvmrc,
 * which pins 24; under Node 16 `fetch` is undefined and every POST in this
 * folder fails silently):
 * npx tsx observability/joint-monitor/tests/authenticated-report-proof.test.ts
 */

declare const process: { env: Record<string, string | undefined>; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;

const TEST_PORT = 51772;
const TEST_ONLY_SECRET = "joint-monitor-auth-proof-secret-2026-08-26";

// Both env vars are read at call time by ../client.ts and per-request by
// ../server.ts, but set them before importing anyway — same discipline as
// ./joint-broadcast-proof.test.ts, whose ../client.ts URL read this mirrors.
process.env.JOINT_MONITOR_URL = `http://127.0.0.1:${TEST_PORT}`;
process.env.JOINT_MONITOR_SHARED_SECRET = TEST_ONLY_SECRET;

import { JointStore } from "../joint-store";
import { startJointMonitorServer } from "../server";
import { reportJoint, reportViolation } from "../client";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  console.log("=== observability/joint-monitor/tests/authenticated-report-proof.test.ts ===");

  const store = new JointStore();
  const server = startJointMonitorServer(store, TEST_PORT);
  await sleep(150); // real listen() is async under the hood

  const jointBody = { from_capability: "command-router", to_capability: "github", task_id: "task-auth-proof-1", status: "COMPLETED", summary: "auth proof joint", source: "observability/joint-monitor/tests/authenticated-report-proof.test.ts" };

  // 1. The pre-fix behavior, asserted as still-refused: no header -> 401.
  const noHeader = await fetch(`http://127.0.0.1:${TEST_PORT}/joints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(jointBody) });
  assert(noHeader.status === 401, `a POST /joints with no Authorization header is refused 401, got ${noHeader.status}`);
  console.log("PASS: unauthenticated POST /joints refused 401 (the real pre-fix failure, still enforced)");

  // 2. A wrong secret is refused too — proves the gate compares, not just presence.
  const wrongSecret = await fetch(`http://127.0.0.1:${TEST_PORT}/joints`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-real-secret-at-all-000000000" }, body: JSON.stringify(jointBody) });
  assert(wrongSecret.status === 401, `a POST /joints with a wrong Bearer secret is refused 401, got ${wrongSecret.status}`);
  console.log("PASS: wrong Bearer secret refused 401");

  // 3. The fix itself: the real reporter, with the real secret in env, lands.
  await reportJoint(jointBody);
  await sleep(200);
  const joints = (await (await fetch(`http://127.0.0.1:${TEST_PORT}/joints`)).json()) as { joints: readonly { task_id: string | null }[] };
  assert(joints.joints.some((j) => j.task_id === "task-auth-proof-1"), "reportJoint() actually landed in the store of a secret-protected server");
  console.log("PASS: reportJoint() -> authenticated POST /joints -> real row recorded");

  // 4. Same for the violation path (control/circuit-breaker/'s reporter).
  await reportViolation({ launch_id: "agent-launch-auth-proof-1", reason: "IMPORT_BOUNDARY_VIOLATION", detail: "auth proof violation", source: "observability/joint-monitor/tests/authenticated-report-proof.test.ts", enforced: false });
  await sleep(200);
  const violations = (await (await fetch(`http://127.0.0.1:${TEST_PORT}/violations`)).json()) as { violations: readonly { launch_id: string }[] };
  assert(violations.violations.some((v) => v.launch_id === "agent-launch-auth-proof-1"), "reportViolation() actually landed in the store of a secret-protected server");
  console.log("PASS: reportViolation() -> authenticated POST /violations -> real row recorded");

  // 5. The unchanged local-Mac case: no secret configured anywhere -> the
  // reporter sends no header and the server still accepts, exactly as before.
  delete process.env.JOINT_MONITOR_SHARED_SECRET;
  await reportJoint({ ...jointBody, task_id: "task-auth-proof-2", summary: "no-secret local case" });
  await sleep(200);
  const afterUnset = (await (await fetch(`http://127.0.0.1:${TEST_PORT}/joints`)).json()) as { joints: readonly { task_id: string | null }[] };
  assert(afterUnset.joints.some((j) => j.task_id === "task-auth-proof-2"), "with no secret configured, reporting still works unauthenticated (unchanged local behavior)");
  console.log("PASS: no-secret local loopback case unchanged");

  server.close();
  console.log("=== ALL authenticated-report-proof.test.ts CASES PASSED ===");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
