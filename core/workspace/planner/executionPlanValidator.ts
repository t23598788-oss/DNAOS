import type { ExecutionValidationIssue, ExecutionValidationResult } from "./types";

// Execution Plan Validator (Phase 7.6) — pure checks over already-computed
// stage data. No graph computation happens here, only verification that
// the ExecutionPlanner's output is internally consistent.
//
// The "Frozen object" check is NOT part of this function: the plan can't be
// validated-then-embedded-then-frozen with a self-referential "am I frozen"
// answer inside itself (chicken-and-egg — it isn't frozen yet while this
// runs, since freezing happens after the validationResult is embedded).
// isPlanFrozen() below is the separate, standalone answer to that,
// callable by anyone after the fact.
export function validateExecutionPlan(
  capabilityIds: string[],
  executionStages: string[][],
  dependencyGraph: Record<string, string[]>
): ExecutionValidationResult {
  const issues: ExecutionValidationIssue[] = [];

  // Duplicate execution — a capability appearing in more than one stage.
  const stageCount: Record<string, number> = {};
  for (const stage of executionStages) {
    for (const id of stage) stageCount[id] = (stageCount[id] ?? 0) + 1;
  }
  for (const [id, count] of Object.entries(stageCount)) {
    if (count > 1) issues.push({ type: "DuplicateExecution", capabilityId: id, message: `"${id}" appears in ${count} stages — must appear in exactly one` });
  }

  // Duplicate stage — two stages with identical membership (would mean the
  // staging algorithm produced a redundant level).
  const stageSignatures = executionStages.map((s) => [...s].sort().join(","));
  const seenSignatures = new Set<string>();
  stageSignatures.forEach((sig, i) => {
    if (sig && seenSignatures.has(sig)) {
      issues.push({ type: "DuplicateStage", capabilityId: `stage-${i}`, message: `Stage ${i} duplicates an earlier stage's membership` });
    }
    seenSignatures.add(sig);
  });

  // Missing capability — every requested capabilityId must appear in exactly one stage.
  const staged = new Set(Object.keys(stageCount));
  for (const id of capabilityIds) {
    if (!staged.has(id)) issues.push({ type: "MissingCapability", capabilityId: id, message: `"${id}" was not placed into any execution stage` });
  }

  // Unresolved dependency / execution order correctness — every dependency
  // must be staged at a strictly earlier level than its dependent.
  const levelOf: Record<string, number> = {};
  executionStages.forEach((stage, i) => stage.forEach((id) => (levelOf[id] = i)));
  for (const id of capabilityIds) {
    for (const dep of dependencyGraph[id] ?? []) {
      if (!(dep in levelOf)) {
        issues.push({ type: "UnresolvedDependency", capabilityId: id, message: `"${id}" depends on "${dep}", which has no stage` });
      } else if (levelOf[dep] >= levelOf[id]) {
        issues.push({ type: "UnresolvedDependency", capabilityId: id, message: `"${id}" (stage ${levelOf[id]}) depends on "${dep}" (stage ${levelOf[dep]}) — dependency must be staged strictly earlier` });
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// Standalone, callable after the ExecutionPlanner freezes its output —
// verifies immutability holds at every nesting level, not just the top one.
export function isPlanFrozen(plan: unknown): boolean {
  if (plan === null || typeof plan !== "object") return true;
  if (!Object.isFrozen(plan)) return false;
  return Object.values(plan as object).every(isPlanFrozen);
}