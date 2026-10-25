import type { CompositionPlan } from "../composer/types";
import { validateExecutionPlan } from "./executionPlanValidator";
import type { ExecutionPlan } from "./types";

// Execution Planner (Phase 7.6) — CompositionPlan -> ExecutionPlan. Purely
// descriptive: groups capabilities into dependency-free stages (Stage 0 =
// no unresolved dependency, Stage N = depends only on Stage 0..N-1). Never
// creates an object, never calls a Capability, never touches a Runtime —
// the only inputs are a CompositionPlan's own already-resolved
// capabilityIds/dependencyGraph, both plain data.

function computeStages(capabilityIds: string[], dependencyGraph: Record<string, string[]>): string[][] {
  const stages: string[][] = [];
  const placed = new Set<string>();
  const remaining = new Set(capabilityIds);

  // Guard against a cycle slipping through (CompositionPlan's own validator
  // should already have caught it, but this must never infinite-loop even
  // if it somehow didn't) — cap iterations at the number of remaining nodes.
  let guard = capabilityIds.length + 1;

  while (remaining.size > 0 && guard-- > 0) {
    const stage = [...remaining]
      .filter((id) => (dependencyGraph[id] ?? []).every((dep) => placed.has(dep) || !remaining.has(dep)))
      .sort(); // deterministic ordering within a stage

    if (stage.length === 0) break; // cycle or unresolvable — stop, leave `remaining` for validation to report

    stage.forEach((id) => { placed.add(id); remaining.delete(id); });
    stages.push(stage);
  }

  return stages;
}

// Deterministic executionId derived from the composition's own identity —
// no randomness, so the same CompositionPlan always yields the same
// ExecutionId (matches the "Deterministic ordering" requirement).
function deterministicExecutionId(plan: CompositionPlan): string {
  const basis = `${plan.applicationId}:${plan.workspaceId}:${[...plan.capabilityIds].sort().join(",")}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i++) {
    hash = (hash * 31 + basis.charCodeAt(i)) | 0;
  }
  return `exec-${(hash >>> 0).toString(16)}`;
}

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

export const executionPlanner = {
  plan(compositionPlan: CompositionPlan): ExecutionPlan {
    const { capabilityIds, dependencyGraph } = compositionPlan;
    const executionStages = computeStages(capabilityIds, dependencyGraph);
    const orderedCapabilities = executionStages.flat();
    const dependencyLevels: Record<string, number> = {};
    executionStages.forEach((stage, i) => stage.forEach((id) => (dependencyLevels[id] = i)));

    const validationResult = validateExecutionPlan(capabilityIds, executionStages, dependencyGraph);

    const plan: ExecutionPlan = {
      executionId: deterministicExecutionId(compositionPlan),
      applicationId: compositionPlan.applicationId,
      workspaceId: compositionPlan.workspaceId,
      orderedCapabilities,
      executionStages,
      dependencyLevels,
      validationResult,
      metadata: {
        generatedAt: new Date().toISOString(),
        registryVersion: compositionPlan.metadata.registryVersion,
        registryChecksum: compositionPlan.metadata.registryChecksum,
        sourceCompositionValid: compositionPlan.validationResult.valid,
      },
    };

    return deepFreeze(plan);
  },
};