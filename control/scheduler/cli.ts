/**
 * หน้าที่: runs the canonical loop and prints the Owner-requested report.
 *
 * Usage:
 *   npx tsx control/scheduler/cli.ts --graph                     # derive + show the work graph only (now includes worker_class)
 *   npx tsx control/scheduler/cli.ts --run [--rounds N] [--concurrency N] [--only a,b,c] [--pool-size N] [--force-provider LOCAL|CLAUDE|CODEX|GEMINI]
 *   npx tsx control/scheduler/cli.ts --objective "text" [--target-prefix ai/] [--kinds IMPLEMENT,WIRE_OR_RETIRE] [--rounds N] [--concurrency N] [--pool-size N] [--force-provider ...]
 *
 * `--objective` is the ONE Owner-facing entry point closing the full loop:
 * Owner -> Intent Compiler (`../intent-compiler.ts`, pure/deterministic, no
 * AI) -> Work Graph -> Capability Router -> Processing Fabric -> Work
 * Packet -> Processing Resource -> Result Contract -> Evidence -> Registry/
 * State -> Work Graph, looping autonomously until nothing further is READY
 * — one command in, no further human input, no AI re-exploring the repo
 * (see `../work-packet.ts`). Everything below `--objective` in this file
 * is Presentation/Owner Interface only, invoked once at the end to report
 * what happened — never part of the production loop itself, which is pure
 * `runLoop`/`control/scheduler/coordinator.ts`.
 *
 * Every REASONING_INTEGRATION/REPAIR_AGENT/IMPLEMENTATION_AGENT/
 * DEPENDENCY_RESOLUTION_AGENT dispatch goes through the real Capability
 * Router (`../capability-router.ts`) against the real, discovered Provider
 * Pool (`../provider-pool.ts`) — there is no fixed `WorkKind -> ProviderKind`
 * mapping; the provider is chosen per dispatch from real availability,
 * historical latency, and historical success rate. `--pool-size` sets the
 * concurrency CAP per provider (default 1). `--force-provider` is a bounded
 * cost-control/testing escape hatch — it still goes through the same
 * router/availability checks, just restricted to one provider — never the
 * intended default behaviour.
 *
 * Dependency ที่อนุญาต: ./contract.ts, ../work-graph/contract.ts,
 * ../../software/live-census/observe.ts.
 */
import { runLoop, compileIntent } from "./contract";
import { deriveWorkGraph } from "../work-graph/contract";
import type { WorkKind } from "../work-graph/contract";
import { observeCensus } from "../../software/live-census/observe";
import { listWriteLocks } from "../work-coordination/contract";
import type { ProviderKind } from "./contract";

/** Blockers that are real and outside the repository — they must block only their own branch. */
const EXTERNAL_BLOCKERS = [
  { target: "connections/github", reason: "EXTERNAL: GITHUB_PAT_INFRASTRUCTURE not provided — cannot execute against real GitHub (Owner decision)" },
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string, dflt: number): number => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
  };
  const onlyIdx = argv.indexOf("--only");
  let only: readonly string[] | undefined = onlyIdx >= 0 && argv[onlyIdx + 1] ? argv[onlyIdx + 1].split(",") : undefined;
  const forceProviderIdx = argv.indexOf("--force-provider");
  const forceProviderRaw = forceProviderIdx >= 0 ? argv[forceProviderIdx + 1] : undefined;
  if (forceProviderRaw !== undefined && !["LOCAL", "CLAUDE", "CODEX", "GEMINI"].includes(forceProviderRaw)) {
    console.error(`--force-provider must be LOCAL, CLAUDE, CODEX, or GEMINI — got "${forceProviderRaw}"`);
    process.exitCode = 1;
    return;
  }
  const forceProvider = forceProviderRaw as ProviderKind | undefined;
  const poolSizePerProvider = flag("--pool-size", 1);

  const objectiveIdx = argv.indexOf("--objective");
  if (objectiveIdx >= 0) {
    const description = argv[objectiveIdx + 1] ?? "";
    const targetPrefixIdx = argv.indexOf("--target-prefix");
    const target_prefix = targetPrefixIdx >= 0 ? argv[targetPrefixIdx + 1] : undefined;
    const kindsIdx = argv.indexOf("--kinds");
    const kinds = kindsIdx >= 0 && argv[kindsIdx + 1] ? (argv[kindsIdx + 1].split(",") as WorkKind[]) : undefined;

    // INTENT COMPILER — pure, deterministic, no AI. Compiles against the
    // Work Graph as it stands RIGHT NOW; the loop below re-derives it
    // continuously from that point on, autonomously.
    const census = observeCensus();
    const held = new Set(listWriteLocks().map((l) => l.scope_path));
    const currentGraph = deriveWorkGraph(census.capabilities, held, EXTERNAL_BLOCKERS, new Date().toISOString());
    const compiled = compileIntent({ description, target_prefix, kinds }, currentGraph);
    console.log(`INTENT COMPILED: "${description}" -> ${compiled.matched_targets.length} target(s), ${compiled.matched_work_ids.length} work item(s)`);
    console.log(`  targets: ${compiled.matched_targets.slice(0, 10).join(", ")}${compiled.matched_targets.length > 10 ? ", ..." : ""}`);
    if (compiled.matched_targets.length === 0) {
      console.log("No targets matched this Objective — nothing to dispatch.");
      return;
    }
    only = compiled.matched_targets;
  }

  if (argv.includes("--graph")) {
    const census = observeCensus();
    const held = new Set(listWriteLocks().map((l) => l.scope_path));
    const scoped = only ? census.capabilities.filter((c) => only.includes(c.path)) : census.capabilities;
    const graph = deriveWorkGraph(scoped, held, EXTERNAL_BLOCKERS, new Date().toISOString());
    for (const state of ["READY", "RUNNING", "BLOCKED", "VERIFIED", "RETIRED"] as const) {
      const items = graph.items.filter((i) => i.state === state);
      if (items.length === 0) continue;
      console.log(`\n${state} (${items.length})`);
      for (const i of items.slice(0, 12)) {
        console.log(`  ${i.work_id}  [${i.worker_class}]`);
        if (state === "BLOCKED") console.log(`      blocked_by: ${i.blocked_by.slice(0, 3).join(", ")}`);
      }
      if (items.length > 12) console.log(`  ... and ${items.length - 12} more`);
    }
    console.log(`\nTOTALS  ${JSON.stringify(graph.totals)}`);
    return;
  }

  const report = await runLoop({
    concurrency: flag("--concurrency", 2),
    maxRounds: flag("--rounds", 3),
    agentTimeoutMs: flag("--timeout", 120000),
    holderId: "canonical-scheduler",
    externalBlockers: EXTERNAL_BLOCKERS,
    onlyTargets: only,
    poolSizePerProvider,
    forceProvider,
  });

  for (const r of report.rounds) {
    console.log(`\n=== ROUND ${r.round} (${r.autonomous ? "AUTONOMOUS — no Owner command" : "initial"}) dispatch=${r.dispatch_id} ===`);
    console.log(`  dispatched concurrently: ${r.dispatched.join(", ") || "(none)"}`);
    for (const res of r.results) {
      console.log(`  ${res.outcome.padEnd(9)} ${res.target.padEnd(38)} ${res.evidence_ref}  (${res.duration_ms}ms)`);
      if (res.outcome !== "VERIFIED") console.log(`      tail: ${res.output_tail.replace(/\n/g, " | ").slice(0, 220)}`);
    }
    console.log(`  graph: ${JSON.stringify(r.graph_before)} -> ${JSON.stringify(r.graph_after)}`);
    console.log(`  NEWLY READY after re-derive: ${r.newly_ready.join(", ") || "(none)"}`);
    if (r.withheld.length > 0) console.log(`  withheld: ${r.withheld.slice(0, 3).map((w) => `${w.work_id} (${w.reason})`).join("; ")}`);
  }
  console.log(`\nLOOP_CLOSED: ${report.closed}`);
  console.log(`STOPPED_BECAUSE: ${report.stopped_because}`);
  console.log(`FINAL TOTALS: ${JSON.stringify(report.final_graph.totals)}`);
}

void main();
