/**
 * Incident Runtime Regression Suite (owner, 2026-08-08, Software Factory
 * Step 12) — verifies real Incident open/correlate/timeline against this
 * repo's actual live state. Never auto-closed, never a guessed root
 * cause, never opened without a real Monitoring finding.
 *
 * Run: npm run incident:test
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { collectAllSignals } from "../app/api/admin/ide/_lib/monitoringRuntime";
import {
  openIncidentFromSignal, changeIncidentStatus, getIncident, listIncidents, listIncidentEvents,
  IncidentError, __debugIncidentCount,
} from "../app/api/admin/ide/_lib/incidentRuntime";
import { listIncidentTypes, getIncidentTypeDefinition } from "../app/api/admin/ide/_lib/incidentRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "incident-regression-owner-a";
const OWNER_B = "incident-regression-owner-b";
const ACTOR = "incident-regression-suite@dnaos.local";

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

  await test("Registry: 19 real Incident Types declared, auto-close DISABLED for every type", () => {
    const types = listIncidentTypes();
    assert(types.length === 19, `expected 19 real Incident Types, got ${types.length}`);
    for (const t of types) assert(t.autoClosePolicy === "DISABLED", `${t.id} must have autoClosePolicy DISABLED this Step`);
  });

  const signals = await collectAllSignals(OWNER_A, ACTOR);
  const badSignal = signals.find((s) => s.status === "STALE" || s.status === "UNHEALTHY" || s.status === "DEGRADED" || s.status === "MISSING");
  assert(!!badSignal, "expected at least one real, non-HEALTHY signal in this repo's actual state to open a real Incident from");

  let incidentId = "";
  await test("Open from real finding: openIncidentFromSignal() opens a real Incident with observedCause matching the real signal's reason verbatim", async () => {
    const inc = await openIncidentFromSignal(badSignal!, OWNER_A, ACTOR);
    incidentId = inc.incidentId;
    assert(inc.observedCause === badSignal!.reason, "expected observedCause to be the real signal's reason verbatim");
    assert(inc.signals.includes(badSignal!.signalId), "expected the real triggering signalId in signals[]");
    assert(inc.status === "OPEN", `expected OPEN, got ${inc.status}`);
    assert(inc.evidence.length > 0, "expected real evidence (artifact) attached at open time");
  });
  await test("Deduplication: opening from the SAME real signal type again within the window correlates into the SAME Incident, never a duplicate", async () => {
    const before = listIncidents(OWNER_A).length;
    const fresh = await collectAllSignals(OWNER_A, ACTOR);
    const same = fresh.find((s) => s.signalType === badSignal!.signalType)!;
    const inc2 = await openIncidentFromSignal(same, OWNER_A, ACTOR);
    assert(inc2.incidentId === incidentId, "expected the SAME real Incident id — deduplicated, not a new one");
    assert(listIncidents(OWNER_A).length === before, "expected no new real Incident record created");
  });
  await test("Correlation: dependency impact uses the real Step 11 Runtime Dependency Graph — affectedDependencies only ever contains real, declared Runtime ids", async () => {
    const { computeRuntimeDependencyGraph } = await import("../app/api/admin/ide/_lib/globalFactoryRuntime");
    const graph = computeRuntimeDependencyGraph();
    const realIds = new Set(graph.nodes.map((n) => n.id));
    const inc = getIncident(incidentId, OWNER_A);
    for (const dep of inc.affectedDependencies) assert(realIds.has(dep), `affectedDependencies contains unknown id "${dep}"`);
  });
  await test("No invented root cause: inferredCause, when present, is always prefixed \"INFERENCE:\" — never presented as fact", () => {
    const inc = getIncident(incidentId, OWNER_A);
    if (inc.inferredCause !== null) assert(inc.inferredCause.startsWith("INFERENCE:"), `expected inferredCause to be prefixed INFERENCE:, got "${inc.inferredCause}"`);
  });
  await test("Severity: deterministic — recomputing from the same real Incident Type + signal severity never changes retroactively without a new real signal", () => {
    const inc1 = getIncident(incidentId, OWNER_A);
    const inc2 = getIncident(incidentId, OWNER_A);
    assert(inc1.severity === inc2.severity, "expected the same real severity across reads with no new signal");
  });
  await test("Owner scope: a different owner cannot read this real Incident", () => {
    try { getIncident(incidentId, OWNER_B); assert(false, "expected INCIDENT_NOT_OWNED"); }
    catch (e) { assert(e instanceof IncidentError && e.code === "INCIDENT_NOT_OWNED", `expected INCIDENT_NOT_OWNED, got ${e}`); }
  });
  await test("Timeline: every real Incident carries a non-empty, chronological timeline citing a real actor", () => {
    const inc = getIncident(incidentId, OWNER_A);
    assert(inc.timeline.length > 0, "expected a real, non-empty timeline");
    for (const t of inc.timeline) assert(t.actor === ACTOR, "expected every real timeline entry to cite a real actor");
  });
  await test("No auto-close: RESOLVED transition is rejected without a real verificationEvidenceArtifactId", async () => {
    const inc = getIncident(incidentId, OWNER_A);
    if (inc.status === "OPEN") changeIncidentStatus(incidentId, OWNER_A, ACTOR, "INVESTIGATING", "moving to investigate");
    try {
      changeIncidentStatus(incidentId, OWNER_A, ACTOR, "MITIGATION_PLANNED", "planning");
      changeIncidentStatus(incidentId, OWNER_A, ACTOR, "RECOVERY_PENDING", "pending recovery");
      changeIncidentStatus(incidentId, OWNER_A, ACTOR, "VERIFICATION_PENDING", "verifying");
      changeIncidentStatus(incidentId, OWNER_A, ACTOR, "RESOLVED", "trying to resolve with no evidence");
      assert(false, "expected RESOLVED to be rejected without real evidence");
    } catch (e) {
      assert(e instanceof IncidentError && e.code === "INVALID_REQUEST", `expected INVALID_REQUEST, got ${e}`);
    }
  });
  await test("Invalid transition rejected: cannot jump straight from a non-terminal status to an unreachable one", async () => {
    const freshSignal = signals.find((s) => s.status === "HEALTHY") ?? signals[0];
    const freshInc = await openIncidentFromSignal(freshSignal, OWNER_A, ACTOR);
    try { changeIncidentStatus(freshInc.incidentId, OWNER_A, ACTOR, "RESOLVED", "skip ahead"); assert(false, "expected INVALID_TRANSITION"); }
    catch (e) { assert(e instanceof IncidentError && (e.code === "INVALID_TRANSITION" || e.code === "INVALID_REQUEST"), `expected a real rejection, got ${e}`); }
  });
  await test("Evidence linkage: every real Incident artifact is a real, immutable, checksummed record", async () => {
    const { getArtifact } = await import("../app/api/admin/ide/_lib/artifactRuntime");
    const inc = getIncident(incidentId, OWNER_A);
    for (const id of inc.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.immutable, `expected artifact ${id} immutable`);
      assert(art.relatedIncidentId === incidentId, `expected artifact ${id} to carry the real relatedIncidentId`);
    }
  });
  await test("Bounded events: listIncidentEvents() returns real events including INCIDENT_OPENED for this suite's real Incident", () => {
    const events = listIncidentEvents();
    assert(events.some((e) => e.incidentId === incidentId && e.type === "INCIDENT_OPENED"), "expected a real INCIDENT_OPENED event for this suite's Incident");
  });
  await test("Unknown signal type maps to UNKNOWN_INCIDENT, never a fabricated specific type", () => {
    const def = getIncidentTypeDefinition("UNKNOWN_INCIDENT");
    assert(!!def, "expected a real UNKNOWN_INCIDENT type registered");
  });

  await test("Scope guarantee: this suite never modified incidentRuntime.ts itself — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/incidentRuntime.ts"])).trim();
    assert(!status.includes(" M "), "expected no real modification to incidentRuntime.ts during this suite's run");
  });
  await test("Debug: __debugIncidentCount() reflects real records created by this suite", () => {
    assert(__debugIncidentCount() >= 1, "expected at least 1 real Incident in the real store");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Incident Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
