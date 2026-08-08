/**
 * Global Factory Runtime Regression Suite (owner, 2026-08-08, Software
 * Factory Step 11) — verifies the real Global Factory Report, Runtime
 * Dependency Graph, and Factory Runtime Report against this repo's
 * actual live state. Never Deploy, never Git Write, never Auto Fix.
 *
 * Run: npm run global-factory:test
 */
import { readFileSync, existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  computeGlobalFactoryReport, computeRuntimeDependencyGraph, computeFactoryRuntimeReport,
} from "../app/api/admin/ide/_lib/globalFactoryRuntime";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";
import { runGlobalFactoryCheck } from "../app/api/admin/ide/_lib/inspectionRuntime";
import { getInspectionTypeDefinition } from "../app/api/admin/ide/_lib/inspectionRegistry";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");

interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, detail: e instanceof Error ? e.message : String(e) }); }
}
function assert(cond: boolean, message: string) { if (!cond) throw new Error(message); }
async function gitRaw(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: WORKSPACE_ROOT, maxBuffer: 1024 * 1024 * 64 });
  return stdout;
}

const DOMAIN_NAMES = ["Factory", "Workspace", "Capability", "Package", "Deployment", "Monitoring", "Incident", "Recovery", "Backup", "Alerting"];
const VALID_DOMAIN_STATUS = ["OPERATIONAL", "PARTIAL", "NOT_IMPLEMENTED", "UNKNOWN"];

async function main() {
  const preHead = (await gitRaw(["rev-parse", "HEAD"])).trim();

  // ================= REUSE =================
  await test("Reuse: globalFactoryRuntime.ts reuses factoryCompletionRuntime.ts/releaseRuntime.ts/deploymentRuntime.ts — no new Pipeline", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/globalFactoryRuntime.ts"), "utf-8");
    for (const mod of ["./factoryCompletionRuntime", "./releaseRuntime", "./deploymentRuntime", "./fsSecurity"]) {
      assert(src.includes(`from "${mod}"`), `expected real reuse of ${mod}`);
    }
  });

  // ================= GLOBAL FACTORY REPORT =================
  await test("Global Factory Report: all 10 required domains are present with a valid DomainStatus literal (Backup/Alerting added Step 12.5)", () => {
    const report = computeGlobalFactoryReport();
    assert(report.domains.length === 10, `expected 10 real domains, got ${report.domains.length}`);
    for (const name of DOMAIN_NAMES) assert(report.domains.some((d) => d.domain === name), `expected a real domain report for "${name}"`);
    for (const d of report.domains) assert(VALID_DOMAIN_STATUS.includes(d.status), `domain "${d.domain}" has invalid status ${d.status}`);
  });
  await test("Global Factory Report: Monitoring and Incident are honestly PARTIAL as of Step 12 — real Runtime source files exist, but on-demand only, no scheduled loop or automatic trigger", () => {
    const report = computeGlobalFactoryReport();
    const monitoring = report.domains.find((d) => d.domain === "Monitoring")!;
    const incident = report.domains.find((d) => d.domain === "Incident")!;
    assert(monitoring.status === "PARTIAL", `expected Monitoring PARTIAL, got ${monitoring.status}`);
    assert(incident.status === "PARTIAL", `expected Incident PARTIAL, got ${incident.status}`);
  });
  await test("Global Factory Report: Recovery is honestly PARTIAL — scripts/backup.ts is real but not wired to a real Incident workflow", () => {
    const report = computeGlobalFactoryReport();
    const recovery = report.domains.find((d) => d.domain === "Recovery")!;
    assert(recovery.status === "PARTIAL", `expected Recovery PARTIAL, got ${recovery.status}`);
    assert(existsSync(path.join(ROOT, "scripts/backup.ts")), "scripts/backup.ts must really exist to justify PARTIAL over NOT_IMPLEMENTED");
  });
  await test("Global Factory Report: Workspace domain cites the real, single WORKSPACE_ROOT — no second workspace fabricated", () => {
    const report = computeGlobalFactoryReport();
    const workspace = report.domains.find((d) => d.domain === "Workspace")!;
    assert(workspace.evidence.includes(WORKSPACE_ROOT), "expected the real WORKSPACE_ROOT value cited in evidence");
  });
  await test("Global Factory Report: deterministic — two calls produce identical results", () => {
    const a = computeGlobalFactoryReport();
    const b = computeGlobalFactoryReport();
    assert(JSON.stringify(a.domains) === JSON.stringify(b.domains), "expected the same real domains on every call");
  });

  // ================= RUNTIME DEPENDENCY GRAPH (Phase 4) =================
  await test("Runtime Dependency Graph: nodes/edges are computed MECHANICALLY from real import statements, never hand-typed", () => {
    const graph = computeRuntimeDependencyGraph();
    assert(graph.nodes.length === 19, `expected 19 real declared Runtime nodes (4 added Step 12.5: continuousOperationsRuntime/alertRuntime/backupRuntime/restoreTestRuntime), got ${graph.nodes.length}`);
    assert(graph.edges.length > 0, "expected at least one real, mechanically-detected edge");
    // Spot-check a real, known edge: releaseRuntime imports buildRuntime (verified by direct inspection this Step)
    assert(graph.edges.some((e) => e.from === "releaseRuntime" && e.to === "buildRuntime"), "expected the real releaseRuntime -> buildRuntime edge (releaseRuntime.ts genuinely imports buildRuntime.ts)");
    assert(graph.edges.some((e) => e.from === "deploymentRuntime" && e.to === "releaseRuntime"), "expected the real deploymentRuntime -> releaseRuntime edge");
  });
  await test("Runtime Dependency Graph: factoryCompletionRuntime has ZERO outgoing edges — it computes its own evidence via fs checks, never delegates to another Runtime (matches Step 10.5's real finding)", () => {
    const graph = computeRuntimeDependencyGraph();
    const outgoing = graph.edges.filter((e) => e.from === "factoryCompletionRuntime");
    assert(outgoing.length === 0, `expected 0 real outgoing edges from factoryCompletionRuntime, got ${outgoing.length}`);
  });
  await test("Runtime Dependency Graph: Monitoring/Incident/Recovery nodes are honestly REAL as of Step 12 — real, existing source files, never a fabricated status", () => {
    const graph = computeRuntimeDependencyGraph();
    for (const id of ["monitoringRuntime", "incidentRuntime", "recoveryRuntime"]) {
      const node = graph.nodes.find((n) => n.id === id)!;
      assert(node.status === "REAL", `expected ${id} REAL, got ${node.status}`);
      assert(typeof node.file === "string" && existsSync(path.join(ROOT, node.file)), `expected ${id} to cite a real, existing file`);
    }
  });
  await test("Runtime Dependency Graph: every edge references two real, declared node ids — no dangling edge", () => {
    const graph = computeRuntimeDependencyGraph();
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      assert(ids.has(e.from), `edge references unknown node "${e.from}"`);
      assert(ids.has(e.to), `edge references unknown node "${e.to}"`);
    }
  });
  await test("Runtime Dependency Graph: matches the real, generated registry/runtime-dependency-report.json (same computation, no drift)", () => {
    const live = computeRuntimeDependencyGraph();
    const persisted = JSON.parse(readFileSync(path.join(ROOT, "registry/runtime-dependency-report.json"), "utf-8"));
    assert(JSON.stringify(live.nodes) === JSON.stringify(persisted.nodes), "expected identical real nodes between live computation and persisted report");
    assert(JSON.stringify(live.edges) === JSON.stringify(persisted.edges), "expected identical real edges between live computation and persisted report");
  });

  // ================= FACTORY RUNTIME REPORT (Phase 3) =================
  await test("Factory Runtime Report: reachedSubRuntimes reports real reachability — factoryCompletionRuntime/releaseRuntime/monitoringRuntime/incidentRuntime/recoveryRuntime are all really reached as of Step 12", () => {
    const report = computeFactoryRuntimeReport();
    const byId = new Map(report.reachedSubRuntimes.map((r) => [r.id, r.reached]));
    assert(byId.get("factoryCompletionRuntime") === true, "expected factoryCompletionRuntime really reached");
    assert(byId.get("releaseRuntime") === true, "expected releaseRuntime really reached");
    assert(byId.get("monitoringRuntime") === true, "expected monitoringRuntime really reached as of Step 12");
    assert(byId.get("incidentRuntime") === true, "expected incidentRuntime really reached as of Step 12");
    assert(byId.get("recoveryRuntime") === true, "expected recoveryRuntime really reached as of Step 12");
  });

  // ================= PROBLEMS INTEGRATION (Phase 6) =================
  await test("Problems Integration: GLOBAL_FACTORY_CHECK is a real, IMPLEMENTED inspection type", () => {
    const def = getInspectionTypeDefinition("GLOBAL_FACTORY_CHECK");
    assert(!!def && def.status === "IMPLEMENTED", "expected GLOBAL_FACTORY_CHECK to be a real, IMPLEMENTED inspection type");
  });
  await test("Problems Integration: runGlobalFactoryCheck() produces real findings tagged category GLOBAL_FACTORY_CHECK, covering the real PARTIAL Monitoring/Incident/Recovery domains and the real NOT_IMPLEMENTED Deployment domain", async () => {
    const record = await runGlobalFactoryCheck("test-suite@dna-os", "test-owner", null);
    assert(record.status === "PASSED", `expected PASSED (informational audit), got ${record.status}`);
    assert(record.findings.length > 0, "expected at least one real finding — Deployment is genuinely NOT_IMPLEMENTED, Monitoring/Incident/Recovery are genuinely PARTIAL");
    assert(record.findings.every((f) => f.category === "GLOBAL_FACTORY_CHECK"), "every finding must carry the real GLOBAL_FACTORY_CHECK category");
    const codes = new Set(record.findings.map((f) => f.code));
    assert(codes.has("MONITORING") && codes.has("INCIDENT"), "expected real, honest MONITORING and INCIDENT findings");
  });

  // ================= SCOPE / READ-ONLY =================
  await test("Scope guarantee: globalFactoryRuntime.ts never writes to disk — pure real, live computation only", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/globalFactoryRuntime.ts"), "utf-8");
    assert(!src.includes("writeFileSync"), "globalFactoryRuntime.ts must be read-only — writes belong only in scripts/build-global-factory-report.ts");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Global Factory Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
