/**
 * หน้าที่: the PRODUCTION event caller. Reads the real Live Census, derives real
 * dependency events from it, and runs them against the real waiting store
 * through the existing index and evaluator.
 *
 * This is the invocation the Owner asked for: not a test, a real run against
 * real system state. It observes nothing itself and creates nothing — the census
 * is derived by `software/live-census`, the rows come from `./store.ts`, the
 * verdicts come from `./evaluate.ts`.
 *
 * Usage:
 *   npx tsx control/work-continuation/cli.ts --events     # what the system currently justifies
 *   npx tsx control/work-continuation/cli.ts --waiting    # rows currently waiting
 *   npx tsx control/work-continuation/cli.ts --run        # events -> index -> evaluator -> decisions
 *
 * Dependency ที่อนุญาต: ./contract.ts, ../../software/live-census/observe.ts.
 * สิ่งที่ห้ามแตะ: never dispatch from here. This prints decisions;
 * `control/scheduler/` owns execution and keeps owning it.
 */

import { deriveEvents, decideResumes, currentWaiting, buildIndex, affectedWorkIds } from "./contract";
import { observeCensus } from "../../software/live-census/observe";

function main(): void {
  const argv = process.argv.slice(2);
  const census = observeCensus();
  const events = deriveEvents(census);

  if (argv.includes("--events")) {
    const byNs: Record<string, number> = {};
    for (const e of events) byNs[e.key.split(":")[0]] = (byNs[e.key.split(":")[0]] ?? 0) + 1;
    console.log(`derived ${events.length} dependency events from the real census (head=${census.head_commit})`);
    for (const [ns, n] of Object.entries(byNs).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${ns}:`);
    console.log("\nsample:");
    for (const e of events.slice(0, 6)) console.log(`  ${e.key.padEnd(52)} value=${String(e.value).padEnd(18)} src=${e.source}`);
    return;
  }

  const rows = currentWaiting();
  if (argv.includes("--waiting")) {
    console.log(`waiting rows: ${rows.length}`);
    for (const r of rows) console.log(`  ${r.work_id.padEnd(28)} ${r.status.padEnd(22)} ${r.blocked_on.length} key(s)  cond=${r.resume_condition}`);
    return;
  }

  // --run (default)
  const index = buildIndex(rows, census.generated_at);
  const touched = new Set(events.flatMap((e) => affectedWorkIds(index, e)));
  const decisions = decideResumes(rows, events, () => null, () => null, census.generated_at);
  console.log(`census head        ${census.head_commit}`);
  console.log(`events derived     ${events.length}`);
  console.log(`waiting rows       ${rows.length}  (indexed ${index.indexed_work})`);
  console.log(`work items touched ${touched.size}   <- only these were evaluated, never the whole population`);
  console.log(`decisions          ${decisions.length}`);
  const byVerdict: Record<string, number> = {};
  for (const d of decisions) byVerdict[d.evaluation.verdict] = (byVerdict[d.evaluation.verdict] ?? 0) + 1;
  for (const [v, n] of Object.entries(byVerdict)) console.log(`  ${String(n).padStart(4)}  ${v}`);
  for (const d of decisions.filter((x) => x.evaluation.verdict === "RESUME_ELIGIBLE")) {
    console.log(`\nRESUME_ELIGIBLE ${d.work_id}`);
    console.log(`  next_action  ${d.next_action}`);
    console.log(`  context_ref  ${d.resolved_work_context_ref}`);
    console.log(`  triggered_by ${d.triggered_by.key}  (${d.triggered_by.evidence_ref})`);
  }
}

main();
