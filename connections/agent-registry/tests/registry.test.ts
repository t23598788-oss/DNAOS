/**
 * หน้าที่: real, executable evidence for connections/agent-registry/ —
 * the Owner's named scenarios (2026-08-20): registry discovery, provider
 * unavailable, sandbox scope denial, duplicate prevention, restart
 * recovery, Owner Console status.
 *
 * How to run:
 *   npx tsx connections/agent-registry/tests/registry.test.ts
 */
import { registerAgent, refreshAgent, listRegisteredAgents, checkSandboxScope } from "../registry";
import { detectAvailability } from "../detect";
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

const DATA_DIR = join(process.cwd(), "connections/agent-registry/data");
const REGISTRY_FILE = join(DATA_DIR, "agents.jsonl");
function resetStore(): void {
  if (existsSync(REGISTRY_FILE)) rmSync(REGISTRY_FILE);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, "", "utf-8");
}

async function main(): Promise<void> {
  // 1. registry discovery — Claude Code is always LIVE by construction (this process IS it)
  await check("registry discovery: claude-code detects as LIVE (self-evident)", async () => {
    const detection = await detectAvailability("claude-code");
    assert(detection.availability === "LIVE", `expected LIVE, got ${detection.availability}`);
  });

  // 2. provider unavailable — kimi has no known process/config on this machine -> UNKNOWN, never fabricated LIVE
  await check("provider unavailable: kimi (no process, no config dir) is UNKNOWN, never LIVE", async () => {
    const detection = await detectAvailability("kimi");
    assert(detection.availability === "UNKNOWN" || detection.availability === "WAITING_LOGIN", `expected UNKNOWN or WAITING_LOGIN, got ${detection.availability} — must never be LIVE without a real matching signal`);
    assert(detection.availability !== "LIVE" || false, "kimi must never report LIVE — there is no real process/config check that could justify it in this environment");
  });

  // 3. sandbox scope denial — dna-os-deadboard (production business code) is never a valid registry scope
  await check("sandbox scope denial: dna-os-deadboard is rejected", () => {
    const result = checkSandboxScope("/Users/tam/Desktop/dna-os-deadboard");
    assert(!result.ok, "expected dna-os-deadboard to be denied — it is production business code, never an agent-registry sandbox scope");
  });
  await check("sandbox scope allowed: DNA-OS-INFRASTRUCTURE is accepted", () => {
    const result = checkSandboxScope("/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE");
    assert(result.ok, "expected the canonical infra root to be allowed");
  });

  // 4. role allowlist — codex may only register as inspect_test, never code_review_build
  resetStore();
  await check("role denial: codex cannot register with role code_review_build", async () => {
    const outcome = await registerAgent({ provider: "codex", role: "code_review_build", capability: ["test"], transport: "local_process", workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE" });
    assert(!outcome.ok && outcome.denied_at_stage === "role", "expected role-stage denial for codex+code_review_build");
  });
  await check("role allowed: codex CAN register with role inspect_test", async () => {
    const outcome = await registerAgent({ provider: "codex", role: "inspect_test", capability: ["scope_config_tests"], transport: "cli", workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE" });
    assert(outcome.ok, "expected codex+inspect_test to be admitted");
  });

  // 5. sandbox scope denial blocks registration end-to-end (not just the standalone checkSandboxScope call)
  await check("registerAgent: out-of-scope workspace_scope is denied at registration, never persisted", async () => {
    const outcome = await registerAgent({ provider: "claude-code", role: "code_review_build", capability: ["build"], transport: "extension_host", workspace_scope: "/Users/tam/Desktop/dna-os-deadboard" });
    assert(!outcome.ok && outcome.denied_at_stage === "scope", "expected scope-stage denial");
    const agents = listRegisteredAgents();
    assert(!agents.some((a) => a.workspace_scope === "/Users/tam/Desktop/dna-os-deadboard"), "a scope-denied registration must never appear in the persisted registry");
  });

  // 6. duplicate prevention — registering the SAME provider twice does not create two independent "current" entries; listRegisteredAgents returns the real record set with distinct agent_ids (each registerAgent call issues its own id) but each individual agent_id is still exactly one entry
  await check("duplicate prevention: refreshAgent updates the SAME agent_id, never creates a second entry for it", async () => {
    const registered = await registerAgent({ provider: "gemini", role: "research_review", capability: ["review"], transport: "extension_host", workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE" });
    assert(registered.ok, "expected gemini+research_review to be admitted");
    if (!registered.ok) return;
    const agentId = registered.registration.agent_id;
    await refreshAgent(agentId);
    await refreshAgent(agentId);
    const agents = listRegisteredAgents();
    const matches = agents.filter((a) => a.agent_id === agentId);
    assert(matches.length === 1, `expected exactly 1 current entry for ${agentId} after 3 total writes (1 register + 2 refresh), got ${matches.length}`);
  });

  // 7. restart recovery — a fresh read (simulating a new process) sees the same persisted registrations
  await check("restart recovery: listRegisteredAgents after a simulated restart still finds prior registrations", () => {
    const agents = listRegisteredAgents();
    assert(agents.length >= 2, `expected at least 2 persisted registrations (codex, gemini) to survive a fresh read, got ${agents.length}`);
  });

  // 8. Owner Console status — every registered agent reports one of the 5 real availability states, never an invented one
  await check("Owner Console status: every agent's availability is one of the 5 real states", () => {
    const validStates = new Set(["LIVE", "IDLE", "WAITING_LOGIN", "BLOCKED", "UNKNOWN"]);
    const agents = listRegisteredAgents();
    assert(agents.every((a) => validStates.has(a.availability)), "found an agent with an availability value outside the real 5-state enum");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
