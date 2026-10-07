/**
 * หน้าที่: proves Output Routing is registry-driven, never hardcoded —
 * a capability_id with a registered consumer resolves to it; one without
 * resolves honestly to NO_REGISTERED_CONSUMER, never a guess; and every
 * WORK_ITEM consumer traces back to the real DEFAULT_AGENT_WORKERS list,
 * never a hand-maintained duplicate.
 *
 * How to run: npx tsx control/output-routing/tests/output-router.test.ts
 */

import { resolveOutputConsumers } from "../output-router";
import { OUTPUT_CONSUMER_REGISTRY } from "../consumer-registry";
import { DEFAULT_AGENT_WORKERS } from "../../agent-gateway/contract";
import type { DnaOsOutput } from "../../../contracts/command/output-contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function systemStateOutput(capability_id: string): DnaOsOutput {
  return { lane: "SYSTEM_STATE", task_id: "task-fixture", capability_id, status: "COMPLETED", summary: "fixture", evidence: [], next_action: null };
}

function workItemOutput(capability_id: string): DnaOsOutput {
  return { lane: "WORK_ITEM", task_id: "task-fixture", capability_id, status: "COMPLETED", summary: "fixture", evidence: [], artifacts: [], dispatcher_task_id: "task-fixture-inner", next_action: null };
}

check("a SYSTEM_STATE output resolves to the real registered consumers (dna-os-deadboard, connections/dna-os-mcp)", () => {
  const result = resolveOutputConsumers(systemStateOutput("os-login"));
  assert(result.status === "ROUTED", `expected ROUTED, got ${result.status}`);
  const consumerIds = result.consumers.map((c) => c.consumer_id).sort();
  assert(consumerIds.includes("dna-os-deadboard"), `expected dna-os-deadboard among consumers, got ${JSON.stringify(consumerIds)}`);
  assert(consumerIds.includes("connections/dna-os-mcp"), `expected connections/dna-os-mcp among consumers, got ${JSON.stringify(consumerIds)}`);
  for (const consumer of result.consumers) assert(consumer.status === "REGISTERED", `every returned consumer must be REGISTERED, got ${consumer.consumer_id}=${consumer.status}`);
});

check("a WORK_ITEM output resolves to every real registered AgentAdapter, never a hardcoded/hand-listed duplicate", () => {
  const result = resolveOutputConsumers(workItemOutput("dispatcher"));
  assert(result.status === "ROUTED", `expected ROUTED, got ${result.status}`);
  const consumerIds = result.consumers.map((c) => c.consumer_id).sort();
  const realWorkerIds = DEFAULT_AGENT_WORKERS.map((w) => w.describe().adapter_id).sort();
  assert(JSON.stringify(consumerIds) === JSON.stringify(realWorkerIds), `expected the exact real DEFAULT_AGENT_WORKERS list, got consumers=${JSON.stringify(consumerIds)} vs real=${JSON.stringify(realWorkerIds)}`);
  for (const consumer of result.consumers) assert(consumer.consumer_type === "WORKER_CAPABILITY", `expected WORKER_CAPABILITY, got ${consumer.consumer_type}`);
});

check("an unrouted capability_id honestly reports NO_REGISTERED_CONSUMER, never a fabricated destination", () => {
  // SYSTEM_STATE's two real consumers are both genuinely wildcard (Dead
  // Board and the MCP read tools really do consume every SYSTEM_STATE
  // output generically — see each entry's own evidence_ref), so the real
  // "nothing registered" case today is on the WORK_ITEM lane, whose one
  // real consumer set (DEFAULT_AGENT_WORKERS) is scoped to
  // capability_id "dispatcher" only, never a wildcard.
  const result = resolveOutputConsumers(workItemOutput("voice-bridge"));
  assert(result.status === "NO_REGISTERED_CONSUMER", `expected NO_REGISTERED_CONSUMER, got ${result.status}`);
  assert(result.consumers.length === 0, "expected zero consumers for a capability_id with no registered WORK_ITEM consumer");
});

check("a lane mismatch is never routed — a WORK_ITEM consumer never answers a SYSTEM_STATE query and vice versa", () => {
  const systemStateForDispatcher = resolveOutputConsumers(systemStateOutput("dispatcher"));
  assert(systemStateForDispatcher.consumers.every((c) => c.output_lane === "SYSTEM_STATE"), "a SYSTEM_STATE query must never return a WORK_ITEM-only consumer");
  const workItemForOsLogin = resolveOutputConsumers(workItemOutput("os-login"));
  assert(workItemForOsLogin.status === "NO_REGISTERED_CONSUMER", `os-login has no WORK_ITEM consumer registered — expected NO_REGISTERED_CONSUMER, got ${workItemForOsLogin.status}`);
});

check("every registry entry carries a real evidence_ref — no unexplained registration", () => {
  for (const entry of OUTPUT_CONSUMER_REGISTRY) {
    assert(typeof entry.evidence_ref === "string" && entry.evidence_ref.length > 0, `entry ${entry.consumer_id} is missing a real evidence_ref`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
