/**
 * Global Factory Report Generator (owner, 2026-08-08, Software Factory
 * Step 11, Phase 3/4/5). Writes the real, live-computed reports to
 * registry/runtime-dependency-report.json, registry/factory-runtime-report.json,
 * and registry/global-factory-report.json. Reuses computeRuntimeDependencyGraph()/
 * computeFactoryRuntimeReport()/computeGlobalFactoryReport() from
 * globalFactoryRuntime.ts — the SAME computation the live API route uses,
 * never a second, divergent calculation.
 *
 * Run: npm run global-factory:build
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { computeRuntimeDependencyGraph, computeFactoryRuntimeReport, computeGlobalFactoryReport } from "../app/api/admin/ide/_lib/globalFactoryRuntime";

const ROOT = join(__dirname, "..");

function main() {
  const runtimeDependency = computeRuntimeDependencyGraph();
  const factoryRuntime = computeFactoryRuntimeReport();
  const global = computeGlobalFactoryReport();

  writeFileSync(join(ROOT, "registry/runtime-dependency-report.json"), JSON.stringify(runtimeDependency, null, 2) + "\n", "utf-8");
  writeFileSync(join(ROOT, "registry/factory-runtime-report.json"), JSON.stringify(factoryRuntime, null, 2) + "\n", "utf-8");
  writeFileSync(join(ROOT, "registry/global-factory-report.json"), JSON.stringify(global, null, 2) + "\n", "utf-8");

  console.log("Global Factory Reports เขียนเสร็จ:");
  console.log(`  registry/runtime-dependency-report.json — ${runtimeDependency.nodes.length} nodes, ${runtimeDependency.edges.length} edges`);
  console.log(`  registry/factory-runtime-report.json — ${factoryRuntime.reachedSubRuntimes.filter((r) => r.reached).length}/${factoryRuntime.reachedSubRuntimes.length} sub-Runtimes reached`);
  console.log(`  registry/global-factory-report.json — domains: ${JSON.stringify(Object.fromEntries(global.domains.map((d) => [d.domain, d.status])))}`);
}
main();
