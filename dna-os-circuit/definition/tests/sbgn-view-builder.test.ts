/**
 * หน้าที่: the real test for ../sbgn-view-builder.ts — plain assert-based,
 * matching this repo's `npx tsx <file>` convention (see e.g.
 * ../../runtime/tests/circuit-state.test.ts, whose hand-rolled `assert()`
 * this file's own tiny helpers are copied from — no @types/node in this
 * repo, so `node:assert` is not importable under this repo's tsconfig).
 */

import {
  buildContainerNodes,
  buildPortElements,
  CONTAINER_ASSIGNMENTS,
  decorateEdge,
  decorateNode,
  EDGE_CLASS_MAP,
  VALIDATOR_PORTS,
} from "../sbgn-view-builder";
import circuitDefinition from "../circuit.json";

declare const console: { log(...args: unknown[]): void };
declare const process: { exitCode?: number };

function ok(condition: boolean, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}
function equal(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`assertion failed: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}
function throwsErr(fn: () => void, message: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(threw, message);
}

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// 1. Port generation: VALIDATOR must get >=3 logical ports, each a distinct satellite node + one connecting edge.
check("buildPortElements produces >=3 ports for VALIDATOR with correct direction wiring", () => {
  ok(VALIDATOR_PORTS.length >= 3, "VALIDATOR must have at least 3 logical ports");
  const { nodes, edges } = buildPortElements(VALIDATOR_PORTS);
  equal(nodes.length, VALIDATOR_PORTS.length, "one port node per spec");
  equal(edges.length, VALIDATOR_PORTS.length, "one connecting edge per spec");
  for (const n of nodes) {
    equal(n.data.class, "unspecified entity", "port node class");
    equal(n.data.clonemarker, false, "port node clonemarker");
    equal(n.data.stateVariables.length, 0, "port node stateVariables empty");
    equal(n.data.unitsOfInformation.length, 0, "port node unitsOfInformation empty");
    equal(n.data.sbgnPresentationOnly, true, "port node marked presentation-only");
  }
  const inputEdges = edges.filter((e) => e.data.target === "VALIDATOR");
  const outputEdges = edges.filter((e) => e.data.source === "VALIDATOR");
  equal(inputEdges.length, VALIDATOR_PORTS.filter((p) => p.direction === "input").length, "input port edges point into VALIDATOR");
  equal(outputEdges.length, VALIDATOR_PORTS.filter((p) => p.direction === "output").length, "output port edges point out of VALIDATOR");
});

// 2. Container assignment: every value in CONTAINER_ASSIGNMENTS becomes exactly one container node, and only real fixed topology node ids are keys.
check("buildContainerNodes yields one node per unique container, deduplicated", () => {
  const containers = buildContainerNodes(CONTAINER_ASSIGNMENTS);
  const uniqueTargets = new Set(Object.values(CONTAINER_ASSIGNMENTS));
  equal(containers.length, uniqueTargets.size, "one container node per unique target");
  for (const c of containers) {
    equal(c.data.class, "compartment", "container class");
    equal(c.data.sbgnPresentationOnly, true, "container marked presentation-only");
  }
  const realTopIds = new Set((circuitDefinition as { nodes: { id: string }[] }).nodes.map((n) => n.id));
  for (const key of Object.keys(CONTAINER_ASSIGNMENTS)) {
    ok(realTopIds.has(key), `container assignment key "${key}" must be a real fixed topology node id`);
  }
});

// 3. decorateNode: every real top-level and sub-circuit node id must have a NODE_CLASS_MAP entry (no silent fallback).
check("decorateNode covers every real node id declared in circuit.json (top-level + both sub-circuits)", () => {
  const def = circuitDefinition as {
    nodes: { id: string; label: string }[];
    sub_circuits: Record<string, { nodes: { id: string; label: string }[] }>;
  };
  for (const n of def.nodes) {
    const decorated = decorateNode(n.id, n.label);
    equal(decorated.data.id, n.id, "decorated id matches");
    ok(!!decorated.data.class, `missing class for ${n.id}`);
  }
  for (const subName of Object.keys(def.sub_circuits)) {
    for (const n of def.sub_circuits[subName].nodes) {
      const decorated = decorateNode(n.id, n.label, { parent: subName });
      equal(decorated.data.parent, subName, "sub-circuit node parent assignment");
    }
  }
});

// 4. decorateEdge: every real top-level and sub-circuit edge id must have an EDGE_CLASS_MAP entry, and mapped classes must be from the real cytoscape-sbgn-stylesheet arc vocabulary (README "Supported SBGN PD arcs").
const REAL_SBGN_ARC_CLASSES = new Set(["necessary stimulation", "production", "consumption", "stimulation", "catalysis", "inhibition"]);
check("decorateEdge covers every real edge id and only uses real SBGN arc classes", () => {
  const def = circuitDefinition as {
    edges: { id: string; from: string; to: string }[];
    sub_circuits: Record<string, { edges: { id: string; from: string; to: string }[] }>;
  };
  for (const e of def.edges) {
    const decorated = decorateEdge(e.id, e.from, e.to);
    ok(REAL_SBGN_ARC_CLASSES.has(decorated.data.class as string), `edge ${e.id} maps to unsupported class ${decorated.data.class}`);
  }
  for (const subName of Object.keys(def.sub_circuits)) {
    for (const e of def.sub_circuits[subName].edges) {
      const decorated = decorateEdge(e.id, e.from, e.to);
      ok(REAL_SBGN_ARC_CLASSES.has(decorated.data.class as string), `sub-edge ${e.id} maps to unsupported class ${decorated.data.class}`);
    }
  }
});

// 5. decorateEdge/decorateNode throw (never silently guess) for an unmapped id.
check("decorateEdge throws for an id with no EDGE_CLASS_MAP entry", () => {
  throwsErr(() => decorateEdge("e_totally_unmapped", "A", "B"), "expected throw for unmapped edge id");
});
check("decorateNode throws for an id with no NODE_CLASS_MAP entry", () => {
  throwsErr(() => decorateNode("TOTALLY_UNMAPPED", "X"), "expected throw for unmapped node id");
});

// 6. At least one BLOCK-style (inhibition), RESPONSE-style (production), and DATA-style (consumption) edge exist among real mapped edges — proof-item coverage sanity check.
check("EDGE_CLASS_MAP includes at least one of each required distinct arc style", () => {
  const values = new Set(Object.values(EDGE_CLASS_MAP));
  for (const required of ["necessary stimulation", "consumption", "production", "inhibition"]) {
    ok(values.has(required), `EDGE_CLASS_MAP missing required arc class "${required}"`);
  }
});

console.log(`\n${passed}/${passed} PASS`);
if (passed === 0) process.exitCode = 1;
