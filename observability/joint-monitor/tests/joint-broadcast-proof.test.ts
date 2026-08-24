/**
 * หน้าที่: live proof for `../contract.ts` — starts a real HTTP server on
 * a real (test-only) port, opens a real SSE connection, POSTs a real
 * joint and a real violation through `reportJoint`/`reportViolation`
 * (the exact functions Pillar 1's two hook points call), and asserts the
 * live SSE stream actually received both — not a mock, not an in-process
 * function call pretending to be the network hop.
 *
 * How to run: JOINT_MONITOR_URL=http://127.0.0.1:<port> is set BY this
 * test itself before importing ../client.ts (module-load-time env read,
 * matching ../client.ts's own `readEnvVar` call site) —
 * npx tsx observability/joint-monitor/tests/joint-broadcast-proof.test.ts
 * (requires Node >=18 for global fetch/AbortSignal — see ../../.nvmrc)
 */

declare const require: (id: string) => unknown;
declare const process: { env: Record<string, string | undefined>; exitCode?: number; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;

const TEST_PORT = 51770;
process.env.JOINT_MONITOR_URL = `http://127.0.0.1:${TEST_PORT}`;

import { JointStore } from "../joint-store";
import { startJointMonitorServer } from "../server";
import { reportJoint, reportViolation } from "../client";

interface SseClientRequest {
  on(event: "error", cb: (e: Error) => void): void;
  destroy(): void;
}
interface NodeHttpModule {
  get(url: string, callback: (res: { on(event: "data", cb: (chunk: { toString(): string }) => void): void }) => void): SseClientRequest;
}
const http = require("http") as NodeHttpModule;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  console.log("=== observability/joint-monitor/tests/joint-broadcast-proof.test.ts ===");

  const store = new JointStore();
  const server = startJointMonitorServer(store, TEST_PORT);
  await sleep(150); // real listen() is async under the hood; give it a moment before connecting

  const received: string[] = [];
  const sseRequest = await new Promise<SseClientRequest>((resolveConnected) => {
    const req = http.get(`http://127.0.0.1:${TEST_PORT}/events`, (res) => {
      res.on("data", (chunk) => {
        const text = chunk.toString();
        received.push(text);
        if (text.includes('"type":"snapshot"')) resolveConnected(req);
      });
    });
  });
  console.log("PASS: real SSE connection opened, initial snapshot frame received");

  // 1. reportJoint — the exact function control/command-router/router.ts and
  // control/agent-gateway/gateway.ts will call.
  await reportJoint({ from_capability: "command-router", to_capability: "github", task_id: "task-proof-1", status: "COMPLETED", summary: "proof joint", source: "observability/joint-monitor/tests/joint-broadcast-proof.test.ts" });
  await sleep(200);
  assert(received.some((frame) => frame.includes('"kind":"joint"') && frame.includes("task-proof-1")), "a real reportJoint() call produced a live SSE frame containing the real task_id");
  console.log("PASS: reportJoint() -> POST /joints -> live SSE frame received by a real connected client");

  // 2. reportViolation — the exact function control/circuit-breaker/ will call.
  await reportViolation({ launch_id: "agent-launch-proof-1", reason: "IMPORT_BOUNDARY_VIOLATION", detail: "imported an internal file directly", source: "observability/joint-monitor/tests/joint-broadcast-proof.test.ts", enforced: false });
  await sleep(200);
  assert(received.some((frame) => frame.includes('"kind":"violation"') && frame.includes("agent-launch-proof-1")), "a real reportViolation() call produced a live SSE frame containing the real launch_id");
  console.log("PASS: reportViolation() -> POST /violations -> live SSE frame received");

  // 3. Rejects a malformed report rather than silently accepting it.
  const badResponse = await fetch(`http://127.0.0.1:${TEST_PORT}/joints`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_capability: "x" }) });
  assert(badResponse.status === 400, `a joint report missing required fields is rejected 400, got ${badResponse.status}`);
  console.log("PASS: malformed /joints report rejected 400, not silently accepted");

  // 4. Snapshot endpoint reflects what was actually recorded.
  const joints = (await (await fetch(`http://127.0.0.1:${TEST_PORT}/joints`)).json()) as { joints: readonly { task_id: string | null }[] };
  assert(joints.joints.some((j) => j.task_id === "task-proof-1"), "GET /joints reflects the real recorded event");
  console.log("PASS: GET /joints reflects real recorded state");

  // Explicitly destroy the still-open SSE client connection before closing the
  // server — server.close() only stops accepting NEW connections, it does not
  // terminate an active keep-alive/SSE stream, so without this the process
  // never exits (the open socket keeps the event loop alive indefinitely).
  sseRequest.destroy();
  server.close();
  console.log("=== ALL joint-broadcast-proof.test.ts CASES PASSED ===");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
