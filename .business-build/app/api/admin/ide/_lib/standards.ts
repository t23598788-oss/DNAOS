/**
 * External Standards Registry loader (owner, 2026-08-05) — reads
 * registry/standards.json, the real catalog of external specifications a
 * check/warning can cite as its source. citeStandard() is the guardrail:
 * it only ever returns a citation for an id that's ACTUALLY declared in
 * standards.json — asking for an unregistered id returns null rather than
 * fabricating a plausible-looking source, the same evidence-based
 * discipline as classification.ts.
 */
import { readFileSync } from "fs";
import path from "path";
import { WORKSPACE_ROOT } from "./fsSecurity";

export interface StandardEntry {
  type: string;
  version?: string;
  source: string;
  rules: string[];
}
export interface StandardsRegistry { policy: string; standards: Record<string, StandardEntry> }
export interface StandardCitation { id: string; type: string; version: string | null; source: string }

let cached: StandardsRegistry | null = null;

export function loadStandardsRegistry(): StandardsRegistry {
  if (cached) return cached;
  const raw = readFileSync(path.join(WORKSPACE_ROOT, "registry/standards.json"), "utf-8");
  cached = JSON.parse(raw);
  return cached!;
}

export function listStandards(): (StandardCitation & { rules: string[] })[] {
  const registry = loadStandardsRegistry();
  return Object.entries(registry.standards).map(([id, s]) => ({
    id, type: s.type, version: s.version ?? null, source: s.source, rules: s.rules,
  }));
}

/** Returns a real citation only if `id` is actually declared in
 * registry/standards.json — never fabricates one for an unknown id. */
export function citeStandard(id: string): StandardCitation | null {
  const registry = loadStandardsRegistry();
  const entry = registry.standards[id];
  if (!entry) return null;
  return { id, type: entry.type, version: entry.version ?? null, source: entry.source };
}
