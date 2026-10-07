/**
 * หน้าที่: the live end-to-end proof for Pillar 1's actual wiring — not
 * `../client.ts`'s functions called by hand (see
 * `./joint-broadcast-proof.test.ts` for that), but the REAL hook points:
 * `control/command-router/router.ts`'s `admitAndBuildResult` and
 * `control/agent-gateway/gateway.ts`'s `persistStatus`. Proves two
 * things a unit test of either hook in isolation cannot: (1) a real
 * `routeOwnerCommand()` call produces a live event on this dashboard
 * with zero special-casing by the caller, and (2) `dna-os-circuit/runtime/server.ts`'s
 * confirmed bypass of `control/command-router/router.ts` (it calls
 * `control/agent-gateway/contract.ts`'s `submitTask` directly) is now
 * ALSO reported — the before/after proof that hooking `persistStatus`
 * (not `submitTask`'s own return point) closes that specific gap.
 *
 * How to run: npx tsx observability/joint-monitor/tests/router-wiring-proof.test.ts
 * (Node >=18 required — sets JOINT_MONITOR_URL before the router/gateway
 * modules are ever called, so their module-load-time-independent
 * `readEnvVar()` calls inside ../client.ts pick it up on first use.)
 */

declare const process: { pid: number; env: Record<string, string | undefined>; exit(code: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const require: (id: string) => unknown;
declare const setTimeout: (fn: () => void, ms: number) => unknown;

const TEST_PORT = 51771;
process.env.JOINT_MONITOR_URL = `http://127.0.0.1:${TEST_PORT}`;
// This starts a REAL server, which appends to a REAL durable log. Point it at
// a throwaway directory: test rows in the production log used to be harmless
// noise, but the store now rehydrates from that file at boot, so they would be
// served to real dashboards as real joints.
process.env.JOINT_MONITOR_DATA_DIR = `${(require("os") as { tmpdir(): string }).tmpdir()}/joint-monitor-test-${process.pid}-${Date.now()}`;

import { JointStore } from "../joint-store";
import { startJointMonitorServer } from "../server";
import { routeOwnerCommand } from "../../../control/command-router/contract";
import type { RouteOptions } from "../../../control/command-router/contract";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import { submitTask, DEFAULT_AGENT_WORKERS } from "../../../control/agent-gateway/contract";

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

function baseEnvelope(intent: string, payload: unknown = {}): CommandEnvelope {
  return {
    command_id: `cmd_wiring_proof_${Math.random().toString(36).slice(2)}`,
    issued_by: { identity_id: "identity-wiring-proof", acting_as_account_id: "account-wiring-proof", acting_as_tenant_id: "tenant-wiring-proof", software_id: "software-wiring-proof", kind: "human" },
    intent,
    payload,
    issued_at: new Date().toISOString(),
  };
}

async function run(): Promise<void> {
  console.log("=== observability/joint-monitor/tests/router-wiring-proof.test.ts ===");

  const store = new JointStore();
  const server = startJointMonitorServer(store, TEST_PORT);
  await sleep(150);

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
  console.log("PASS: real SSE connection to a real joint-monitor server opened");

  // 1. A real routeOwnerCommand() call (the actual production entry point
  // control/owner-command/owner-command.ts uses) -> command-router/router.ts's
  // admitAndBuildResult -> a real live event, with zero special-casing here.
  {
    const connection = { connection_id: "conn-wiring-proof", account_id: "account-wiring-proof", software_id: "software-wiring-proof", adapter: "github", credential_ref: { kind: "not_yet_built" as const }, status: "connected" as const };
    const payload = { command_id: "cmd-wiring-proof", account_id: "account-wiring-proof", connection };
    const envelope = baseEnvelope("connector.github.check_access", payload);
    const options: RouteOptions = { steps: [{ capability_id: "github", intent: "connector.github.check_access", payload }] };
    const result = await routeOwnerCommand(envelope, "connector.github.check_access", options);
    assert(result.capability_id === "github", `sanity: router really reached github, got ${result.capability_id}`);

    await sleep(200);
    // A TCP chunk is not an SSE frame boundary — assert against the whole stream.
    const stream = received.join("");
    const sawIt = stream.includes('"kind":"joint"') && stream.includes('"from_capability":"command-router"') && stream.includes('"to_capability":"github"') && stream.includes(result.task_id);
    assert(sawIt, "a real routeOwnerCommand() call produced a live SSE frame with the real task_id, from_capability=command-router, to_capability=github");
    console.log("PASS: real routeOwnerCommand() -> router.ts#admitAndBuildResult -> live joint-monitor event, unmodified production code path");
  }

  // 2. The confirmed bypass: dna-os-circuit/runtime/server.ts's /gateway/dna_submit_task
  // calls agent-gateway's submitTask() DIRECTLY, never touching router.ts. Calling
  // submitTask the same way that HTTP handler does proves persistStatus's hook
  // still reports it — the exact "before/after" proof the bypass is closed.
  {
    const task = await submitTask(
      "ตรวจ ไฟล์ซ้ำ (wiring proof, simulating dna-os-circuit's direct /gateway/dna_submit_task call)",
      { user_id: "user-wiring-proof", workspace_id: "workspace-wiring-proof", conversation_id: "conv-wiring-proof", parent_task_id: null },
      "dna-os-circuit", // the real client_id dna-os-circuit/runtime/server.ts:84 passes for its own direct calls
      DEFAULT_AGENT_WORKERS,
    );
    await sleep(200);
    const bypassStream = received.join("");
    const sawBypass = bypassStream.includes('"kind":"joint"') && bypassStream.includes('"from_capability":"dna-os-circuit"') && bypassStream.includes('"to_capability":"agent-gateway"') && bypassStream.includes(task.task_id);
    assert(sawBypass, "a submitTask() call with client_id=dna-os-circuit (the real bypass path) STILL produced a live joint-monitor event, via persistStatus, without router.ts ever being called");
    console.log("PASS: dna-os-circuit's confirmed router.ts bypass -> gateway.ts#persistStatus -> live joint-monitor event — bypass closed");
  }

  sseRequest.destroy();
  server.close();
  console.log("=== ALL router-wiring-proof.test.ts CASES PASSED ===");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
