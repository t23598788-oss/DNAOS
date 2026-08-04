/**
 * scripts/check-system-control-graph.ts
 *
 * CI-suitable wrapper: runs the generator (which already self-validates and
 * exits non-zero on failure — see build-system-control-graph.ts), then does
 * one extra read-back check that the two output files it just wrote parse
 * as JSON and match the fields npm run architecture:generate is documented
 * to produce. Kept separate from the generator itself so `architecture:generate`
 * stays usable standalone (e.g. from the sync pipeline) without this file's
 * extra I/O.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const ROOT = path.resolve(__dirname, "..");

function fail(msg: string): never {
  process.stderr.write(`\n[check-system-control-graph] FAILED: ${msg}\n\n`);
  process.exit(1);
}

function main() {
  try {
    execFileSync("npx", ["tsx", path.join(ROOT, "scripts/build-system-control-graph.ts")], {
      stdio: "inherit",
      cwd: ROOT,
    });
  } catch {
    fail("generator exited non-zero — see output above");
  }

  const graphPath = path.join(ROOT, "registry/system-control-graph.json");
  const summaryPath = path.join(ROOT, "registry/system-control-summary.json");

  for (const p of [graphPath, summaryPath]) {
    if (!fs.existsSync(p)) fail(`expected output file missing: ${p}`);
  }

  let graph: any, summary: any;
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, "utf-8"));
    summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
  } catch (e) {
    fail(`output file is not valid JSON: ${(e as Error).message}`);
  }

  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) fail("system-control-graph.json has no nodes");
  if (!Array.isArray(graph.sources) || graph.sources.length === 0) fail("system-control-graph.json has no sources list");
  if (typeof summary.total_nodes !== "number") fail("system-control-summary.json missing total_nodes");

  process.stdout.write(
    `[check-system-control-graph] OK — ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.sources.length} sources read\n`
  );
}

main();
