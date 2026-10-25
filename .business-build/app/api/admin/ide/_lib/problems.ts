/**
 * Problem Registry loader (owner, 2026-08-06) — reads
 * registry/problems.json, the real record of the problem each capability
 * exists to solve (Problem → Solution → Capability → Outcome), not a
 * feature list. Data, not UI — same principle as classification.ts/
 * standards.ts/decisions.ts.
 */
import { readFileSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";

export interface ProblemEntry {
  id: string;
  problem: string;
  solution: string;
  capability: string[];
  outcome: string;
  date: string;
}
export interface ProblemsRegistry { policy: string; problems: ProblemEntry[] }

let cached: ProblemsRegistry | null = null;

export function loadProblemsRegistry(): ProblemsRegistry {
  if (cached) return cached;
  const raw = readFileSync(path.join(WORKSPACE_ROOT, "registry/problems.json"), "utf-8");
  cached = JSON.parse(raw);
  return cached!;
}

export function listProblems(): ProblemEntry[] {
  return loadProblemsRegistry().problems;
}

/** Real lookup only — returns undefined for an id that was never recorded,
 * never a fabricated problem/outcome for one that isn't actually here. */
export function getProblem(id: string): ProblemEntry | undefined {
  return listProblems().find((p) => p.id === id);
}
