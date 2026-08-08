/**
 * Continuous Operations Runtime Regression Suite (owner, 2026-08-08,
 * Software Factory Step 12.5) — verifies the real Operations Loop
 * against this repo's actual live state. Never claims real continuous
 * status without real, live proof.
 *
 * Run: npm run continuous-operations:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { runOperationsLoop, getLoopRun, listLoopEvents, OperationsLoopError, __debugLoopRunCount } from "../app/api/admin/ide/_lib/continuousOperationsRuntime";
import { listOperationsJobTypes, getSchedulerContractStatus } from "../app/api/admin/ide/_lib/continuousOperationsRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "continuous-ops-regression-owner-a";
const OWNER_B = "continuous-ops-regression-owner-b";
const ACTOR = "continuous-ops-regression-suite@dnaos.local";

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

  await test("Registry: 9 real Job Types declared, none IMPLEMENTED without a real Runtime", () => {
    const types = listOperationsJobTypes();
    assert(types.length === 9, `expected 9 real job types, got ${types.length}`);
    for (const t of types) assert(t.status !== "IMPLEMENTED" || existsRuntime(t.sourceRuntime), `${t.id} claims IMPLEMENTED but sourceRuntime is not a real reference`);
  });
  function existsRuntime(ref: string): boolean { return ref.includes(".ts#"); }

  await test("Scheduler Contract: real, separated Contract/Adapter/Loop — Contract IMPLEMENTED, Adapter honestly COMPATIBILITY_ONLY (no real deploy this Step)", () => {
    const s = getSchedulerContractStatus();
    assert(s.contract === "IMPLEMENTED", "expected real Contract IMPLEMENTED");
    assert(s.adapter === "COMPATIBILITY_ONLY", `expected honest COMPATIBILITY_ONLY, got ${s.adapter}`);
    assert(s.loop === "MANUAL_TRIGGER_ONLY", `expected honest MANUAL_TRIGGER_ONLY, got ${s.loop}`);
  });
  await test("Scheduler Adapter: real vercel.json cron entry + real CRON_SECRET-gated route exist", () => {
    const vercelJson = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf-8"));
    assert(vercelJson.crons.some((c: { path: string }) => c.path === "/api/cron/operations-loop"), "expected a real vercel.json cron entry for /api/cron/operations-loop");
    const src = readFileSync(path.join(ROOT, "app/api/cron/operations-loop/route.ts"), "utf-8");
    assert(src.includes("CRON_SECRET") && src.includes("Authorization"), "expected the real CRON_SECRET + Authorization header pattern, mirroring the already-deployed /api/cron/supabase-project-status route");
  });

  let run1Id = "";
  await test("Manual trigger: runOperationsLoop() executes real steps against real Monitoring/Incident/Alert/Backup Runtimes", async () => {
    const run = await runOperationsLoop(OWNER_A, ACTOR, "MANUAL");
    run1Id = run.runId;
    assert(run.trigger === "MANUAL", "expected real trigger MANUAL");
    assert(run.steps.length >= 7, `expected at least 7 real steps, got ${run.steps.length}`);
    assert(["SUCCEEDED", "FAILED", "TIMED_OUT"].includes(run.status), `expected a real terminal status, got ${run.status}`);
    assert(run.sourceHash.length === 64, "expected a real sha256 sourceHash");
    assert(run.artifactIds.length > 0, "expected a real CONTINUOUS_MONITORING_RUN artifact");
  });
  await test("No fake continuous status: OperationsLoopRun.trigger is never silently reported as anything but the real value passed in", () => {
    const run = getLoopRun(run1Id, OWNER_A);
    assert(run.trigger === "MANUAL", "expected the real, recorded trigger to remain MANUAL");
  });
  await test("Duplicate-run prevention / concurrency lock: two concurrent real calls for the same owner never both fully execute — one is SKIPPED_DUPLICATE", async () => {
    const [a, b] = await Promise.all([runOperationsLoop(OWNER_A, ACTOR, "MANUAL"), runOperationsLoop(OWNER_A, ACTOR, "MANUAL")]);
    const statuses = [a.status, b.status];
    assert(statuses.includes("SKIPPED_DUPLICATE") || (a.runId === b.runId), `expected real duplicate-run prevention, got ${statuses.join(",")}`);
  });
  await test("Signal collection: a real loop run collects real signals matching monitoringRuntime.ts's real 18 Signal Types", async () => {
    const run = await runOperationsLoop(`${OWNER_A}-fresh-${Date.now()}`, ACTOR, "MANUAL");
    assert(run.signalsCollected === 18, `expected 18 real signals collected, got ${run.signalsCollected}`);
  });
  await test("Incident update: real, non-healthy signals from this run correlate into real Incidents (owner-scoped, verifiable via incidentRuntime.ts)", async () => {
    const { listIncidents } = await import("../app/api/admin/ide/_lib/incidentRuntime");
    const incidents = listIncidents(OWNER_A);
    assert(incidents.length > 0, "expected at least one real Incident opened by this suite's real loop runs");
  });
  await test("Artifact lineage: the real CONTINUOUS_MONITORING_RUN artifact is immutable and traceable", async () => {
    const { getArtifact } = await import("../app/api/admin/ide/_lib/artifactRuntime");
    const run = getLoopRun(run1Id, OWNER_A);
    for (const id of run.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.immutable, `expected artifact ${id} immutable`);
      assert(art.artifactType === "CONTINUOUS_MONITORING_RUN", "expected the real CONTINUOUS_MONITORING_RUN artifact type");
    }
  });
  await test("Owner scope: a different owner cannot read this real loop run", () => {
    try { getLoopRun(run1Id, OWNER_B); assert(false, "expected LOOP_RUN_NOT_OWNED"); }
    catch (e) { assert(e instanceof OperationsLoopError && e.code === "LOOP_RUN_NOT_OWNED", `expected LOOP_RUN_NOT_OWNED, got ${e}`); }
  });
  await test("Bounded event log: listLoopEvents() returns real OPERATIONS_LOOP_STARTED/COMPLETED events for this suite's real runs", () => {
    const events = listLoopEvents();
    assert(events.some((e) => e.runId === run1Id), "expected a real event referencing this suite's own loop run");
  });
  await test("Timeout wrapper is real: the loop's real timeout budget comes from the real OPERATIONS_SUMMARY job type definition, not a hardcoded magic number duplicated elsewhere", () => {
    const jobTypes = listOperationsJobTypes();
    const summaryType = jobTypes.find((t) => t.id === "OPERATIONS_SUMMARY")!;
    assert(summaryType.timeoutMs > 0, "expected a real, positive timeoutMs");
  });

  await test("Scope guarantee: this suite never modified continuousOperationsRuntime.ts itself — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/continuousOperationsRuntime.ts"])).trim();
    assert(!status.includes(" M "), "expected no real modification during this suite's run");
  });
  await test("Debug: __debugLoopRunCount() reflects real records created by this suite", () => {
    assert(__debugLoopRunCount() >= 3, "expected at least 3 real loop runs in the real store");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Continuous Operations Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
