/**
 * หน้าที่: THE INTENT COMPILER — the ONE, deterministic step between the
 * Owner and the Work Graph. Owner's own diagram: "Owner -> Intent Compiler
 * -> Work Graph -> Capability Router -> Processing Fabric -> ... -> Work
 * Graph" (loops). NO AI runs here — the Owner directive is explicit that
 * AI appears ONLY in the Processing Resource slot; compiling an Objective
 * into a real, bounded work scope is pure, deterministic filtering against
 * the ALREADY-DERIVED Work Graph (`control/work-graph/`), never a
 * judgement call an LLM makes.
 *
 * An `Objective` is intentionally small: a human-facing `description`
 * (Presentation layer only — never read by a Processing Resource, never
 * fed into a Work Packet) plus real, structural filters (`target_prefix`,
 * `kinds`) that name which real, already-derived work items apply. This
 * file does not invent work, does not scan the filesystem, and does not
 * know what a capability IS beyond what the Work Graph already computed —
 * it only selects a slice of it.
 *
 * Input: `Objective`, an already-derived `WorkGraph`.
 * Output: `Objective`, `CompiledIntent`, `compileIntent`.
 * Dependency ที่อนุญาต: ../work-graph/types.ts (types only).
 * สิ่งที่ห้ามแตะ: never call an AI/agent from this file. Never let
 * `compileIntent` read the filesystem or the census itself — it takes an
 * already-derived `WorkGraph` and filters it, nothing more.
 */

import type { WorkGraph, WorkKind } from "../work-graph/types";

export interface Objective {
  /** Human-facing only — Presentation/Owner Interface layer. Never reaches a Work Packet or a Processing Resource. */
  description: string;
  /** Real structural filter: only work items whose `target` starts with this prefix are in scope. Omit for "everything". */
  target_prefix?: string;
  /** Real structural filter: only these `WorkKind`s are in scope. Omit for "every kind". */
  kinds?: readonly WorkKind[];
}

export interface CompiledIntent {
  objective: Objective;
  /** The real target paths this objective resolves to, against the Work Graph as it stood at compile time — feeds `LoopOptions.onlyTargets` directly. */
  matched_targets: readonly string[];
  matched_work_ids: readonly string[];
  compiled_at: string;
}

export function compileIntent(objective: Objective, graph: WorkGraph): CompiledIntent {
  const matches = graph.items.filter((item) => {
    if (objective.target_prefix && !item.target.startsWith(objective.target_prefix)) return false;
    if (objective.kinds && !objective.kinds.includes(item.kind)) return false;
    return true;
  });
  return {
    objective,
    matched_targets: [...new Set(matches.map((i) => i.target))],
    matched_work_ids: matches.map((i) => i.work_id),
    compiled_at: new Date().toISOString(),
  };
}
