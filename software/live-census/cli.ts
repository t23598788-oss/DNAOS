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

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT, nowIso, discoverCapabilityFolders, codeFilesIn, testFilesFor, sourceDigest, testDigest,
  headCommit, lastCommitFor, isDirty, newestMtime, importersOf, declaredDependencies,
  registryByName, readVerificationLedger, appendVerification, liveRepoProcesses,
} from "./host-runtime";
import { deriveCensus, deriveEdges, capabilityKey, type Observation } from "./derive";
import type { CapabilityRecord } from "./types";

const REPOSITORY = "dna-os-infrastructure";
const SNAPSHOT = join(REPO_ROOT, "software/live-census/data/last-census.json");

function gather(): Observation[] {
  const at = nowIso();
  const registry = registryByName();
  const runtime = liveRepoProcesses();
  return discoverCapabilityFolders().map((path) => {
    const abs = join(REPO_ROOT, path);
    const code = codeFilesIn(abs);
    return {
      repository: REPOSITORY,
      path,
      code_files: code,
      test_files: testFilesFor(path),
      source_digest: sourceDigest(path),
      test_digest: testDigest(path),
      entrypoint: code.includes("contract.ts") ? `${path}/contract.ts` : code.includes("index.ts") ? `${path}/index.ts` : null,
      last_commit: lastCommitFor(path),
      dirty: isDirty(path),
      newest_mtime: newestMtime(path),
      importers: importersOf(path),
      dependencies: declaredDependencies(path),
      registry_matches: registry.get(path.split("/").slice(1).join("/")) ?? registry.get(path.split("/").pop()!) ?? [],
      runtime_refs: runtime.filter((cmd) => cmd.includes(path)),
      observed_at: at,
    };
  });
}

function loadPrevious(): CapabilityRecord[] {
  if (!existsSync(SNAPSHOT)) return [];
  try {
    return (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { capabilities?: CapabilityRecord[] }).capabilities ?? [];
  } catch {
    return [];
  }
}

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

  const observations = gather();
  const ledger = readVerificationLedger();
  const census = deriveCensus(REPOSITORY, headCommit(), observations, ledger, loadPrevious());

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
