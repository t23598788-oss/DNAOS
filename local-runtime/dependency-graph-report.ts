// CLI entry point: npx tsx local-runtime/dependency-graph-report.ts
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { diffAgainstSeed } from "@/engines/workspace/dependencyDiscovery/diff";
import { fileURLToPath } from "url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const auto = JSON.parse(readFileSync(join(ROOT, "registry/auto-dependency-graph.json"), "utf-8"));

console.log(`=== Automatic Dependency Discovery Report (generated ${auto.generated_at}) ===\n`);
console.log(`Real edges discovered: ${auto.edges.length}`);
console.log(`Unknown (could not verify): ${auto.unknowns.length}\n`);

console.log("By scanner:");
for (const [scanner, counts] of Object.entries(auto.scanner_counts as Record<string, { edges: number; unknowns: number }>)) {
  console.log(`  ${scanner.padEnd(20)} edges=${counts.edges}  unknowns=${counts.unknowns}`);
}

console.log("\nUnknown dependencies (never guessed into an edge):");
for (const u of auto.unknowns.slice(0, 15)) {
  console.log(`  [${u.scanner}] ${u.resource_path} — ${u.reason}`);
}
if (auto.unknowns.length > 15) console.log(`  ...and ${auto.unknowns.length - 15} more`);

const diff = diffAgainstSeed();
console.log(`\n=== Diff vs hand-maintained seed (registry/infra-dependency-graph.json) ===`);
console.log(`matched: ${diff.matched}`);
console.log(`seed_only (not yet auto-discovered): ${diff.seed_only.length}`);
for (const e of diff.seed_only) console.log(`  - ${e.source} => ${e.target} (${e.kind})`);
console.log(`auto_only (newly discovered): ${diff.auto_only.length}`);

console.log(`\n=== Coverage ===`);
console.log(`known resources (module-registry.json): ${diff.coverage.known_resources}`);
console.log(`resources with >=1 discovered edge: ${diff.coverage.resources_with_edges}`);
console.log(`coverage ratio: ${(diff.coverage.coverage_ratio * 100).toFixed(1)}%`);
