/**
 * หน้าที่: the real test for ../circuit-state.ts — plain assert-based,
 * matching this repo's `npx tsx <file>` convention (see e.g.
 * ../../../execution/run/tests/executor.test.ts, which this file's
 * hand-rolled `assert()` and `declare const` block are copied from — no
 * @types/node in this repo). Proves circuit-state's updates honor
 * circuit.json (unknown ids rejected, invalid statuses rejected, no-op
 * updates emit no event, real updates do and are reflected in the
 * snapshot).
 *
 * How to run: npx tsx dna-os-circuit/runtime/tests/circuit-state.test.ts
 */

import { CircuitState, UnknownNodeError, UnknownEdgeError, InvalidStatusError, type ChangeEvent } from "../circuit-state";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function run(): Promise<void> {
  console.log("=== dna-os-circuit/runtime/circuit-state.test.ts ===");

  // 1. constructs with every node/edge from circuit.json at its default status/IDLE.
  {
    const state = new CircuitState();
    assert(state.listNodeIds().includes("INPUT"), "expected top-level node INPUT to exist");
    assert(state.listNodeIds().includes("EXEC_COMMAND_DESCRIPTOR"), "expected sub-circuit node EXEC_COMMAND_DESCRIPTOR to exist");
    assert(state.listEdgeIds().includes("e_input_owner_command"), "expected top-level edge e_input_owner_command to exist");
    const input = state.getNode("INPUT");
    assert(input !== undefined && input.status === "READY", "expected INPUT default_status READY per circuit.json");
    const validator = state.getNode("VALIDATOR");
    assert(validator !== undefined && validator.status === "NOT_YET_REAL", "expected VALIDATOR default_status NOT_YET_REAL per circuit.json");
    console.log("PASS: construction reflects circuit.json defaults");
  }

  // 2. updateNode/updateEdge reject unknown ids — never silently invent a node/edge.
  {
    const state = new CircuitState();
    let threw = false;
    try {
      state.updateNode("NOT_A_REAL_NODE", "READY");
    } catch (error) {
      threw = error instanceof UnknownNodeError;
    }
    assert(threw, "expected UnknownNodeError for an id not declared in circuit.json");

    let edgeThrew = false;
    try {
      state.updateEdge("not_a_real_edge", "ACTIVE");
    } catch (error) {
      edgeThrew = error instanceof UnknownEdgeError;
    }
    assert(edgeThrew, "expected UnknownEdgeError for an edge id not declared in circuit.json");
    console.log("PASS: unknown node/edge ids are rejected, never silently accepted");
  }

  // 3. invalid status values are rejected.
  {
    const state = new CircuitState();
    let threw = false;
    try {
      // @ts-expect-error deliberately invalid status to prove runtime validation, not just compile-time
      state.updateNode("INPUT", "TOTALLY_MADE_UP");
    } catch (error) {
      threw = error instanceof InvalidStatusError;
    }
    assert(threw, "expected InvalidStatusError for a status not in circuit.json's declared statuses");
    console.log("PASS: invalid status values are rejected at runtime, not just by the type system");
  }

  // 4. a real update changes the snapshot and emits exactly one change event; a no-op update emits none.
  {
    const state = new CircuitState();
    const events: ChangeEvent[] = [];
    state.on("change", (event) => events.push(event));

    state.updateNode("PERMISSION", "RUNNING", "evaluating");
    assert(events.length === 1, `expected exactly 1 change event, got ${events.length}`);
    assert(events[0].kind === "node" && events[0].id === "PERMISSION" && events[0].status === "RUNNING", "expected the emitted event to describe the real update");

    const snapshotAfter = state.snapshot();
    const permissionNode = snapshotAfter.nodes.find((n) => n.id === "PERMISSION");
    assert(permissionNode !== undefined && permissionNode.status === "RUNNING", "expected snapshot to reflect the update");

    // No-op: same status + same note -> no new event.
    state.updateNode("PERMISSION", "RUNNING", "evaluating");
    assert(events.length === 1, `expected no new event for a no-op update, still got ${events.length}`);

    state.updateEdge("e_router_permission", "ACTIVE", "ALLOW");
    assert(events.length === 2, `expected a second change event for the edge update, got ${events.length}`);
    const edgeSnapshot = state.snapshot().edges.find((e) => e.id === "e_router_permission");
    assert(edgeSnapshot !== undefined && edgeSnapshot.state === "ACTIVE" && edgeSnapshot.label === "ALLOW", "expected edge snapshot to reflect ACTIVE + label ALLOW");
    console.log("PASS: real updates emit exactly one change event and update the snapshot; no-op updates emit none");
  }

  // 5. off() unsubscribes — a removed listener receives no further events.
  {
    const state = new CircuitState();
    const events: ChangeEvent[] = [];
    const listener = (event: ChangeEvent) => events.push(event);
    state.on("change", listener);
    state.updateNode("EXECUTION", "RUNNING");
    assert(events.length === 1, "expected 1 event before unsubscribe");
    state.off("change", listener);
    state.updateNode("EXECUTION", "READY");
    assert(events.length === 1, "expected still 1 event after unsubscribe — off() must actually stop delivery");
    console.log("PASS: off() unsubscribes a listener");
  }

  console.log("=== ALL circuit-state.test.ts CASES PASSED ===");
}

run().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
