/**
 * Real wiring of Roadmap #46 (Automatic Dependency Discovery) into Hardcode
 * Governance: enriches a hardcode-decision-engine.ts Classification with the
 * real blast radius of the file it was found in — so a MOVE_TO_CONFIG/
 * MOVE_TO_REGISTRY/MOVE_TO_DATABASE verdict can show how many real modules
 * would be affected before someone acts on it. Additive only — does not
 * change hardcode-decision-engine.ts's own classify() logic or verdicts.
 */
import type { Classification } from "./hardcode-decision-engine";
import { getDependents } from "@/engines/workspace/dependencyRegistry";

export interface ClassificationWithDependencyContext extends Classification {
  affectedModuleCount: number;
  affectedModules: string[];
}

export function withDependencyContext(c: Classification): ClassificationWithDependencyContext {
  const dependents = getDependents(c.file);
  return {
    ...c,
    affectedModuleCount: dependents.length,
    affectedModules: dependents.map((d) => d.source),
  };
}
