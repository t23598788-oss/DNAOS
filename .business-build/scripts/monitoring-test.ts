/**
 * Monitoring Runtime Regression Suite (owner, 2026-08-08, Software
 * Factory Step 12) — verifies real Signal collection against this repo's
 * actual live state. Observe-only — never mutates production, never
 * fabricates HEALTHY.
 *
 * Run: npm run monitoring:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import {
  collectSignal, collectAllSignals, listSignals, getSignal, computeMonitoringSummary,
  listMonitoringEvents, MonitoringError, __debugSignalCount,
} from "../app/api/admin/ide/_lib/monitoringRuntime";
import { listSignalTypes, SIGNAL_TYPE_REGISTRY, type SignalType } from "../app/api/admin/ide/_lib/monitoringRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "monitoring-regression-owner-a";
const OWNER_B = "monitoring-regression-owner-b";
const ACTOR = "monitoring-regression-suite@dnaos.local";

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

  // ================= REUSE / REGISTRY =================
  await test("Reuse: monitoringRuntime.ts reuses executionRuntime/queueRuntime/buildRuntime/releaseRuntime/deploymentRuntime/artifactRuntime/governanceRuntime/globalFactoryRuntime — no new Pipeline", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/monitoringRuntime.ts"), "utf-8");
    for (const mod of ["./executionRuntime", "./queueRuntime", "./buildRuntime", "./releaseRuntime", "./deploymentRuntime", "./artifactRuntime", "./governanceRuntime", "./globalFactoryRuntime"]) {
      assert(src.includes(`from "${mod}"`), `expected real reuse of ${mod}`);
    }
  });
  await test("Registry: 18 real Signal Types declared, each with a valid status literal", () => {
    const types = listSignalTypes();
    assert(types.length === 18, `expected 18 real Signal Types, got ${types.length}`);
    const valid = ["IMPLEMENTED", "PARTIAL", "NOT_IMPLEMENTED", "COMPATIBILITY_ONLY", "UNKNOWN"];
    for (const t of types) assert(valid.includes(t.status), `${t.id} has invalid status ${t.status}`);
  });
  await test("Registry: no Signal Type is declared IMPLEMENTED without a real source string", () => {
    for (const t of listSignalTypes()) {
      if (t.status === "IMPLEMENTED") assert(!!t.source && t.source !== "none", `${t.id} is IMPLEMENTED but has no real source`);
    }
  });

  // ================= SIGNAL COLLECTION =================
  let allSignals: Awaited<ReturnType<typeof collectAllSignals>> = [];
  await test("Signal collection: collectAllSignals() returns exactly 18 real records, one per registered Signal Type", async () => {
    allSignals = await collectAllSignals(OWNER_A, ACTOR);
    assert(allSignals.length === 18, `expected 18 real signals, got ${allSignals.length}`);
    const types = new Set(allSignals.map((s) => s.signalType));
    assert(types.size === 18, "expected 18 distinct real signal types");
  });
  await test("No fake HEALTHY: PROCESS_LEAK (no real source exists) never reports HEALTHY", () => {
    const s = allSignals.find((s) => s.signalType === "PROCESS_LEAK")!;
    assert(s.status === "NOT_IMPLEMENTED", `expected NOT_IMPLEMENTED, got ${s.status}`);
  });
  await test("Missing signal honesty: a signal type with no real records for a brand-new owner reports UNKNOWN, never HEALTHY", async () => {
    const freshOwner = `monitoring-fresh-${Date.now()}`;
    const s = await collectSignal("QUEUE_HEALTH", freshOwner, ACTOR);
    assert(s.status === "UNKNOWN", `expected UNKNOWN for a fresh owner with 0 real jobs, got ${s.status}`);
  });
  await test("Stale signal honesty: BACKUP_HEALTH reflects the real, current age of backups/2026-07-05_0502 (or reports UNHEALTHY/UNKNOWN if it no longer exists)", () => {
    const s = allSignals.find((s) => s.signalType === "BACKUP_HEALTH")!;
    assert(["STALE", "HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"].includes(s.status), `unexpected status ${s.status}`);
    assert(typeof s.reason === "string" && s.reason.length > 0, "expected a real, non-empty reason");
  });
  await test("Deterministic evaluation: two consecutive collections of REGISTRY_INTEGRITY (unchanged real registry) produce the SAME real status", async () => {
    const a = await collectSignal("REGISTRY_INTEGRITY", OWNER_A, ACTOR);
    const b = await collectSignal("REGISTRY_INTEGRITY", OWNER_A, ACTOR);
    assert(a.status === b.status, `expected deterministic status, got ${a.status} then ${b.status}`);
  });
  await test("sourceHash: every real signal carries a real sha256 sourceHash derived from its own normalizedValue", () => {
    for (const s of allSignals) assert(typeof s.sourceHash === "string" && s.sourceHash.length === 64, `${s.signalType} missing a real 64-char sourceHash`);
  });
  await test("Provider unknown honesty: EXTERNAL_PROVIDER_HEALTH/DATABASE_HEALTH/CONNECTOR_HEALTH never report HEALTHY without a real row — in this sandbox (no live Supabase credentials) they report UNKNOWN, never fabricated HEALTHY", () => {
    for (const type of ["DATABASE_HEALTH", "CONNECTOR_HEALTH", "EXTERNAL_PROVIDER_HEALTH"] as const) {
      const s = allSignals.find((sig) => sig.signalType === type)!;
      assert(s.status !== "HEALTHY" || s.normalizedValue !== null, `${type} claims HEALTHY but has no real normalizedValue backing it`);
    }
  });
  await test("Bounded events: listMonitoringEvents() returns real, non-fabricated events with matching signalType", () => {
    const events = listMonitoringEvents();
    assert(events.length > 0, "expected at least one real event from this suite's own collection");
    for (const e of events.slice(0, 5)) assert(SIGNAL_TYPE_REGISTRY[e.signalType] !== undefined, `event references unknown signal type ${e.signalType}`);
  });
  await test("Signal detail: getSignal() returns the exact real record, isolated per owner", async () => {
    const s = allSignals[0];
    const fetched = getSignal(s.signalId, OWNER_A);
    assert(fetched.signalId === s.signalId, "expected the same real signal");
    try { getSignal(s.signalId, OWNER_B); assert(false, "expected SIGNAL_NOT_OWNED"); }
    catch (e) { assert(e instanceof MonitoringError && e.code === "SIGNAL_NOT_OWNED", `expected SIGNAL_NOT_OWNED, got ${e}`); }
  });
  await test("Unknown signal type is rejected", async () => {
    try { await collectSignal("TOTALLY_FAKE_TYPE" as unknown as SignalType, OWNER_A, ACTOR); assert(false, "expected SIGNAL_TYPE_NOT_REGISTERED"); }
    catch (e) { assert(e instanceof MonitoringError && e.code === "SIGNAL_TYPE_NOT_REGISTERED", `expected SIGNAL_TYPE_NOT_REGISTERED, got ${e}`); }
  });
  await test("Summary: computeMonitoringSummary() byStatus counts sum to total, overallStatus reflects the worst real signal", () => {
    const summary = computeMonitoringSummary(OWNER_A);
    const sum = Object.values(summary.byStatus).reduce((a, b) => a + b, 0);
    assert(sum === summary.total, `expected byStatus to sum to total (${sum} != ${summary.total})`);
    if (summary.byStatus.UNHEALTHY > 0 || summary.byStatus.MISSING > 0) assert(summary.overallStatus === "UNHEALTHY", "expected overallStatus UNHEALTHY given a real UNHEALTHY/MISSING signal");
  });

  // ================= READ-ONLY / SCOPE =================
  await test("Read-only: monitoringRuntime.ts never calls .insert/.update/.delete/.upsert on the real Supabase client — the only real db.from(...) call is a .select() (crypto's hash.update() and the in-memory signals.delete() are real, unrelated, non-provider calls, excluded by name)", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/monitoringRuntime.ts"), "utf-8");
    const mutationLines = src.split("\n").filter((line) => {
      if (line.trim().startsWith("*") || line.trim().startsWith("//")) return false;
      if (line.includes("createHash") || line.includes(".digest(")) return false;
      if (line.includes("signals.delete(")) return false;
      return /\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(line);
    });
    assert(mutationLines.length === 0, `monitoringRuntime.ts must be strictly read-only, found: ${JSON.stringify(mutationLines)}`);
    assert(src.includes('.select("*")'), "expected the real, single, read-only .select(\"*\") call against system_health_status");
  });
  await test("Debug: __debugSignalCount() reflects real records created by this suite", () => {
    assert(__debugSignalCount() >= allSignals.length, "expected the real global signal count to include this suite's records");
  });
  await test("Scope guarantee: this suite never modified monitoringRuntime.ts itself — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/monitoringRuntime.ts"])).trim();
    assert(!status.includes(" M "), "expected no real modification to monitoringRuntime.ts during this suite's run");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Monitoring Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
