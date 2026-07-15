import { capabilityRegistryAccess } from "./capabilityRegistryAccess";
import { validateComposition } from "./composerValidator";
import type { CompositionRequest, CompositionPlan } from "./types";

// Capability Composer (Phase 7.5) — planning only. Resolves requested
// CapabilityIds against the Registry, expands transitive dependencies,
// topologically orders them, validates, and returns an immutable
// CompositionPlan. It never imports anything that could execute a
// Capability — only reads registry/capability-registry.json via
// capabilityRegistryAccess.

function expandTransitiveDependencies(requestedIds: string[]): Set<string> {
  const resolved = new Set<string>();
  const stack = [...requestedIds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (resolved.has(id)) continue;
    resolved.add(id);
    const entry = capabilityRegistryAccess.get(id);
    for (const dep of entry?.Dependencies ?? []) {
      if (!resolved.has(dep)) stack.push(dep);
    }
  }
  return resolved;
}

function buildDependencyGraph(resolvedIds: string[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const id of resolvedIds) {
    graph[id] = capabilityRegistryAccess.get(id)?.Dependencies ?? [];
  }
  return graph;
}

// Topological sort (dependencies first). Falls back to insertion order for
// any node the validator will separately flag as circular — sorting must
// never throw, a broken composition should show up in ValidationResult, not
// crash the planner.
function topologicalOrder(resolvedIds: string[], graph: Record<string, string[]>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(id: string) {
    if (visited.has(id) || visiting.has(id)) return; // visiting.has -> cycle, let validator report it
    visiting.add(id);
    for (const dep of graph[id] ?? []) {
      if (resolvedIds.includes(dep)) visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  }

  for (const id of resolvedIds) visit(id);
  return order;
}

export const capabilityComposer = {
  resolve(request: CompositionRequest): CompositionPlan {
    const resolvedSet = expandTransitiveDependencies(request.requestedCapabilityIds);
    const capabilityIds = [...resolvedSet];
    const dependencyGraph = buildDependencyGraph(capabilityIds);
    const executionOrder = topologicalOrder(capabilityIds, dependencyGraph);
    const validationResult = validateComposition(capabilityIds, dependencyGraph);

    const plan: CompositionPlan = {
      applicationId: request.applicationId,
      workspaceId: request.workspaceId,
      requestedCapabilityIds: request.requestedCapabilityIds,
      capabilityIds,
      dependencyGraph,
      executionOrder,
      validationResult,
      metadata: {
        generatedAt: new Date().toISOString(),
        registryVersion: capabilityRegistryAccess.version,
        registryChecksum: capabilityRegistryAccess.checksum,
      },
    };

    return deepFreeze(plan);
  },
};

// Object.freeze is shallow — a frozen CompositionPlan whose .capabilityIds
// array can still be .push()'d isn't actually immutable. Freezing every
// nested array/object so "immutable" holds at every level a caller could
// reach, not just the top one.
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as object).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}