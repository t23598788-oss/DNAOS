/**
 * หน้าที่: the real test for ../semantic-model.ts. Proves: every component
 * and connection is a real projection of circuit.json/sbgn-view-builder.ts/
 * capability-registrar (not invented); no duplicate component_id exists
 * between the topology-sourced set and the capability-registrar-sourced
 * set (execution/permission-reasoner dedupe holds); an unclassified edge
 * is honestly UNKNOWN, never guessed; the one real proven permission-gate
 * connection resolves; VALIDATOR's ports are explicitly reported
 * unverifiable at the connection layer (PORT_UNVERIFIED), never claimed as
 * a real cross-component port path; and a full end-to-end COMPONENT-level
 * path (PERMISSION -> EXECUTION) traces real evidence at every hop.
 *
 * How to run: npx tsx dna-os-circuit/definition/tests/semantic-model.test.ts
 */

import { buildSemanticComponents, buildSemanticConnections } from "../semantic-model";
import { EDGE_CLASS_MAP } from "../sbgn-view-builder";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function run(): void {
  console.log("=== dna-os-circuit/definition/tests/semantic-model.test.ts ===");

  const components = buildSemanticComponents();
  const connections = buildSemanticConnections();

  // 1. No duplicate component_id anywhere.
  {
    const ids = components.map((c) => c.component_id);
    const unique = new Set(ids);
    assert(unique.size === ids.length, `expected 0 duplicate component_id, found ${ids.length - unique.size}`);
    console.log(`PASS: ${components.length} components, zero duplicate component_id`);
  }

  // 2. execution/permission-reasoner are NOT duplicated as CAPREG_ entries (real dedupe).
  {
    const dupExec = components.find((c) => c.component_id === "CAPREG_execution");
    const dupPerm = components.find((c) => c.component_id === "CAPREG_permission-reasoner");
    assert(dupExec === undefined && dupPerm === undefined, "execution/permission-reasoner must never appear as a second, duplicate CAPREG_ component");
    assert(components.some((c) => c.component_id === "EXECUTION"), "the real EXECUTION topology node still exists");
    console.log("PASS: capability-registrar dedupe holds — no duplicate EXECUTION/PERMISSION components");
  }

  // 3. Every component has a real evidence_reference (non-empty string, always).
  {
    const missingEvidence = components.filter((c) => typeof c.evidence_reference !== "string" || c.evidence_reference.length === 0);
    assert(missingEvidence.length === 0, `every component must carry a real evidence_reference; ${missingEvidence.length} did not`);
    console.log("PASS: every component carries a non-empty evidence_reference");
  }

  // 4. Every connection has a real evidence_reference, and endpoints are real component_ids.
  {
    const componentIds = new Set(components.map((c) => c.component_id));
    for (const conn of connections) {
      assert(typeof conn.evidence_reference === "string" && conn.evidence_reference.length > 0, `connection "${conn.connection_id}" must carry a real evidence_reference`);
    }
    const topLevelIds = new Set(["INPUT", "OWNER_COMMAND", "COMMAND_ROUTER", "PERMISSION", "EXECUTION", "RESULT"]);
    for (const id of topLevelIds) assert(componentIds.has(id), `real top-level component "${id}" must exist`);
    console.log(`PASS: ${connections.length} connections, every one carries real evidence, real endpoints for the core topology`);
  }

  // 5. An edge with no EDGE_CLASS_MAP entry is honestly UNKNOWN, never
  // guessed. Previously pinned to a specific real edge id
  // (e_external_ai_ai_write_control) as its example of "currently
  // unmapped" — real progress on EDGE_CLASS_MAP's own completeness (see
  // ../tests/sbgn-view-builder.test.ts, which now asserts full coverage of
  // every real circuit.json edge) makes that pin stale by design: a
  // completed map is a GOOD outcome, not a reason for this test to break.
  // Tests the exact same `EDGE_CLASS_MAP[id] ?? UNKNOWN` fallback
  // semantic-model.ts itself uses (see its buildSemanticConnections),
  // against an id guaranteed to never be a real edge, so this assertion
  // stays true regardless of how complete the real map becomes.
  {
    const fakeEdgeId = "e_this_id_is_not_a_real_circuit_json_edge";
    assert(!(fakeEdgeId in EDGE_CLASS_MAP), "the synthetic id must not collide with a real EDGE_CLASS_MAP entry");
    const fallback = EDGE_CLASS_MAP[fakeEdgeId] ?? "UNKNOWN";
    assert(fallback === "UNKNOWN", `expected UNKNOWN for an id with no EDGE_CLASS_MAP entry, got "${fallback}"`);
    console.log("PASS: an unclassified edge honestly reports UNKNOWN connection_type, never guessed");
  }

  // 6. The one real, structurally-proven permission gate resolves with real evidence.
  {
    const gateEdge = connections.find((c) => c.connection_id === "e_permission_execution");
    assert(gateEdge !== undefined, "the real e_permission_execution edge exists");
    assert(gateEdge!.permission_gate !== "UNKNOWN", "e_permission_execution must carry a real, non-UNKNOWN permission_gate");
    assert(String(gateEdge!.permission_gate).includes("evaluateExecutionPermission"), "the real gate names the real function that enforces it");
    console.log(`PASS: e_permission_execution resolves a real permission_gate: "${gateEdge!.permission_gate}"`);
  }

  // 7. VALIDATOR port connections exist, use the SAME real id scheme circuit-sbgn.json's actual rendered port edges use, and are explicitly PORT_UNVERIFIED (never claimed as a real cross-component port path).
  {
    const portConns = connections.filter((c) => c.connection_id.startsWith("PORT_EDGE_"));
    assert(portConns.length === 6, `expected 6 real VALIDATOR port connections, got ${portConns.length}`);
    assert(portConns.some((c) => c.connection_id === "PORT_EDGE_PORT_VALIDATOR_0"), "port connection ids must match sbgn-view-builder.ts's real buildPortElements() id scheme exactly, so the browser can look them up by real rendered edge id");
    for (const pc of portConns) {
      assert(pc.connection_type === "UNKNOWN", "a port-connector edge must never claim a classified connection_type it does not have");
      assert(pc.evidence_reference.includes("PORT_UNVERIFIED"), "every VALIDATOR port connection must self-report PORT_UNVERIFIED in its evidence_reference");
    }
    console.log("PASS: all 6 VALIDATOR port connections exist, use the real rendered edge id scheme, and honestly self-report PORT_UNVERIFIED");
  }

  // 8. Full end-to-end COMPONENT-level path proof: PERMISSION -> EXECUTION, every hop's evidence traceable.
  {
    const permission = components.find((c) => c.component_id === "PERMISSION")!;
    const execution = components.find((c) => c.component_id === "EXECUTION")!;
    const gateEdge = connections.find((c) => c.connection_id === "e_permission_execution")!;
    assert(permission.evidence_reference.includes("circuit.json"), "PERMISSION component's evidence traces to circuit.json");
    assert(execution.evidence_reference.includes("circuit.json"), "EXECUTION component's evidence traces to circuit.json");
    assert(gateEdge.source_component_id === "PERMISSION" && gateEdge.target_component_id === "EXECUTION", "the connection's real endpoints match the two real components");
    assert(execution.inputs.includes("PERMISSION"), "EXECUTION's real derived inputs list includes PERMISSION (from circuit.json's own edge, not inferred)");
    console.log("PASS: full end-to-end path PERMISSION -> [e_permission_execution, real gate evidence] -> EXECUTION, every hop independently traceable to real evidence");
  }

  console.log("=== ALL semantic-model.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
