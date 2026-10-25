import { capabilityRegistryAccess } from "./capabilityRegistryAccess";
import type { ValidationIssue, ValidationResult } from "./types";

// Composer Validator (Phase 7.5) — checks a resolved capability set against
// the Registry only. Never executes anything; every check here is a pure
// lookup or graph traversal.
export function validateComposition(resolvedIds: string[], dependencyGraph: Record<string, string[]>): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Missing Capability — requested/resolved id not in the Registry at all.
  for (const id of resolvedIds) {
    if (!capabilityRegistryAccess.exists(id)) {
      issues.push({ type: "MissingCapability", capabilityId: id, message: `"${id}" is not registered in registry/capability-registry.json` });
    }
  }

  // Duplicate Capability — same id appears more than once in the resolved set.
  const seen = new Set<string>();
  for (const id of resolvedIds) {
    if (seen.has(id)) {
      issues.push({ type: "DuplicateCapability", capabilityId: id, message: `"${id}" appears more than once in the composition` });
    }
    seen.add(id);
  }

  // Missing Dependency — a dependency edge points outside the resolved set.
  const resolvedSet = new Set(resolvedIds);
  for (const id of resolvedIds) {
    for (const dep of dependencyGraph[id] ?? []) {
      if (!resolvedSet.has(dep)) {
        issues.push({ type: "MissingDependency", capabilityId: id, message: `"${id}" depends on "${dep}", which is not included in this composition` });
      }
    }
  }

  // Circular Dependency — DFS cycle detection on the resolved subgraph.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  resolvedIds.forEach((id) => (color[id] = WHITE));
  function dfs(node: string, stack: string[]) {
    color[node] = GRAY;
    stack.push(node);
    for (const next of dependencyGraph[node] ?? []) {
      if (!(next in color)) continue;
      if (color[next] === GRAY) {
        const i = stack.indexOf(next);
        const cyclePath = stack.slice(i).concat(next).join(" -> ");
        issues.push({ type: "CircularDependency", capabilityId: node, message: `Circular dependency: ${cyclePath}` });
      } else if (color[next] === WHITE) {
        dfs(next, stack);
      }
    }
    stack.pop();
    color[node] = BLACK;
  }
  for (const id of resolvedIds) if (color[id] === WHITE) dfs(id, []);

  // Version Conflict — structurally not checkable with the current request
  // shape (CompositionRequest carries no per-capability version pin, only
  // an id) — every id already resolves to exactly one real version in the
  // Registry, so no conflict can arise today. Not fabricating a check that
  // has nothing real to validate against.

  // Invalid Contract — a registered capability whose Input/Output contract
  // extraction was inconclusive (Phase 7.3's static analysis limit, not a
  // real code defect).
  for (const id of resolvedIds) {
    const entry = capabilityRegistryAccess.get(id);
    if (entry && (entry.OutputContract === "inferred" || entry.InputContract === "")) {
      issues.push({ type: "InvalidContract", capabilityId: id, message: `"${id}"'s contract could not be fully extracted by static analysis — verify manually before relying on it` });
    }
  }

  return { valid: issues.length === 0, issues };
}