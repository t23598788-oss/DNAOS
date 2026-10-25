/**
 * Builds registry/code-classification.json — the persisted, inspectable
 * snapshot of the Semantic Code Classification Registry (owner,
 * 2026-08-05). The live API route (app/api/admin/ide/classification)
 * always classifies fresh via classifyFile() so the running IDE is never
 * stale; this snapshot exists so the classification of every real module
 * is diffable in git history and reviewable outside the running app, the
 * same convention registry/architecture-book.json already follows for
 * sync-registry.ts's module list.
 *
 * Run: npx tsx scripts/build-code-classification.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  classifyPath, loadLockedPathsFromConstitution, type ModuleRegistry,
} from "../app/api/admin/ide/_lib/classification";

const ROOT = join(__dirname, "..");

function main() {
  const registry: ModuleRegistry = JSON.parse(readFileSync(join(ROOT, "registry/module-registry.json"), "utf-8"));
  const lockedPaths = loadLockedPathsFromConstitution();

  const files: Record<string, { category: string; capability: string | null; riskLevel: string; evidence: string[]; requiredChecks: string[] }> = {};
  const counts: Record<string, number> = {};
  const riskCounts: Record<string, number> = {};
  const capabilityCounts: Record<string, number> = {};

  for (const relPath of Object.keys(registry.modules).sort()) {
    const result = classifyPath(relPath, registry, lockedPaths);
    files[relPath] = {
      category: result.category, capability: result.capability, riskLevel: result.riskLevel,
      evidence: result.evidence, requiredChecks: result.requiredChecks,
    };
    counts[result.category] = (counts[result.category] ?? 0) + 1;
    riskCounts[result.riskLevel] = (riskCounts[result.riskLevel] ?? 0) + 1;
    if (result.capability) capabilityCounts[result.capability] = (capabilityCounts[result.capability] ?? 0) + 1;
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    policy: "Evidence-based only — registry/module-registry.json + registry/CONSTITUTION.json. No per-file hardcoding; see app/api/admin/ide/_lib/classification.ts. Data, not UI — this file plus the live /api/admin/ide/classification route are the one classification source every consumer (IDE, AI, Documentation, Architecture, Search, Git, Runtime) should read, never re-derive independently.",
    category_counts: counts,
    risk_counts: riskCounts,
    capability_counts: capabilityCounts,
    files,
  };
  writeFileSync(join(ROOT, "registry/code-classification.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
  console.log(`Code Classification snapshot: ${Object.keys(files).length} files`);
  console.log("  by category:", counts);
  console.log("  by risk:", riskCounts);
}

main();
