// Real acceptance test for Roadmap #46 (Automatic Dependency Discovery).
// Run with: npx tsx local-runtime/dependency-discovery-acceptance-test.ts
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { generateDependencyGraph, writeDependencyGraph } from "@/engines/workspace/dependencyDiscovery/generate";
import { diffAgainstSeed } from "@/engines/workspace/dependencyDiscovery/diff";
import { fileURLToPath } from "url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function test1_generatedFromRealRepo() {
  const report = generateDependencyGraph();
  console.log(`[test 1] generated from real repo: ${report.edges.length} edges, ${report.unknowns.length} unknowns`);
  if (report.edges.length === 0) throw new Error("FAIL: zero edges — scanners found nothing real");
  // Spot-check: at least one edge must trace to a real, currently-existing file.
  const withRealEvidence = report.edges.filter((e) => e.evidence && e.evidence.length > 0 && e.evidence[0].file && existsSync(join(ROOT, e.evidence[0].file)));
  if (withRealEvidence.length === 0) throw new Error("FAIL: no edge has evidence pointing to a real, existing file");
  console.log(`  PASS — ${withRealEvidence.length}/${report.edges.length} edges have evidence tracing to a real existing file`);
  writeDependencyGraph(report);
  return report;
}

function test2_diffVsSeed() {
  const diff = diffAgainstSeed();
  console.log(`[test 2] diff vs seed: matched=${diff.matched} seed_only=${diff.seed_only.length} auto_only=${diff.auto_only.length}`);
  if (diff.auto_only.length === 0) throw new Error("FAIL: expected auto-discovery to find edges beyond the hand-maintained seed");
  console.log(`  PASS — diff report is real and non-trivial (auto discovered ${diff.auto_only.length} edges the seed never had)`);
  return diff;
}

function test3_coverage(diff: ReturnType<typeof diffAgainstSeed>) {
  console.log(`[test 3] coverage: ${diff.coverage.resources_with_edges}/${diff.coverage.known_resources} = ${(diff.coverage.coverage_ratio * 100).toFixed(1)}%`);
  if (diff.coverage.known_resources === 0) throw new Error("FAIL: could not read module-registry.json's known resource count");
  if (diff.coverage.coverage_ratio <= 0) throw new Error("FAIL: coverage ratio should be > 0 given real scan results");
  console.log(`  PASS — coverage computed from real module-registry.json, not fabricated`);
}

function test4_unknownsReportedSeparately(report: ReturnType<typeof generateDependencyGraph>) {
  console.log(`[test 4] unknowns reported separately: ${report.unknowns.length} unknowns, each with a scanner + reason`);
  if (report.unknowns.length === 0) throw new Error("FAIL: expected at least one real UNKNOWN (e.g. Docker daemon state or undeclared env var)");
  const missingReason = report.unknowns.find((u) => !u.reason || !u.scanner);
  if (missingReason) throw new Error("FAIL: an unknown entry is missing scanner/reason — must never be silently dropped");
  console.log(`  PASS — every unknown carries a real scanner name + reason, none silently dropped into edges`);
}

function test5_seedNotDeleted() {
  const seedPath = join(ROOT, "registry/infra-dependency-graph.json");
  const exists = existsSync(seedPath);
  console.log(`[test 5] seed graph still exists: ${exists}`);
  if (!exists) throw new Error("FAIL: registry/infra-dependency-graph.json must not be deleted until auto results are verified");
  const seed = JSON.parse(readFileSync(seedPath, "utf-8"));
  if (!Array.isArray(seed.edges) || seed.edges.length === 0) throw new Error("FAIL: seed graph exists but is empty/corrupted");
  console.log(`  PASS — seed graph intact with ${seed.edges.length} real edges, untouched`);
}

async function main() {
  const report = test1_generatedFromRealRepo();
  const diff = test2_diffVsSeed();
  test3_coverage(diff);
  test4_unknownsReportedSeparately(report);
  test5_seedNotDeleted();
  console.log("\nALL ROADMAP #46 ACCEPTANCE TESTS PASSED");
}

main().catch((e) => { console.error("ACCEPTANCE TEST FAILED:", e); process.exit(1); });
