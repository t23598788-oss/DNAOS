/**
 * Derived graph operations: traversal, impact, topo order, cycle detection.
 */

import type { SemanticEdge, SemanticGraph, SemanticId, SemanticRelation } from "./types";

const DEP_RELATIONS: ReadonlySet<SemanticRelation> = new Set(["DEPENDS_ON", "REQUIRES"]);

export function outgoing(graph: SemanticGraph, id: SemanticId, relation?: SemanticRelation): readonly SemanticEdge[] {
  return graph.edges.filter((e) => e.from === id && (relation === undefined || e.relation === relation));
}

export function incoming(graph: SemanticGraph, id: SemanticId, relation?: SemanticRelation): readonly SemanticEdge[] {
  return graph.edges.filter((e) => e.to === id && (relation === undefined || e.relation === relation));
}

/** Transitive DEPENDS_ON / REQUIRES targets (forward dependencies). */
export function dependencyClosure(graph: SemanticGraph, id: SemanticId): readonly SemanticId[] {
  const seen = new Set<SemanticId>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of outgoing(graph, cur)) {
      if (!DEP_RELATIONS.has(e.relation)) continue;
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Reverse impact: who depends on this id (transitive). */
export function impactClosure(graph: SemanticGraph, id: SemanticId): readonly SemanticId[] {
  const seen = new Set<SemanticId>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of incoming(graph, cur)) {
      if (!DEP_RELATIONS.has(e.relation)) continue;
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      stack.push(e.from);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export interface CycleReport {
  readonly cycles: number;
  readonly samples: readonly string[];
}

/** Detect cycles among DEPENDS_ON / REQUIRES. */
export function detectDependencyCycles(graph: SemanticGraph): CycleReport {
  const nodes = new Set(graph.nodes.map((n) => n.id));
  const adj = new Map<SemanticId, SemanticId[]>();
  for (const id of nodes) adj.set(id, []);
  for (const e of graph.edges) {
    if (!DEP_RELATIONS.has(e.relation)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<SemanticId, number>();
  for (const id of adj.keys()) color.set(id, WHITE);
  const samples: string[] = [];
  let cycles = 0;

  function dfs(u: SemanticId, path: SemanticId[]): void {
    color.set(u, GRAY);
    path.push(u);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        cycles += 1;
        const i = path.indexOf(v);
        const cycle = [...path.slice(i), v].join(" → ");
        if (samples.length < 5) samples.push(cycle);
      } else if (c === WHITE) {
        dfs(v, path);
      }
    }
    path.pop();
    color.set(u, BLACK);
  }

  for (const id of [...adj.keys()].sort((a, b) => a.localeCompare(b))) {
    if (color.get(id) === WHITE) dfs(id, []);
  }
  return { cycles, samples };
}

/**
 * Deterministic topological order for DEPENDS_ON/REQUIRES.
 * Dependencies first (A before B if B DEPENDS_ON A).
 * Tie-break: lexicographic SemanticId.
 */
export function topologicalDependencyOrder(graph: SemanticGraph, seed?: SemanticId): readonly SemanticId[] {
  const relevant = new Set<SemanticId>();
  if (seed) {
    relevant.add(seed);
    for (const d of dependencyClosure(graph, seed)) relevant.add(d);
    // include seed's reverse? only forward closure + seed
  } else {
    for (const n of graph.nodes) relevant.add(n.id);
  }

  const indeg = new Map<SemanticId, number>();
  const adj = new Map<SemanticId, SemanticId[]>();
  for (const id of relevant) {
    indeg.set(id, 0);
    adj.set(id, []);
  }
  for (const e of graph.edges) {
    if (!DEP_RELATIONS.has(e.relation)) continue;
    if (!relevant.has(e.from) || !relevant.has(e.to)) continue;
    // edge from → to means from depends on to, so to must come before from
    adj.get(e.to)!.push(e.from);
    indeg.set(e.from, (indeg.get(e.from) ?? 0) + 1);
  }

  const ready = [...relevant].filter((id) => (indeg.get(id) ?? 0) === 0).sort((a, b) => a.localeCompare(b));
  const order: SemanticId[] = [];
  while (ready.length) {
    const u = ready.shift()!;
    order.push(u);
    const nexts = (adj.get(u) ?? []).slice().sort((a, b) => a.localeCompare(b));
    for (const v of nexts) {
      const d = (indeg.get(v) ?? 0) - 1;
      indeg.set(v, d);
      if (d === 0) {
        ready.push(v);
        ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  return order;
}

export function conflictingOwners(graph: SemanticGraph): readonly { id: SemanticId; owners: SemanticId[] }[] {
  const owners = new Map<SemanticId, Set<SemanticId>>();
  for (const e of graph.edges) {
    if (e.relation !== "OWNS") continue;
    if (!owners.has(e.to)) owners.set(e.to, new Set());
    owners.get(e.to)!.add(e.from);
  }
  const conflicts: { id: SemanticId; owners: SemanticId[] }[] = [];
  for (const [id, set] of owners) {
    if (set.size > 1) {
      conflicts.push({ id, owners: [...set].sort((a, b) => a.localeCompare(b)) });
    }
  }
  return conflicts.sort((a, b) => a.id.localeCompare(b.id));
}
