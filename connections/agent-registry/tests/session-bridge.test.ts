/**
 * หน้าที่: real evidence for ../session-bridge.ts — the Owner's Layer 7
 * "session-unavailable" scenario, plus confirming assignment for a
 * registered, unavailable provider is BLOCKED before dispatchTask (the
 * existing Controller) is ever called, and that an unregistered provider
 * is refused honestly.
 *
 * How to run:
 *   npx tsx connections/agent-registry/tests/session-bridge.test.ts
 */
import { assignWorkOrderToAgent } from "../session-bridge";
import { registerAgent } from "../registry";
import type { WorkOrder } from "../../../control/agent-gateway/types";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

declare const process: { exitCode?: number; cwd(): string };
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

const AGENTS_FILE = join(process.cwd(), "connections/agent-registry/data/agents.jsonl");
function resetStore(): void {
  if (existsSync(AGENTS_FILE)) rmSync(AGENTS_FILE);
  mkdirSync(join(process.cwd(), "connections/agent-registry/data"), { recursive: true });
  writeFileSync(AGENTS_FILE, "", "utf-8");
}

function sandboxWorkOrder(): WorkOrder {
  return {
    operation: "CREATE",
    target_type: "FILE",
    target_path: "tests/__sandbox__/session-bridge-probe.txt",
    requested_change: "session bridge test probe",
    content: "probe",
    workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",
    mode: "sandbox",
    required_tests: ["sandbox.write"],
    forbidden_files: [],
    evidence: [{ source: "test", note: "session-bridge.test.ts" }],
  };
}

async function main(): Promise<void> {
  resetStore();

  await check("assignment refuses an unregistered provider (AGENT_NOT_REGISTERED), never assumes a session", async () => {
    const outcome = await assignWorkOrderToAgent(sandboxWorkOrder(), "kimi", "probe", { user_id: "u", workspace_id: "w", conversation_id: "c", parent_task_id: null }, "test-client");
    assert(!outcome.ok && outcome.reason === "AGENT_NOT_REGISTERED", `expected AGENT_NOT_REGISTERED, got ${JSON.stringify(outcome)}`);
  });

  await check("session-unavailable: a registered but non-LIVE provider is BLOCKED before dispatchTask runs", async () => {
    // kimi has no real process/config on this machine (confirmed in registry.test.ts) — registers as UNKNOWN/WAITING_LOGIN, never LIVE.
    const registered = await registerAgent({ provider: "kimi", role: "research_review", capability: ["review"], transport: "extension_host", workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE" });
    assert(registered.ok, "expected kimi+research_review to be admitted at the registry layer (role+scope are valid even if availability is not LIVE)");
    const outcome = await assignWorkOrderToAgent(sandboxWorkOrder(), "kimi", "probe", { user_id: "u", workspace_id: "w", conversation_id: "c", parent_task_id: null }, "test-client");
    assert(!outcome.ok && outcome.reason === "SESSION_UNAVAILABLE", `expected SESSION_UNAVAILABLE, got ${JSON.stringify(outcome)}`);
  });

  // 2026-08-20 UPDATE: codex now routes through ../codex-session-bridge.ts's
  // real transport (see that file + codex-session-bridge.test.ts for full
  // success/session-unavailable/timeout/duplicate coverage). This test uses
  // a deliberately scope-mismatched WorkOrder so it stays fast/safe here
  // (fails at the existing validator, never invokes the real network-calling
  // codex CLI) — full live-transport evidence lives in codex-session-bridge.test.ts.
  await check("a LIVE, transported provider (codex) still goes through the existing WorkOrder validator — invalid scope is BLOCKED, never silently succeeds", async () => {
    const registered = await registerAgent({ provider: "codex", role: "inspect_test", capability: ["scope_config_tests"], transport: "cli", workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE" });
    assert(registered.ok, "expected codex+inspect_test to be admitted");
    const outcome = await assignWorkOrderToAgent(sandboxWorkOrder(), "codex", "probe", { user_id: "u", workspace_id: "w", conversation_id: "c", parent_task_id: null }, "test-client");
    assert(!outcome.ok && outcome.reason === "VALIDATOR_FAILED", `expected VALIDATOR_FAILED (workspace_scope mismatch), got ${JSON.stringify(outcome)}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
