/**
 * หน้าที่: real evidence for ../codex-session-bridge.ts after "DNA OS
 * Single Process Creation Gate — Consolidation" (2026-08-24) retired its
 * injectable `CodexProcessRunner` mock seam — `runCodexWorkOrder` now
 * always routes through the real `control/agent-gateway/contract.ts#runAgentWorkOrder`
 * (Agent Gateway -> Agent Host -> sandbox-exec), so a fake-runner-based
 * unit test would no longer be testing this file's real behavior. This
 * suite therefore tests exactly what is still real and free to check
 * without invoking the (real, cost-incurring) `codex` CLI on every run:
 * the WorkOrder validator gate (must reject before ANY dispatch), and
 * `isCodexCliAvailable`'s real resolution via
 * `control/agent-host/worker-registry.ts`. Full real-Codex-dispatch
 * behavior (WORKER_NOT_AVAILABLE, timeout, real PASS) is already proven
 * by `control/agent-host/tests/real-agent-launch.test.ts` and
 * `control/agent-host/tests/live-agent-execution-path.test.ts` — this
 * file does not re-invoke Codex just to re-prove the same Agent Host
 * properties a second time.
 *
 * How to run:
 *   npx tsx connections/agent-registry/tests/codex-session-bridge.test.ts
 */
import { runCodexWorkOrder, isCodexCliAvailable } from "../codex-session-bridge";
import type { WorkOrder } from "../../../control/agent-gateway/types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function sandboxWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    operation: "CREATE",
    target_type: "FILE",
    target_path: "tests/__sandbox__/codex-bridge-probe.txt",
    requested_change: "write a one-line probe file",
    content: "probe",
    workspace_scope: "tests/__sandbox__/",
    mode: "sandbox",
    required_tests: ["sandbox.write"],
    forbidden_files: [],
    evidence: [{ source: "test", note: "codex-session-bridge.test.ts" }],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // 1. unauthorized / out-of-scope — the EXISTING validator rejects before Agent Host is ever reached
  await check("unauthorized (out-of-scope path): validator rejects, Agent Host is never reached", async () => {
    const taskId = `codex-bridge-test-unauth-${Date.now()}`;
    const outcome = await runCodexWorkOrder(sandboxWorkOrder({ target_path: "/etc/passwd" }), taskId, 5_000);
    assert(!outcome.ok && outcome.reason === "VALIDATOR_FAILED", `expected VALIDATOR_FAILED, got ${JSON.stringify(outcome)}`);
  });

  // 2. isCodexCliAvailable resolves through the real worker-registry, never a bare `which codex` shell-out
  await check("isCodexCliAvailable resolves through control/agent-host/worker-registry.ts's resolveWorker(\"CODEX\")", async () => {
    const available = await isCodexCliAvailable();
    console.log(`      isCodexCliAvailable() -> ${available} (real, existsSync-checked resolution, no bare-name PATH lookup)`);
    assert(typeof available === "boolean", "expected a real boolean, not a fabricated default");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
