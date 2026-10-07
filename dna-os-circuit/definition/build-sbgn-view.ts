/**
 * หน้าที่: one-shot generator script — reads ./circuit.json (the honest
 * topology) and ./sbgn-view-builder.ts (pure decoration functions) and
 * writes ./circuit-sbgn.json, the richer SBGN rendering graph consumed
 * by ../ui/circuit-board/circuit-board.js. Run via
 * `npx tsx dna-os-circuit/definition/build-sbgn-view.ts` whenever
 * circuit.json's real topology changes. Never run automatically at
 * server-request time (../runtime/server.ts only serves the static
 * output file) — keeps the runtime server npm-free and framework-free.
 */

import circuitDefinition from "./circuit.json";
import {
  buildContainerNodes,
  buildPortElements,
  CONTAINER_ASSIGNMENTS,
  decorateEdge,
  decorateNode,
  VALIDATOR_PORTS,
} from "./sbgn-view-builder";

declare const require: (id: string) => unknown;
declare const console: { log(...args: unknown[]): void };
declare const __dirname: string;
interface NodeFsModule {
  writeFileSync(path: string, data: string, encoding: "utf-8"): void;
}
interface NodePathModule {
  join(...segments: string[]): string;
}
const fs = require("fs") as NodeFsModule;
const path = require("path") as NodePathModule;

interface CircuitDefinitionFile {
  statuses: unknown;
  symbols: unknown;
  nodes: TopNode[];
  edges: TopEdge[];
  sub_circuits: Record<string, { nodes: TopNode[]; edges: TopEdge[] }>;
}

interface TopNode {
  id: string;
  label: string;
  source_note?: string;
}
interface TopEdge {
  id: string;
  from: string;
  to: string;
}

function main(): void {
  const def = circuitDefinition as unknown as CircuitDefinitionFile;

  const nodes: ReturnType<typeof decorateNode>[] = [];
  const edges: ReturnType<typeof decorateEdge>[] = [];

  // 1. Compound domain containers (must be emitted before their children for readability; cytoscape does not require ordering, but it keeps the file human-legible).
  nodes.push(...buildContainerNodes(CONTAINER_ASSIGNMENTS));

  // 2. Top-level real nodes, decorated with SBGN class + parent container assignment.
  //    EXECUTION doubles as the compound container for its own real sub-circuit steps (step 5: sub-circuit expansion), nested one level below EXECUTION_DOMAIN.
  for (const n of def.nodes) {
    nodes.push(decorateNode(n.id, n.label, { sourceNote: n.source_note }));
  }
  for (const e of def.edges) {
    edges.push(decorateEdge(e.id, e.from, e.to));
  }

  // 3. EXECUTION sub-circuit nodes/edges, nested as real children of the EXECUTION compound node (step 5).
  const execSub = def.sub_circuits.EXECUTION;
  for (const n of execSub.nodes) {
    nodes.push(decorateNode(n.id, n.label, { parent: "EXECUTION", sourceNote: n.source_note }));
  }
  for (const e of execSub.edges) {
    edges.push(decorateEdge(e.id, e.from, e.to));
  }

  // 4. PERMISSION sub-circuit nodes/edges, nested as real children of PERMISSION.
  const permSub = def.sub_circuits.PERMISSION;
  for (const n of permSub.nodes) {
    nodes.push(decorateNode(n.id, n.label, { parent: "PERMISSION", sourceNote: n.source_note }));
  }
  for (const e of permSub.edges) {
    edges.push(decorateEdge(e.id, e.from, e.to));
  }

  // 5. VALIDATOR's >=3 logical ports — satellite-node approximation (step 3). VALIDATOR is NOT_YET_REAL but is a real, fixed topology node.
  const portElements = buildPortElements(VALIDATOR_PORTS);
  nodes.push(...portElements.nodes);
  edges.push(...portElements.edges);

  const output = {
    $generated_from: "circuit.json + sbgn-view-builder.ts — run `npx tsx dna-os-circuit/definition/build-sbgn-view.ts` to regenerate. Presentation-layer only: adds no new live-tracked topology.",
    statuses: def.statuses,
    symbols: def.symbols,
    nodes,
    edges,
  };

  fs.writeFileSync(path.join(__dirname, "circuit-sbgn.json"), JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`[build-sbgn-view] wrote circuit-sbgn.json with ${nodes.length} nodes, ${edges.length} edges`);
}

main();
