/**
 * หน้าที่: §J — an execution RESOURCE fails, and the system keeps going on
 * the SAME work_id.
 *
 * NO OUTAGE IS CREATED. It uses a resource that is ALREADY unavailable on
 * this machine and was already observed to be so: the CLAUDE worker
 * resolves to a real executable and then reports authentication
 * unavailable. That is a real resource failure, not an arranged one.
 *
 * The test submits ONE command and then watches. It never selects a
 * resource, never calls a failover function, and never decides that a
 * provider is exhausted — every one of those is the backbone's own
 * decision, read back afterwards from the persisted event stream.
 *
 * How to run (macOS, Node >=16):
 *   npx tsx control/owner-backbone/tests/resource-failover-proof.test.ts
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { persistResolution } from "../../work-resolution/contract";
import type { ResolvedWorkContext } from "../../work-resolution/types";
import { newOwnerCommand, submitOwnerCommandEnvelope, awaitDispatch, eventsForWork, waitingRowFor } from "../contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 400)); }
}

const TARGET_DIR = "control/owner-backbone/tests/agent-target";

function proofResolution(workId: string): ResolvedWorkContext {
  return {
    work_id: workId, decision: "EXTEND_EXISTING",
    existing_resource_id: "resource-owner-backbone-agent-target",
    existing_capability_id: "capability-owner-backbone-agent-target",
    canonical_name: "owner-backbone-agent-target",
    repository: "DNA-OS-INFRASTRUCTURE", source_root: TARGET_DIR,
    exact_source_paths: [`${TARGET_DIR}/subject.ts`], contract_paths: [],
    public_functions: ["REVISION"], input_contract: [], output_contract: [],
    runtime_owner: "none", runtime_type: "none", service_id: "none", credential_boundary: "none",
    dependencies: [], consumers: [], blueprint_refs: [], evidence_refs: [],
    missing_piece: "REVISION does not carry the requested marker",
    required_change: "set REVISION to the requested marker",
    allowed_write_scope: [TARGET_DIR],
    forbidden_write_scope: ["control/owner-backbone/gateway.ts", "connections", "credentials"],
    components_to_reuse: [], components_not_to_reimplement: [],
    required_imports: [], verification_commands: [], completion_conditions: ["REVISION changed on disk"],
    next_action: "dispatch", resolution_path: [], dispatchable: true, blocking_reason: "",
  } as ResolvedWorkContext;
}

async function main(): Promise<void> {
  const workId = `work-failover-${Date.now()}`;
  persistResolution(proofResolution(workId));

  const command = newOwnerCommand({
    source: "OWNER_UI", command_type: "CODE_CHANGE",
    requested_action: `In subject.ts, set the exported REVISION constant to exactly "failover-${Date.now()}". Change nothing else.`,
    target: TARGET_DIR,
    // CLAUDE first because it is the resource already known to be
    // unavailable here — the failover has to start from a real failure.
    parameters: { worker_kind: "CLAUDE", timeout_ms: "120000" },
    work_id_if_existing: workId,
  });

  const started = Date.now();
  const ack = await submitOwnerCommandEnvelope(command);
  const dispatch = await awaitDispatch(ack.work_id);
  const totalMs = Date.now() - started;

  const events = eventsForWork(ack.work_id);
  console.log("\n  EVENT TIMELINE");
  for (const e of events) {
    console.log(`  ${e.observed_at.slice(11, 23)}  ${e.event_type.padEnd(22)} ${e.state.slice(0, 28).padEnd(28)} ${e.next_action.slice(0, 64)}`);
  }
  console.log(`\n  ${dispatch?.detail.slice(0, 200)}\n`);

  const allocations = events.filter((e) => e.event_type === "AGENT_ALLOCATED");
  const failures = events.filter((e) => e.event_type === "AGENT_FAILED");
  const failovers = events.filter((e) => e.event_type === "AGENT_FAILOVER");
  const executionIds = new Set(events.flatMap((e) => e.evidence_refs.filter((r) => r.startsWith("execution:"))));

  check("J1. a REAL resource failure was observed, not arranged", failures.length > 0 && /CLAUDE|Not logged in|auth/i.test(`${failures[0].state} ${failures[0].next_action}`), failures.map((e) => e.next_action.slice(0, 80)));
  check("J2. RESOURCE failure produced a SystemEvent, not a thrown error", failures.every((e) => e.work_id === ack.work_id));

  if (failovers.length > 0) {
    check("J3. the resolver chose ANOTHER already-authorized resource", allocations.length >= 2, allocations.map((e) => e.state));
    check("J4. SAME work_id across every attempt", events.every((e) => e.work_id === ack.work_id), ack.work_id);
    check("J5. each attempt has its OWN execution_id", executionIds.size === allocations.length, { executions: executionIds.size, allocations: allocations.length });
    check("J6. the failover names the resource it moved off", /_UNAVAILABLE/.test(failovers[0].state), failovers[0].state);
  }

  const waiting = waitingRowFor(ack.work_id);
  const exhausted = events.some((e) => e.event_type === "RESOURCE_UNAVAILABLE");
  if (exhausted) {
    console.log(`  every authorized resource was exhausted -> waiting status=${waiting?.status}`);
    check("J7. exhaustion parks the work as WAITING_FOR_RESOURCE", waiting?.status === "WAITING_FOR_RESOURCE", waiting?.status);
    check("J8. it did NOT ask the Owner — no money or new permission is needed", !events.some((e) => e.event_type === "OWNER_DECISION_REQUIRED"), events.map((e) => e.event_type));
    check("J9. the work is preserved for resumption on the SAME work_id", waiting?.work_id === ack.work_id && (waiting?.blocked_on.length ?? 0) > 0, waiting?.blocked_on);
  } else {
    check("J7*. a resource completed the work after the failover", dispatch?.dispatched === true, dispatch?.detail);
  }

  console.log(`\n  attempts=${allocations.length}  failovers=${failovers.length}  execution_ids=${executionIds.size}  total=${totalMs}ms`);
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
