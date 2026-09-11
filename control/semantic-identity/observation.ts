/**
 * Runtime observation correlation.
 * Static discovery → IDENTIFIED/LINKED/RESOLVED/VERIFIED/CANONICAL.
 * Only RUNTIME/EVIDENCE observations may produce OBSERVED/PROVEN.
 *
 * Ordinary observation must NEVER demote a stronger lifecycle state.
 */

import type { SemanticGraph, SemanticId, SemanticLifecycleState, SemanticObservation } from "./types";

export interface ObservationStore {
  readonly observations: SemanticObservation[];
}

/** Explicit rank — do NOT use string ordering. Waiting states are not advance ranks. */
const STATE_RANK: Readonly<Record<SemanticLifecycleState, number>> = {
  UNRESOLVED: 0,
  AWAITING_RELATION: 0,
  AWAITING_RUNTIME_OBSERVATION: 0,
  AWAITING_EVIDENCE: 0,
  DISCOVERED: 1,
  IDENTIFIED: 2,
  CLASSIFIED: 3,
  LINKED: 4,
  RESOLVED: 5,
  OBSERVED: 6,
  VERIFIED: 7,
  PROVEN: 8,
  CANONICAL: 9,
};

export function lifecycleRank(state: SemanticLifecycleState): number {
  return STATE_RANK[state] ?? 0;
}

/**
 * Monotonic advance: keep current if candidate is not strictly stronger.
 * Demotion requires a separate explicit invalidation event (not implemented here).
 */
export function advanceLifecycle(
  current: SemanticLifecycleState,
  candidate: SemanticLifecycleState,
): SemanticLifecycleState {
  return lifecycleRank(candidate) > lifecycleRank(current) ? candidate : current;
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
 * RUNTIME never demotes VERIFIED/PROVEN/CANONICAL.
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
    let candidate: SemanticLifecycleState = node.state;
    if (obs.kind === "RUNTIME") {
      candidate = "OBSERVED";
    } else if (obs.kind === "EVIDENCE") {
      candidate = "PROVEN";
    } else if (obs.kind === "TEST") {
      // TEST alone does not equal PROVEN or VERIFIED via observation API.
      candidate = node.state;
    } else if (obs.kind === "AUTHORITY") {
      candidate = "CANONICAL";
    } else if (obs.kind === "STATIC") {
      if (node.state === "DISCOVERED") candidate = "IDENTIFIED";
      else candidate = node.state;
    }
    const next = advanceLifecycle(node.state, candidate);
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
