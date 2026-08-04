// CLI entry point: npx tsx local-runtime/generate-dependency-graph.ts
import { generateDependencyGraph, writeDependencyGraph } from "@/engines/workspace/dependencyDiscovery/generate";

const report = generateDependencyGraph();
const path = writeDependencyGraph(report);
console.log(`wrote ${report.edges.length} edges, ${report.unknowns.length} unknowns to ${path}`);
for (const [scanner, counts] of Object.entries(report.scanner_counts)) {
  console.log(`  ${scanner}: ${counts.edges} edges, ${counts.unknowns} unknowns`);
}
