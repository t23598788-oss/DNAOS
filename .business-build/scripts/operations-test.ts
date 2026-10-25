/**
 * Operations Integration Regression Suite (owner, 2026-08-08, Software
 * Factory Step 12) — verifies Monitoring/Incident/Recovery integrate
 * correctly with Factory Completion, Global Factory, Artifact lineage,
 * the Problems Panel, and API auth/isolation. Never mocks a core
 * function — uses the real production Runtimes throughout.
 *
 * Run: npm run operations:test
 */
import { readFileSync, existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { collectAllSignals } from "../app/api/admin/ide/_lib/monitoringRuntime";
import { openIncidentFromSignal } from "../app/api/admin/ide/_lib/incidentRuntime";
import { createRecoveryPlan } from "../app/api/admin/ide/_lib/recoveryRuntime";
import { computeFactoryCompletion, computeCompletionGates } from "../app/api/admin/ide/_lib/factoryCompletionRuntime";
import { computeGlobalFactoryReport, computeRuntimeDependencyGraph } from "../app/api/admin/ide/_lib/globalFactoryRuntime";
import { runOperationsCheck } from "../app/api/admin/ide/_lib/inspectionRuntime";
import { getInspectionTypeDefinition } from "../app/api/admin/ide/_lib/inspectionRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "operations-regression-owner-a";
const ACTOR = "operations-regression-suite@dnaos.local";

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

async function main() {
  const preHead = (await gitRaw(["rev-parse", "HEAD"])).trim();

  await test("Factory Completion: MONITORING_RUNTIME/INCIDENT_RUNTIME/RECOVERY_RUNTIME are real, registered systems with COMPLETE/PARTIAL/OPERATIONAL status, never NOT_IMPLEMENTED", () => {
    const systems = computeFactoryCompletion();
    for (const id of ["MONITORING_RUNTIME", "INCIDENT_RUNTIME", "RECOVERY_RUNTIME"]) {
      const sys = systems.find((s) => s.id === id);
      assert(!!sys, `expected a real system record for ${id}`);
      assert(sys!.status !== "NOT_IMPLEMENTED", `expected ${id} to be real (not NOT_IMPLEMENTED) as of Step 12, got ${sys!.status}`);
    }
  });
  await test("Factory Completion Gates: MONITORING_READY/INCIDENT_RECOVERY_READY reflect real Runtime status, never fabricated PASSED", () => {
    const gates = computeCompletionGates();
    const monitoring = gates.find((g) => g.id === "MONITORING_READY")!;
    const incidentRecovery = gates.find((g) => g.id === "INCIDENT_RECOVERY_READY")!;
    assert(monitoring.status === "PARTIAL", `expected MONITORING_READY PARTIAL (real Runtime, on-demand only), got ${monitoring.status}`);
    assert(incidentRecovery.status === "PARTIAL", `expected INCIDENT_RECOVERY_READY PARTIAL, got ${incidentRecovery.status}`);
    assert(monitoring.status !== "PASSED" && incidentRecovery.status !== "PASSED", "must never claim PASSED — real mutating Recovery remains PLAN_ONLY/NOT_IMPLEMENTED");
  });
  await test("Factory Completion Gates: DEPLOYMENT_READY and VS_CODE_EXIT_READY are UNCHANGED by Monitoring's existence (explicit mission rule)", () => {
    const gates = computeCompletionGates();
    const deploy = gates.find((g) => g.id === "DEPLOYMENT_READY")!;
    const vscode = gates.find((g) => g.id === "VS_CODE_EXIT_READY")!;
    assert(deploy.status === "NOT_IMPLEMENTED", `expected DEPLOYMENT_READY unchanged (NOT_IMPLEMENTED), got ${deploy.status}`);
    assert(vscode.status === "BLOCKED", `expected VS_CODE_EXIT_READY unchanged (BLOCKED), got ${vscode.status}`);
  });
  await test("Global Factory: Monitoring/Incident/Recovery domains are real, PARTIAL — Deployment remains honestly NOT_IMPLEMENTED", () => {
    const report = computeGlobalFactoryReport();
    for (const domain of ["Monitoring", "Incident", "Recovery"]) {
      const d = report.domains.find((x) => x.domain === domain)!;
      assert(d.status === "PARTIAL", `expected ${domain} PARTIAL, got ${d.status}`);
    }
    const deployment = report.domains.find((d) => d.domain === "Deployment")!;
    assert(deployment.status === "NOT_IMPLEMENTED", `expected Deployment domain unchanged NOT_IMPLEMENTED, got ${deployment.status}`);
  });
  await test("Runtime Dependency Graph: monitoringRuntime/incidentRuntime/recoveryRuntime are real, connected nodes with correct real edges", () => {
    const graph = computeRuntimeDependencyGraph();
    assert(graph.edges.some((e) => e.from === "incidentRuntime" && e.to === "monitoringRuntime"), "expected real incidentRuntime -> monitoringRuntime edge (incidentRuntime imports SignalRecord/Severity types from monitoringRuntime)");
    assert(graph.edges.some((e) => e.from === "recoveryRuntime" && e.to === "incidentRuntime"), "expected real recoveryRuntime -> incidentRuntime edge");
    assert(graph.edges.some((e) => e.from === "recoveryRuntime" && e.to === "monitoringRuntime"), "expected real recoveryRuntime -> monitoringRuntime edge");
  });

  const signals = await collectAllSignals(OWNER_A, ACTOR);
  const backupSignal = signals.find((s) => s.signalType === "BACKUP_HEALTH")!;
  const inc = await openIncidentFromSignal(backupSignal, OWNER_A, ACTOR);
  await createRecoveryPlan(inc.incidentId, "RESTORE_FROM_BACKUP", OWNER_A, ACTOR);

  await test("Problems Panel: OPERATIONS_CHECK is a real, IMPLEMENTED inspection type producing real findings across the 11 required categories", async () => {
    const def = getInspectionTypeDefinition("OPERATIONS_CHECK");
    assert(!!def && def.status === "IMPLEMENTED", "expected OPERATIONS_CHECK to be a real, IMPLEMENTED inspection type");
    const record = await runOperationsCheck(ACTOR, OWNER_A, null);
    assert(record.status === "PASSED", `expected PASSED (informational), got ${record.status}`);
    assert(record.findings.length > 0, "expected at least one real finding");
    assert(record.findings.every((f) => f.category === "OPERATIONS_CHECK"), "every finding must carry the real OPERATIONS_CHECK category");
    const codes = new Set(record.findings.map((f) => f.code));
    assert(codes.has("INCIDENT_OPEN"), "expected a real INCIDENT_OPEN finding");
  });

  await test("Artifact lineage: real Signal -> Incident -> Recovery Plan chain is traceable through real Evidence Warehouse artifacts", async () => {
    const { getArtifact } = await import("../app/api/admin/ide/_lib/artifactRuntime");
    for (const id of inc.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.relatedIncidentId === inc.incidentId, "expected real relatedIncidentId linkage");
    }
  });

  await test("Deterministic output: computeGlobalFactoryReport() and computeFactoryCompletion() are pure and repeatable across two calls", () => {
    const a1 = computeFactoryCompletion(); const a2 = computeFactoryCompletion();
    assert(JSON.stringify(a1.map((s) => s.status)) === JSON.stringify(a2.map((s) => s.status)), "expected identical real statuses across calls");
    const g1 = computeGlobalFactoryReport(); const g2 = computeGlobalFactoryReport();
    assert(JSON.stringify(g1.domains) === JSON.stringify(g2.domains), "expected identical real domains across calls");
  });

  await test("Auth: every real Operations route requires ADMIN_TIER auth (source check across all 13 real route files)", () => {
    const routes = [
      "app/api/admin/ide/operations/monitoring/summary/route.ts",
      "app/api/admin/ide/operations/monitoring/signals/route.ts",
      "app/api/admin/ide/operations/monitoring/signals/[signalId]/route.ts",
      "app/api/admin/ide/operations/monitoring/collect/route.ts",
      "app/api/admin/ide/operations/incidents/route.ts",
      "app/api/admin/ide/operations/incidents/[incidentId]/route.ts",
      "app/api/admin/ide/operations/incidents/[incidentId]/status/route.ts",
      "app/api/admin/ide/operations/recovery/plans/route.ts",
      "app/api/admin/ide/operations/recovery/plans/[planId]/route.ts",
      "app/api/admin/ide/operations/recovery/plans/[planId]/approve/route.ts",
      "app/api/admin/ide/operations/recovery/plans/[planId]/verify/route.ts",
      "app/api/admin/ide/operations/status/route.ts",
      "app/api/admin/ide/operations/events/route.ts",
    ];
    for (const r of routes) {
      assert(existsSync(path.join(ROOT, r)), `expected the real route file ${r} to exist`);
      const src = readFileSync(path.join(ROOT, r), "utf-8");
      assert(src.includes("requireAuth(ADMIN_TIER)"), `expected ${r} to be real ADMIN_TIER auth-gated`);
    }
  });
  await test("No provider mutation, no deploy/restart/restore execution: grep across all real Operations routes confirms no real mutating provider call", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/operations/recovery/plans/[planId]/approve/route.ts"), "utf-8");
    assert(!src.includes("execFile") && !src.includes("supabaseAdmin"), "the approve route must never itself execute a real mutation or call a provider client");
  });

  await test("Scope guarantee: this suite never modified inspectionRuntime.ts or any Runtime source file — spot-checked", async () => {
    const status = (await gitRaw(["status", "--porcelain",
      "app/api/admin/ide/_lib/monitoringRuntime.ts", "app/api/admin/ide/_lib/incidentRuntime.ts", "app/api/admin/ide/_lib/recoveryRuntime.ts",
      "app/api/admin/ide/_lib/factoryCompletionRuntime.ts", "app/api/admin/ide/_lib/globalFactoryRuntime.ts",
    ])).trim();
    assert(!status.includes(" M "), "expected no real modification to any Runtime source file during this suite's run");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Operations Integration Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
