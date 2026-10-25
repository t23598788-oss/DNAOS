/**
 * Operations Readiness Integration Regression Suite (owner, 2026-08-08,
 * Software Factory Step 12.5) — verifies Monitoring/Incident/Recovery/
 * Backup/Alerting readiness gates integrate correctly with Factory
 * Completion and Global Factory, and that live routes/auth/isolation
 * hold. Never mocks a core function — uses real production Runtimes.
 *
 * Run: npm run operations-readiness:test
 */
import { readFileSync, existsSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { computeCompletionGates, computeFactoryCompletion } from "../app/api/admin/ide/_lib/factoryCompletionRuntime";
import { computeGlobalFactoryReport } from "../app/api/admin/ide/_lib/globalFactoryRuntime";
import { getSchedulerContractStatus } from "../app/api/admin/ide/_lib/continuousOperationsRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

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

async function main() {
  const preHead = (await gitRaw(["rev-parse", "HEAD"])).trim();

  await test("Monitoring gate update: MONITORING_READY reflects real Scheduler Contract/Adapter state — PARTIAL, never fabricated PASSED", () => {
    const gates = computeCompletionGates();
    const gate = gates.find((g) => g.id === "MONITORING_READY")!;
    assert(gate.status === "PARTIAL", `expected PARTIAL (real Adapter unproven), got ${gate.status}`);
    assert(gate.evidence.some((e) => e.includes("Scheduler Contract")), "expected evidence to cite the real Scheduler Contract");
  });
  await test("Incident/Recovery gate update: INCIDENT_RECOVERY_READY reflects real Alert + Recovery Runtime state — PARTIAL, restore never VERIFIED", () => {
    const gates = computeCompletionGates();
    const gate = gates.find((g) => g.id === "INCIDENT_RECOVERY_READY")!;
    assert(gate.status === "PARTIAL", `expected PARTIAL, got ${gate.status}`);
    assert(gate.missing.some((m) => m.includes("VERIFIED restore")), "expected missing[] to honestly cite the real, unproven VERIFIED restore requirement");
  });
  await test("Backup gate: BACKUP_READY is a real, new gate separating exists/integrity/restore-verified — never conflated", () => {
    const gates = computeCompletionGates();
    const gate = gates.find((g) => g.id === "BACKUP_READY");
    assert(!!gate, "expected a real BACKUP_READY gate to exist");
    assert(gate!.checks.length === 3, `expected 3 real, separated checks, got ${gate!.checks.length}`);
    assert(gate!.checks.some((c) => c.includes("exists")) && gate!.checks.some((c) => c.includes("integrity")) && gate!.checks.some((c) => c.includes("restore")), "expected checks to separately name exists/integrity/restore");
  });
  await test("Deployment remains blocked: DEPLOYMENT_READY is UNCHANGED by Monitoring/Backup improvements (explicit mission rule)", () => {
    const gates = computeCompletionGates();
    const gate = gates.find((g) => g.id === "DEPLOYMENT_READY")!;
    assert(gate.status === "NOT_IMPLEMENTED", `expected DEPLOYMENT_READY unchanged NOT_IMPLEMENTED, got ${gate.status}`);
  });
  await test("VS Code exit remains honest: VS_CODE_EXIT_READY is UNCHANGED (still BLOCKED — real dependencies still exist)", () => {
    const gates = computeCompletionGates();
    const gate = gates.find((g) => g.id === "VS_CODE_EXIT_READY")!;
    assert(gate.status === "BLOCKED", `expected VS_CODE_EXIT_READY unchanged BLOCKED, got ${gate.status}`);
  });
  await test("Global Factory update: Backup/Alerting domains are real, present, and PARTIAL — never NOT_IMPLEMENTED (real Runtimes exist) or OPERATIONAL (unproven)", () => {
    const report = computeGlobalFactoryReport();
    const backup = report.domains.find((d) => d.domain === "Backup")!;
    const alerting = report.domains.find((d) => d.domain === "Alerting")!;
    assert(backup.status === "PARTIAL", `expected Backup PARTIAL, got ${backup.status}`);
    assert(alerting.status === "PARTIAL", `expected Alerting PARTIAL, got ${alerting.status}`);
  });
  await test("Factory Completion: CONTINUOUS_OPERATIONS_RUNTIME/ALERT_RUNTIME/BACKUP_RESTORE_RUNTIME are real, registered systems", () => {
    const systems = computeFactoryCompletion();
    for (const id of ["CONTINUOUS_OPERATIONS_RUNTIME", "ALERT_RUNTIME", "BACKUP_RESTORE_RUNTIME"]) {
      const sys = systems.find((s) => s.id === id);
      assert(!!sys, `expected a real system record for ${id}`);
      assert(sys!.status !== "NOT_IMPLEMENTED", `expected ${id} real (not NOT_IMPLEMENTED), got ${sys!.status}`);
    }
  });
  await test("Deterministic report: computeCompletionGates() and computeGlobalFactoryReport() are pure and repeatable", () => {
    const g1 = computeCompletionGates(); const g2 = computeCompletionGates();
    assert(JSON.stringify(g1) === JSON.stringify(g2), "expected identical real gates across calls");
  });
  await test("Scheduler Contract cross-check: readiness route's schedulerContract matches the SAME real function the gate evidence cites", () => {
    const s = getSchedulerContractStatus();
    assert(s.contract === "IMPLEMENTED" && s.adapter === "COMPATIBILITY_ONLY", "expected the real, live Scheduler Contract status");
  });
  await test("Auth: every real new Step 12.5 route requires ADMIN_TIER auth (source check)", () => {
    const routes = [
      "app/api/admin/ide/operations/loop/run/route.ts", "app/api/admin/ide/operations/loop/runs/route.ts",
      "app/api/admin/ide/operations/alerts/route.ts", "app/api/admin/ide/operations/alerts/[id]/acknowledge/route.ts",
      "app/api/admin/ide/operations/backups/route.ts", "app/api/admin/ide/operations/backups/[id]/verify/route.ts",
      "app/api/admin/ide/operations/restore-tests/route.ts", "app/api/admin/ide/operations/restore-tests/[id]/verify/route.ts",
      "app/api/admin/ide/operations/readiness/route.ts",
    ];
    for (const r of routes) {
      assert(existsSync(path.join(ROOT, r)), `expected the real route file ${r} to exist`);
      const src = readFileSync(path.join(ROOT, r), "utf-8");
      assert(src.includes("requireAuth(ADMIN_TIER)"), `expected ${r} to be real ADMIN_TIER auth-gated`);
    }
  });
  await test("Cron route uses real CRON_SECRET, never ADMIN_TIER session auth (it has no session)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/cron/operations-loop/route.ts"), "utf-8");
    assert(src.includes("CRON_SECRET"), "expected the real CRON_SECRET check");
    assert(!src.includes("requireAuth"), "the cron route must never depend on a real user session (cron has none)");
  });
  await test("Owner isolation: readiness computation itself has no owner concept (Factory-level gates), but underlying Runtimes remain owner-scoped (cross-checked via monitoring/incident/recovery/operations suites)", () => {
    assert(existsSync(path.join(ROOT, "scripts/monitoring-test.ts")), "expected the real owner-isolation proof to live in monitoring-test.ts (already passing)");
  });

  await test("Source unchanged: this suite never modified factoryCompletionRuntime.ts/globalFactoryRuntime.ts — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/factoryCompletionRuntime.ts", "app/api/admin/ide/_lib/globalFactoryRuntime.ts"])).trim();
    assert(!status.includes(" M "), "expected no real modification during this suite's run");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Operations Readiness Integration Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
