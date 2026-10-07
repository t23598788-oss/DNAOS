/**
 * หน้าที่: the census runner. Gathers real observations via
 * `./host-runtime.ts`, derives the census via `./derive.ts`, prints it, and
 * persists a snapshot ONLY as the baseline for next run's drift comparison —
 * never as the source of truth. Delete the snapshot and the next run still
 * produces a complete, correct census; it just reports no drift.
 *
 * Usage:
 *   npx tsx software/live-census/cli.ts                 # derive + print summary
 *   npx tsx software/live-census/cli.ts --json          # full JSON census
 *   npx tsx software/live-census/cli.ts --drift         # only what changed
 *   npx tsx software/live-census/cli.ts --graph         # derived edges
 *   npx tsx software/live-census/cli.ts --status <path> # one capability
 *   npx tsx software/live-census/cli.ts --record <path> <outcome> <evidence_ref> <by>
 *
 * Dependency ที่อนุญาต: ./derive.ts, ./host-runtime.ts, ./types.ts.
 * สิ่งที่ห้ามแตะ: never write a status into the snapshot and read it back as
 * authority. The snapshot exists for drift only.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, nowIso, sourceDigest, appendVerification } from "./host-runtime";
import { deriveEdges, capabilityKey } from "./derive";
import { impactOf } from "./impact";
import { observeCensus, SNAPSHOT, REPOSITORY } from "./observe";


function main(): void {
  const argv = process.argv.slice(2);

  if (argv[0] === "--record") {
    const [, path, outcome, evidenceRef, by] = argv;
    if (!path || !outcome || !evidenceRef) {
      console.log("usage: --record <path> <VERIFIED|PARTIAL|FAILED|BLOCKED> <evidence_ref> [verified_by]");
      process.exitCode = 1;
      return;
    }
    const digest = sourceDigest(path);
    if (digest === "NO_SOURCE") {
      console.log(`refusing to record: ${path} has no implementation to verify`);
      process.exitCode = 1;
      return;
    }
    appendVerification({
      capability_key: capabilityKey(REPOSITORY, path),
      source_digest: digest,
      verified_at: nowIso(),
      evidence_ref: evidenceRef,
      outcome: outcome as "VERIFIED" | "PARTIAL" | "FAILED" | "BLOCKED",
      verified_by: by ?? "unknown",
    });
    console.log(`recorded ${outcome} for ${path} pinned to source digest ${digest}`);
    return;
  }

  const census = observeCensus();

  if (argv.includes("--json")) {
    console.log(JSON.stringify(census, null, 2));
  } else if (argv.includes("--drift")) {
    if (census.drift.length === 0) console.log("no drift since last census");
    for (const d of census.drift) console.log(`${d.change.padEnd(26)} ${d.capability_key}  ${d.detail}`);
  } else if (argv.includes("--graph")) {
    const edges = deriveEdges(census.capabilities);
    for (const e of edges) console.log(`${e.state.padEnd(21)} ${e.from} -> ${e.to}   (${e.reason})`);
    const byState: Record<string, number> = {};
    for (const e of edges) byState[e.state] = (byState[e.state] ?? 0) + 1;
    console.log(`\n${edges.length} edges: ${Object.entries(byState).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  } else if (argv[0] === "--impact") {
    const target = argv[1];
    if (!target) { console.log("usage: --impact <capability-path>"); process.exitCode = 1; return; }
    const affected = impactOf(target, census.capabilities);
    console.log(`CHANGE IMPACT of ${target}: ${affected.length} capability/capabilities must be re-verified if it changes\n`);
    for (const a of affected) console.log(`  depth ${a.depth}  ${a.path.padEnd(44)} currently ${a.status}`);
  } else if (argv.includes("--invalidated")) {
    // NOTE: `census.capabilities` has ALREADY had applyImpact run on it in
    // observe.ts, so nothing VERIFIED remains for deriveImpact to find — running
    // it here reported "none" while --status showed REQUIRES_REVERIFICATION.
    // The post-impact records ARE the answer; read them directly.
    const invalidated = census.capabilities.filter((c) => c.current_status === "REQUIRES_REVERIFICATION");
    if (invalidated.length === 0) console.log("no VERIFIED capability is currently invalidated by a moved dependency");
    for (const c of invalidated) console.log(`${c.path}\n    ${c.status_reason}`);
  } else if (argv[0] === "--status") {
    const target = argv[1];
    const found = census.capabilities.filter((c) => c.path === target || c.path.endsWith(`/${target}`));
    if (found.length === 0) console.log(`no capability matching "${target}"`);
    for (const c of found) console.log(JSON.stringify(c, null, 2));
  } else {
    console.log(`LIVE CENSUS  ${census.generated_at}  repo=${census.repository}  head=${census.head_commit}`);
    console.log(`derived from ${census.capabilities.length} capability folders\n`);
    const statuses = Object.entries(census.totals).filter(([k]) => k.startsWith("status:")).sort((a, b) => b[1] - a[1]);
    console.log("STATUS (derived, never assigned)");
    for (const [k, v] of statuses) console.log(`  ${String(v).padStart(4)}  ${k.replace("status:", "")}`);
    console.log("\nREGISTRATION");
    for (const [k, v] of Object.entries(census.totals).filter(([k]) => k.startsWith("registration:"))) {
      console.log(`  ${String(v).padStart(4)}  ${k.replace("registration:", "")}`);
    }
    console.log("\nRUNTIME");
    for (const [k, v] of Object.entries(census.totals).filter(([k]) => k.startsWith("runtime:"))) {
      console.log(`  ${String(v).padStart(4)}  ${k.replace("runtime:", "")}`);
    }
    console.log(`\nDRIFT since last census: ${census.drift.length}`);
    for (const d of census.drift.slice(0, 15)) console.log(`  ${d.change.padEnd(26)} ${d.capability_key}`);
    if (census.drift.length > 15) console.log(`  ... and ${census.drift.length - 15} more (--drift for all)`);
  }

  // Snapshot is a drift BASELINE only, never authority. Written last so a crash
  // mid-derivation cannot leave a snapshot that disagrees with what was printed.
  mkdirSync(join(REPO_ROOT, "software/live-census/data"), { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify({ generated_at: census.generated_at, capabilities: census.capabilities }, null, 2), "utf8");
}

main();
