/**
 * Factory Completion Report Generator (owner, 2026-08-07, Software
 * Factory Step 10.5, Phase 14). Writes the real, live-computed report to
 * registry/factory-completion-report.json. Reuses buildFactoryCompletionReport()
 * from factoryCompletionRuntime.ts — the SAME computation the live API
 * route uses — never a second, divergent calculation.
 *
 * Run: npm run factory-completion:build
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { buildFactoryCompletionReport } from "../app/api/admin/ide/_lib/factoryCompletionRuntime";

const OUT = join(__dirname, "..", "registry", "factory-completion-report.json");

function main() {
  const report = buildFactoryCompletionReport();
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n", "utf-8");
  console.log(`Factory Completion Report เขียนเสร็จ: ${OUT}`);
  console.log(`  Total systems: ${report.totalSystems}`);
  console.log(`  By status: ${JSON.stringify(report.byStatus)}`);
  console.log(`  Critical blockers: ${report.criticalBlockers.length} — ${report.criticalBlockers.join("; ")}`);
}
main();
