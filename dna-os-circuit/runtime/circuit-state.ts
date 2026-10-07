/**
 * หน้าที่: the in-memory current state of every node and edge in the
 * DNA OS Circuit — keyed by the ids declared in
 * ../definition/circuit.json (top-level nodes/edges AND every
 * sub-circuit node/edge, all in one flat state map since ids are unique
 * across the whole file). This is a pure state store: it does not know
 * about HTTP, SSE, or any real repo module — ../adapter/internal-state-adapter.ts
 * is the only thing that pushes real signal into it.
 *
 * Input: circuit.json topology (loaded once at construction) +
 * update calls (updateNode/updateEdge).
 * Output: `CircuitState` snapshots, and a Node EventEmitter ("change")
 * event carrying the ids that changed, for ../adapter's SSE server to
 * subscribe to.
 * Dependency ที่อนุญาต: ../definition/circuit.json.
 * สิ่งที่ห้ามแตะ: never import anything from outside dna-os-circuit/ here
 * — this file must stay a pure state container so it can be unit tested
 * without touching any real repo module. This repo has no
 * `@types/node` (see `../../execution/run/host-runtime.ts`'s header for
 * why), so this file uses a small hand-rolled emitter instead of
 * `node:events` — one less ambient-module declaration to maintain for a
 * two-event-type need ("change" only).
 */

import circuitDefinition from "../definition/circuit.json";

type ChangeListener = (event: ChangeEvent) => void;

export interface ChangeEvent {
  kind: "node" | "edge";
  id: string;
  status?: NodeStatus;
  state?: EdgeState;
  note?: string | null;
  label?: string | null;
}

/** Minimal single-event emitter — avoids depending on `node:events` (no `@types/node` in this repo; see file header). */
class ChangeEmitter {
  private listeners: Set<ChangeListener> = new Set();
  on(_event: "change", listener: ChangeListener): this {
    this.listeners.add(listener);
    return this;
  }
  off(_event: "change", listener: ChangeListener): this {
    this.listeners.delete(listener);
    return this;
  }
  protected emit(event: ChangeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export type NodeStatus = "READY" | "RUNNING" | "PARTIAL" | "BLOCKED" | "NOT_YET_REAL";
export type EdgeState = "IDLE" | "ACTIVE";

const VALID_NODE_STATUSES: readonly NodeStatus[] = ["READY", "RUNNING", "PARTIAL", "BLOCKED", "NOT_YET_REAL"];
const VALID_EDGE_STATES: readonly EdgeState[] = ["IDLE", "ACTIVE"];

export interface NodeState {
  id: string;
  status: NodeStatus;
  note: string | null;
}

export interface EdgeStateEntry {
  id: string;
  state: EdgeState;
  label: string | null;
}

export interface CircuitSnapshot {
  nodes: readonly NodeState[];
  edges: readonly EdgeStateEntry[];
  updated_at: string;
}

interface CircuitDefNode {
  id: string;
  label: string;
  default_status: NodeStatus;
}
interface CircuitDefEdge {
  id: string;
  from: string;
  to: string;
}
interface CircuitDef {
  nodes: CircuitDefNode[];
  edges: CircuitDefEdge[];
  sub_circuits: Record<string, { nodes: CircuitDefNode[]; edges: CircuitDefEdge[] }>;
}

function collectAllNodesAndEdges(def: CircuitDef): { nodes: CircuitDefNode[]; edges: CircuitDefEdge[] } {
  const nodes = [...def.nodes];
  const edges = [...def.edges];
  for (const sub of Object.values(def.sub_circuits)) {
    nodes.push(...sub.nodes);
    edges.push(...sub.edges);
  }
  return { nodes, edges };
}

export class UnknownNodeError extends Error {
  constructor(id: string) {
    super(`unknown node id: "${id}" — not declared in circuit.json`);
    this.name = "UnknownNodeError";
  }
}
export class UnknownEdgeError extends Error {
  constructor(id: string) {
    super(`unknown edge id: "${id}" — not declared in circuit.json`);
    this.name = "UnknownEdgeError";
  }
}
export class InvalidStatusError extends Error {
  constructor(kind: "node" | "edge", value: string) {
    super(`invalid ${kind} status: "${value}"`);
    this.name = "InvalidStatusError";
  }
}

/**
 * The live state container. One instance is the single source of truth
 * for a running circuit-board server; tests construct their own instance
 * per test so there is no shared global state.
 */
export class CircuitState extends ChangeEmitter {
  private readonly nodeIds: Set<string>;
  private readonly edgeIds: Set<string>;
  private readonly nodes: Map<string, NodeState>;
  private readonly edges: Map<string, EdgeStateEntry>;

  constructor(definition: CircuitDef = circuitDefinition as unknown as CircuitDef) {
    super();
    const { nodes: allNodes, edges: allEdges } = collectAllNodesAndEdges(definition);
    this.nodeIds = new Set(allNodes.map((n) => n.id));
    this.edgeIds = new Set(allEdges.map((e) => e.id));
    this.nodes = new Map(allNodes.map((n) => [n.id, { id: n.id, status: n.default_status, note: null }]));
    this.edges = new Map(allEdges.map((e) => [e.id, { id: e.id, state: "IDLE", label: null }]));
  }

  /** Every node id declared anywhere in circuit.json (top-level + sub-circuits) — used by the adapter/tests to validate against, never guessed. */
  listNodeIds(): readonly string[] {
    return Array.from(this.nodeIds);
  }
  listEdgeIds(): readonly string[] {
    return Array.from(this.edgeIds);
  }

  updateNode(id: string, status: NodeStatus, note: string | null = null): void {
    if (!this.nodeIds.has(id)) throw new UnknownNodeError(id);
    if (!VALID_NODE_STATUSES.includes(status)) throw new InvalidStatusError("node", status);
    const previous = this.nodes.get(id)!;
    if (previous.status === status && previous.note === note) return; // no-op, no event
    this.nodes.set(id, { id, status, note });
    this.emit({ kind: "node", id, status, note });
  }

  updateEdge(id: string, state: EdgeState, label: string | null = null): void {
    if (!this.edgeIds.has(id)) throw new UnknownEdgeError(id);
    if (!VALID_EDGE_STATES.includes(state)) throw new InvalidStatusError("edge", state);
    const previous = this.edges.get(id)!;
    if (previous.state === state && previous.label === label) return; // no-op, no event
    this.edges.set(id, { id, state, label });
    this.emit({ kind: "edge", id, state, label });
  }

  getNode(id: string): NodeState | undefined {
    return this.nodes.get(id);
  }
  getEdge(id: string): EdgeStateEntry | undefined {
    return this.edges.get(id);
  }

  snapshot(): CircuitSnapshot {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      updated_at: new Date().toISOString(),
    };
  }
}
