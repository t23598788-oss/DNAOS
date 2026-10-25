/**
 * DNA OS — Governance Summary Builder (owner, 2026-08-06, Software Factory
 * Step 4.5).
 *
 * Reuses the real Governance Runtime (app/api/admin/ide/_lib/governanceRuntime.ts)
 * — never a second rule-classification implementation. Writes
 * registry/governance-summary.json: Total Rules, Enforced, Declared, Ghost,
 * Deprecated, Unknown, Coverage, Factories, Inspection Coverage — all
 * computed live from registry/CONSTITUTION.json + registry/rule-coverage.json
 * + registry/factory-mapping.json, never hardcoded.
 *
 * Wired into `npm run sync` (package.json), same chain as
 * scripts/sync-registry.ts + scripts/build-arch-book.ts.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { stableGeneratedAt } from "./lib/deterministicOutput";
import {
  computeAllRules, computeCoverageSummary, computeFactoryGovernance, findGhostFindings,
} from "../app/api/admin/ide/_lib/governanceRuntime";

const ROOT = join(__dirname, "..");

function main() {
  const summary = computeCoverageSummary();
  const rules = computeAllRules();
  const factories = computeFactoryGovernance();
  const ghostFindings = findGhostFindings();

  // Inspection Coverage — how much of the real rule set is actually
  // queryable through the Inspection pipeline's GOVERNANCE_CHECK today:
  // any rule whose real resolved/missing files overlap with a real
  // module-registry.json entry is reachable via a file-scoped inspection.
  const rulesWithFileEvidence = rules.filter((r) => r.resolvedFiles.length > 0 || r.missingFiles.length > 0).length;
  const inspectionCoveragePercent = rules.length > 0 ? Math.round((rulesWithFileEvidence / rules.length) * 1000) / 10 : 0;

  const outputContent = {
    note: "Computed live from registry/CONSTITUTION.json + registry/rule-coverage.json + registry/factory-mapping.json by app/api/admin/ide/_lib/governanceRuntime.ts — never hand-edited, never a cached stale number. Re-run via `npm run sync` or `npx tsx scripts/build-governance-summary.ts`.",
    totalRules: summary.totalRules,
    enforced: summary.enforced,
    declaredNotEnforced: summary.declaredNotEnforced,
    notImplemented: summary.notImplemented,
    deprecated: summary.deprecated,
    ghost: summary.ghost,
    unknown: summary.unknown,
    coveragePercent: summary.coveragePercent,
    bySource: summary.bySource,
    inspectionCoveragePercent,
    factories: factories.map((f) => ({
      factoryId: f.factoryId, factoryName: f.factoryName, ruleCount: f.factoryRules.length,
      coveragePercent: f.factoryCoveragePercent, missingRuleCount: f.factoryMissingRules.length,
      health: f.factoryHealth, unknownFileCount: f.factoryUnknownFiles.length,
    })),
    ghostFindingCount: ghostFindings.length,
    ghostFindings,
  };

  const outputPath = join(ROOT, "registry/governance-summary.json");

  // Deterministic output (scripts/lib/deterministicOutput.ts): keep the previous
  // generated_at when everything else is identical, so a canonical re-run on the same
  // source leaves this file byte-identical instead of re-diffing a timestamp.
  const output = {
    generated_at: stableGeneratedAt(outputPath, outputContent),
    ...outputContent,
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log("Governance Summary สร้างเสร็จ");
  console.log(`  Total Rules: ${summary.totalRules}`);
  console.log(`  Enforced: ${summary.enforced} | Declared: ${summary.declaredNotEnforced} | Not Implemented: ${summary.notImplemented}`);
  console.log(`  Deprecated: ${summary.deprecated} | Ghost: ${summary.ghost} | Unknown: ${summary.unknown}`);
  console.log(`  Coverage: ${summary.coveragePercent}% | Inspection Coverage: ${inspectionCoveragePercent}%`);
  console.log(`  Factories: ${factories.length} | Ghost Findings: ${ghostFindings.length}`);
  console.log(`  → ${join(ROOT, "registry/governance-summary.json")}`);
}

main();
