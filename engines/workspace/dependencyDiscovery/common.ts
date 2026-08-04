import { join } from "path";
import type { DependencyEdge, UnknownDependency, DependencyEvidenceItem } from "@/core/shared/types";

export const ROOT = join(__dirname, "../../..");

// Below this, an edge is not confident enough to assert — goes to unknowns
// instead. Chosen deliberately conservative: a single exact string/path
// match (e.g. a real import statement, a real plist ProgramArguments entry)
// scores 0.9-1.0; a fuzzy/heuristic match (e.g. a table name appearing in a
// grep with no surrounding context check) scores below this and is excluded.
export const CONFIDENCE_THRESHOLD = 0.6;

export function edge(
  source: string, target: string, kind: DependencyEdge["kind"],
  evidence: DependencyEvidenceItem[], confidence: number
): DependencyEdge | null {
  if (confidence < CONFIDENCE_THRESHOLD) return null;
  return { source, target, kind, source_generated: "auto-discovery", evidence, confidence };
}

export function unknown(resourcePath: string, scanner: UnknownDependency["scanner"], reason: string): UnknownDependency {
  return { resource_path: resourcePath, scanner, reason };
}
