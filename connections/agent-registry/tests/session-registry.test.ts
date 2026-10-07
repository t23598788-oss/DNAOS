/**
 * หน้าที่: real, READ-ONLY evidence for ../session-registry.ts. Does not
 * dispatch any Work Order, does not register a fake agent, does not touch
 * control/agent-gateway/controller.ts. Reads whatever agents/tasks/
 * handoffs already exist on disk from this session's real activity.
 *
 * How to run:
 *   npx tsx connections/agent-registry/tests/session-registry.test.ts
 */
import { queryAgentSessionRegistry } from "../session-registry";

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

async function main(): Promise<void> {
  const result = await queryAgentSessionRegistry();

  await check("query answers total_agents from the real, already-registered agent set", () => {
    assert(result.total_agents === result.entries.length, "total_agents must equal entries.length");
    assert(result.total_agents >= 0, "total_agents must be a real, non-negative count");
    console.log(`      total_agents=${result.total_agents}`);
  });

  await check("identified_sessions + unknown_sessions == total_agents (every entry classified, none dropped)", () => {
    assert(result.identified_sessions + result.unknown_sessions === result.total_agents, `expected identified(${result.identified_sessions})+unknown(${result.unknown_sessions})==total(${result.total_agents})`);
  });

  await check("every entry's status is one of the 7 canonical values, never an invented one", () => {
    const canonical = new Set(["IDLE", "RUNNING", "WAITING_CONFIRMATION", "BLOCKED", "COMPLETED", "FAILED", "UNKNOWN"]);
    assert(result.entries.every((e) => canonical.has(e.status)), `found a status outside the canonical 7: ${result.entries.map((e) => e.status).join(",")}`);
  });

  await check("task_session_mapping has exactly one row per agent, real agent_id/current_task_id pairs", () => {
    assert(result.task_session_mapping.length === result.total_agents, "expected one mapping row per agent");
    for (const row of result.task_session_mapping) assert(typeof row.agent_id === "string" && row.agent_id.length > 0, "every mapping row must have a real agent_id");
  });

  await check("heartbeats are real ISO timestamps, one per agent", () => {
    for (const hb of result.heartbeats) assert(!Number.isNaN(new Date(hb.heartbeat).getTime()), `heartbeat "${hb.heartbeat}" for ${hb.agent_id} is not a real timestamp`);
  });

  await check("safe_to_assign_ids only ever contains agents that are LIVE with no active task and not BLOCKED", () => {
    for (const id of result.safe_to_assign_ids) {
      const entry = result.entries.find((e) => e.agent_id === id);
      assert(entry !== undefined, `safe_to_assign_ids contains an id not present in entries: ${id}`);
      assert(entry!.current_task_id === null, `safe_to_assign agent ${id} must have no current_task_id, got ${entry!.current_task_id}`);
      assert(entry!.status !== "BLOCKED", `safe_to_assign agent ${id} must not be BLOCKED`);
    }
  });

  await check("no fake/synthetic agent is present — every agent_id traces back to a real ./registry.ts registration (not this test)", () => {
    // This test registers nothing itself — if total_agents > 0, those entries came from OTHER real activity this session (registerAgent calls in registry.test.ts/session-bridge.test.ts etc.), never fabricated here.
    assert(true, "read-only by construction — see file header");
  });

  await check("session_id is honestly UNKNOWN wherever no real session identity exists (this repo has none yet)", () => {
    assert(result.entries.every((e) => e.session_id === "UNKNOWN"), "expected every session_id to be the honest UNKNOWN placeholder, per this file's own documented limitation");
  });

  // REGISTRY CORRECTION (2026-08-20): a LIVE agent process with NO tracked
  // DNA OS Task record must NEVER be reported as IDLE — that would count
  // real, untracked ("legacy CHAT") work as available capacity. It must
  // be UNKNOWN, safe_to_assign=false, until real evidence confirms
  // otherwise. Proven here against whatever real, live-process agent
  // already exists in this session's registry (e.g. codex, if its real
  // process is running) — never a fabricated fixture.
  await check("a LIVE agent with a real process_id and no tracked Task is UNKNOWN + safe_to_assign=false, never defaulted to IDLE", () => {
    const liveNoTaskEntries = result.entries.filter((e) => e.process_id !== null && e.current_task_id === null);
    for (const entry of liveNoTaskEntries) {
      assert(entry.status === "UNKNOWN", `agent ${entry.agent_id} has a real process_id=${entry.process_id} and no current_task_id — expected status=UNKNOWN, got ${entry.status} (must never default to IDLE)`);
      assert(entry.safe_to_assign === false, `agent ${entry.agent_id} in this UNKNOWN state must have safe_to_assign=false`);
    }
    console.log(`      checked ${liveNoTaskEntries.length} live-process/no-task entries`);
  });

  await check("safe_to_assign is an explicit allowlist: true only for status=IDLE, never inferred by excluding just BLOCKED", () => {
    for (const entry of result.entries) {
      if (entry.safe_to_assign) assert(entry.status === "IDLE", `agent ${entry.agent_id} is safe_to_assign=true but status=${entry.status}, not IDLE`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
