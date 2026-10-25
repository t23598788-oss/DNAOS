/**
 * Decision Registry loader (owner, 2026-08-06) — reads
 * registry/decisions.json, the real record of WHY this system was built
 * the way it is (not what it is). Data, not UI — same principle as
 * classification.ts/standards.ts.
 */
import { readFileSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";

export interface DecisionEntry {
  id: string;
  decision: string;
  reason: string;
  evidence: string;
  alternatives_rejected: string[];
  implemented_in: string[];
  date: string;
}
export interface DecisionsRegistry { policy: string; decisions: DecisionEntry[] }

let cached: DecisionsRegistry | null = null;

export function loadDecisionsRegistry(): DecisionsRegistry {
  if (cached) return cached;
  const raw = readFileSync(path.join(WORKSPACE_ROOT, "registry/decisions.json"), "utf-8");
  cached = JSON.parse(raw);
  return cached!;
}

export function listDecisions(): DecisionEntry[] {
  return loadDecisionsRegistry().decisions;
}

/** Real lookup only — returns undefined for an id that was never recorded,
 * never a fabricated "reason" for a decision that isn't actually here. */
export function getDecision(id: string): DecisionEntry | undefined {
  return listDecisions().find((d) => d.id === id);
}
