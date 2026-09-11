/**
 * Runtime observation correlation.
 * Static discovery → IDENTIFIED/LINKED/RESOLVED/VERIFIED/CANONICAL.
 * Only RUNTIME/EVIDENCE observations may produce OBSERVED/PROVEN.
 */

import type { SemanticGraph, SemanticId, SemanticLifecycleState, SemanticObservation } from "./types";

export interface ObservationStore {
  readonly observations: SemanticObservation[];
}

export function createObservationStore(): ObservationStore {
  return { observations: [] };
}

export function recordObservation(
  store: ObservationStore,
  obs: SemanticObservation,
): void {
  store.observations.push(obs);
}

/**
 * Apply observations onto a copy of the graph.
 * Never promotes STATIC facts to PROVEN.
 * AUTHORITY may set CANONICAL.
 */
export function applyObservations(
  graph: SemanticGraph,
  store: ObservationStore,
): SemanticGraph {
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const obs of store.observations) {
    const node = byId.get(obs.semantic_id);
    if (!node) continue;
    let next: SemanticLifecycleState = node.state;
    if (obs.kind === "RUNTIME") {
      if (next !== "PROVEN" && next !== "CANONICAL") next = "OBSERVED";
      else if (next === "CANONICAL") next = "CANONICAL"; // keep; observation noted in store
    } else if (obs.kind === "EVIDENCE" || obs.kind === "TEST") {
      // TEST alone does not equal PROVEN — only EVIDENCE produces PROVEN
      if (obs.kind === "EVIDENCE") next = "PROVEN";
    } else if (obs.kind === "AUTHORITY") {
      next = "CANONICAL";
    } else if (obs.kind === "STATIC") {
      // no promotion to PROVEN
      if (next === "DISCOVERED") next = "IDENTIFIED";
    }
    byId.set(node.id, { ...node, state: next });
  }

  return {
    ...graph,
    nodes: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** Augment a runtime event with semantic type IDs (does not replace work/command ids). */
export function correlateRuntimeEvent(
  event: Record<string, unknown>,
  semantic: {
    capability_id?: SemanticId;
    policy_id?: SemanticId;
    adapter_id?: SemanticId;
    connection_id?: SemanticId;
    source_revision?: string | null;
  },
): Record<string, unknown> {
  return {
    ...event,
    ...(semantic.capability_id ? { capability_id: semantic.capability_id } : {}),
    ...(semantic.policy_id ? { policy_id: semantic.policy_id } : {}),
    ...(semantic.adapter_id ? { adapter_id: semantic.adapter_id } : {}),
    ...(semantic.connection_id ? { connection_id: semantic.connection_id } : {}),
    ...(semantic.source_revision != null
      ? { source_revision: semantic.source_revision }
      : {}),
  };
}
