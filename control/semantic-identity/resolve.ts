/**
 * Read-only semantic resolution API.
 * Exact SemanticId match only — no fuzzy / AI matching.
 */

import { canonicalizeSemanticId } from "./id";
import {
  conflictingOwners,
  dependencyClosure,
  detectDependencyCycles,
  impactClosure,
  incoming,
  outgoing,
  topologicalDependencyOrder,
} from "./graph";
import type {
  SemanticDoctorReport,
  SemanticEdge,
  SemanticGraph,
  SemanticId,
  SemanticLifecycleState,
  SemanticNode,
} from "./types";

export type ResolveStatus =
  | "IDENTITY_MATCHED"
  | "UNRESOLVED";

export interface SemanticResolveResult {
  readonly status: ResolveStatus;
  readonly id: SemanticId | null;
  readonly kind: string | null;
  readonly owner: SemanticId | null;
  readonly owner_title: string | null;
  readonly current_implementation: SemanticNode["implementation"];
  readonly relations: readonly SemanticEdge[];
  readonly dependency_order: readonly SemanticId[];
  readonly dependencies: readonly SemanticId[];
  readonly impact: readonly SemanticId[];
  readonly tests: readonly SemanticId[];
  readonly evidence: readonly SemanticId[];
  readonly current_state: SemanticLifecycleState | "UNRESOLVED";
  readonly source_revision: string | null;
  readonly semantic_key: string | null;
  readonly title: string | null;
}

export function resolveSemanticId(graph: SemanticGraph, rawId: string): SemanticResolveResult {
  const id = canonicalizeSemanticId(rawId);
  if (!id) {
    return unresolved(null);
  }
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) {
    return unresolved(id);
  }
  const ownerNode = node.ownerRepository
    ? graph.nodes.find((n) => n.id === node.ownerRepository)
    : undefined;
  const rel = [...outgoing(graph, id), ...incoming(graph, id)];
  const tests = outgoing(graph, id, "VERIFIED_BY").map((e) => e.to);
  const evidence = outgoing(graph, id, "PROVEN_BY").map((e) => e.to);
  return {
    status: "IDENTITY_MATCHED",
    id: node.id,
    kind: node.kind,
    owner: node.ownerRepository,
    owner_title: ownerNode?.title ?? null,
    current_implementation: node.implementation,
    relations: rel,
    dependency_order: topologicalDependencyOrder(graph, id),
    dependencies: dependencyClosure(graph, id),
    impact: impactClosure(graph, id),
    tests,
    evidence,
    current_state: node.state,
    source_revision: graph.source_revision,
    semantic_key: node.semantic_key,
    title: node.title,
  };
}

function unresolved(id: SemanticId | null): SemanticResolveResult {
  return {
    status: "UNRESOLVED",
    id,
    kind: null,
    owner: null,
    owner_title: null,
    current_implementation: null,
    relations: [],
    dependency_order: [],
    dependencies: [],
    impact: [],
    tests: [],
    evidence: [],
    current_state: "UNRESOLVED",
    source_revision: null,
    semantic_key: null,
    title: null,
  };
}

export function doctorSemanticGraph(graph: SemanticGraph): SemanticDoctorReport {
  const by_state: Record<string, number> = {};
  for (const n of graph.nodes) {
    by_state[n.state] = (by_state[n.state] ?? 0) + 1;
  }
  const idCounts = new Map<string, number>();
  for (const n of graph.nodes) {
    idCounts.set(n.id, (idCounts.get(n.id) ?? 0) + 1);
  }
  let duplicate_semantic_ids = 0;
  for (const c of idCounts.values()) {
    if (c > 1) duplicate_semantic_ids += 1;
  }
  const cycles = detectDependencyCycles(graph);
  const conflicts = conflictingOwners(graph);
  const unresolved_references = graph.nodes
    .filter((n) => n.state === "AWAITING_RELATION" && n.implementation === null)
    .map((n) => n.id)
    .sort((a, b) => a.localeCompare(b));

  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    by_state,
    awaiting_relation: by_state["AWAITING_RELATION"] ?? 0,
    duplicate_semantic_ids,
    dependency_cycles: cycles.cycles,
    conflicting_authority: conflicts.length,
    unresolved_references,
    cycle_samples: cycles.samples,
    source_revision: graph.source_revision,
  };
}
