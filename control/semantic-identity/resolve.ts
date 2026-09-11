/**
 * Read-only semantic resolution API.
 * Exact SemanticId match only — no fuzzy / AI matching.
 *
 * Doctor consumes graph + discovery diagnostics (not sanitized nodes alone).
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
import { emptyDiscoveryDiagnostics } from "./discover";
import type {
  SemanticDiscoveryDiagnostics,
  SemanticDiscoveryResult,
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

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * Doctor from full discovery result (preferred).
 */
export function doctorDiscovery(result: SemanticDiscoveryResult): SemanticDoctorReport {
  return doctorSemanticGraph(result.graph, result.diagnostics);
}

/**
 * Doctor from graph + optional discovery diagnostics.
 * Without diagnostics, duplicate declarations already deduped into the graph
 * cannot be recovered — callers should pass discovery diagnostics.
 */
export function doctorSemanticGraph(
  graph: SemanticGraph,
  diagnostics: SemanticDiscoveryDiagnostics = emptyDiscoveryDiagnostics(),
): SemanticDoctorReport {
  const by_state: Record<string, number> = {};
  for (const n of graph.nodes) {
    by_state[n.state] = (by_state[n.state] ?? 0) + 1;
  }

  // Graph-level duplicate nodes (should be rare; discovery already dedupes map).
  const idCounts = new Map<string, number>();
  for (const n of graph.nodes) {
    idCounts.set(n.id, (idCounts.get(n.id) ?? 0) + 1);
  }
  const graphDupes: string[] = [];
  for (const [id, c] of idCounts) {
    if (c > 1) graphDupes.push(id);
  }

  const duplicate_ids = uniqueSorted([...diagnostics.duplicate_ids, ...graphDupes]);
  const cycles = detectDependencyCycles(graph);
  const conflicts = conflictingOwners(graph);

  // Placeholders + discovery missing endpoints.
  const awaitingIds = graph.nodes
    .filter((n) => n.state === "AWAITING_RELATION" && n.implementation === null)
    .map((n) => n.id);

  const missing_sources = uniqueSorted(diagnostics.missing_sources);
  const missing_targets = uniqueSorted(diagnostics.missing_targets);
  const unresolved_references = uniqueSorted([
    ...diagnostics.unresolved_references,
    ...awaitingIds,
    ...missing_sources,
    ...missing_targets,
  ]);

  const report: SemanticDoctorReport = {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    by_state,
    awaiting_relation: by_state["AWAITING_RELATION"] ?? 0,
    duplicate_semantic_ids: duplicate_ids.length,
    duplicate_ids,
    invalid_ids: diagnostics.invalid_ids,
    missing_sources,
    missing_targets,
    unresolved_references,
    invalid_implementations: diagnostics.invalid_implementations,
    dependency_cycles: cycles.cycles,
    conflicting_authority: conflicts.length,
    cycle_samples: cycles.samples,
    source_revision: graph.source_revision,
    healthy: false,
  };

  return { ...report, healthy: doctorIsHealthy(report) };
}

export function doctorIsHealthy(report: SemanticDoctorReport): boolean {
  return (
    report.duplicate_semantic_ids === 0 &&
    report.invalid_ids.length === 0 &&
    report.missing_sources.length === 0 &&
    report.missing_targets.length === 0 &&
    report.unresolved_references.length === 0 &&
    report.invalid_implementations.length === 0 &&
    report.dependency_cycles === 0 &&
    report.conflicting_authority === 0
  );
}

/** Nonzero when any graph integrity invariant is violated. */
export function doctorExitCode(report: SemanticDoctorReport): number {
  return doctorIsHealthy(report) ? 0 : 1;
}
