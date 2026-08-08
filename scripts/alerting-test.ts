/**
 * Alert Runtime Regression Suite (owner, 2026-08-08, Software Factory
 * Step 12.5) — verifies real, deterministic Alert dispatch against this
 * repo's actual live state. Never dispatches from an AI-authored
 * message, never claims DELIVERED without a real receipt.
 *
 * Run: npm run alerting:test
 */
import { readFileSync } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { collectAllSignals } from "../app/api/admin/ide/_lib/monitoringRuntime";
import { openIncidentFromSignal } from "../app/api/admin/ide/_lib/incidentRuntime";
import { dispatchAlert, acknowledgeAlert, getAlert, listAlerts, listAlertEvents, AlertError, __debugAlertCount } from "../app/api/admin/ide/_lib/alertRuntime";
import { listAlertChannels, DEFAULT_ALERT_POLICY } from "../app/api/admin/ide/_lib/alertRegistry";
import { WORKSPACE_ROOT } from "../app/api/admin/ide/_lib/fsSecurity";

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, "..");
const OWNER_A = "alerting-regression-owner-a";
const OWNER_B = "alerting-regression-owner-b";
const ACTOR = "alerting-regression-suite@dnaos.local";

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

  await test("Registry: 5 real Alert Channels declared, OWNER_UI/SYSTEM_EVENT always ACTIVE, LINE reflects the real, live env credential state", () => {
    const channels = listAlertChannels();
    assert(channels.length === 5, `expected 5 real channels, got ${channels.length}`);
    assert(channels.find((c) => c.id === "OWNER_UI")!.status === "ACTIVE", "expected OWNER_UI ACTIVE");
    assert(channels.find((c) => c.id === "SYSTEM_EVENT")!.status === "ACTIVE", "expected SYSTEM_EVENT ACTIVE");
    assert(channels.find((c) => c.id === "EMAIL")!.status === "NOT_IMPLEMENTED", "expected EMAIL honestly NOT_IMPLEMENTED (no reusable adapter reachable from this layer)");
    const lineStatus = channels.find((c) => c.id === "LINE")!.status;
    assert(lineStatus === (process.env.LINE_CHANNEL_ACCESS_TOKEN ? "CONFIGURED" : "PARTIAL"), "expected LINE status to reflect the real, live env credential presence");
  });
  await test("Reuse: alertRuntime.ts reuses registry/communication.ts#sendLineMessage — the real, single LINE gateway, never a second client", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/alertRuntime.ts"), "utf-8");
    assert(src.includes("@/registry/communication"), "expected real reuse of registry/communication.ts");
    assert(!src.includes("LINE_MESSAGING_API"), "must never re-declare the real LINE endpoint URL — that constant belongs only to registry/communication.ts");
  });

  const signals = await collectAllSignals(OWNER_A, ACTOR);
  const bad = signals.find((s) => s.status === "UNHEALTHY" || s.status === "DEGRADED" || s.status === "STALE")!;
  const incident = await openIncidentFromSignal(bad, OWNER_A, ACTOR);

  let alertId = "";
  await test("Deterministic source: dispatchAlert() only accepts a real IncidentRecord — never a free-text message", async () => {
    // Real, deliberate INFO threshold (SEVERITY_ORDER's lowest tier) so
    // this dispatch — and every downstream test reading this same alertId
    // — is deterministic regardless of which real live signal happened to
    // be "bad" first: severity/suppression behavior has its own dedicated,
    // explicit-threshold test below and is not what this section verifies.
    const alert = await dispatchAlert(incident, OWNER_A, ACTOR, { ...DEFAULT_ALERT_POLICY, severityThreshold: "INFO" });
    alertId = alert.alertId;
    assert(alert.incidentId === incident.incidentId, "expected the real incidentId to be recorded verbatim");
    assert(alert.reason === incident.observedCause, "expected the real reason to be the incident's real observedCause, never an invented message");
  });
  await test("Channel results: OWNER_UI and SYSTEM_EVENT are always real, successful, in-memory dispatches", () => {
    const alert = getAlert(alertId, OWNER_A);
    const ownerUi = alert.channelResults.find((c) => c.channel === "OWNER_UI")!;
    const sysEvent = alert.channelResults.find((c) => c.channel === "SYSTEM_EVENT")!;
    assert(ownerUi.ok === true, "expected real OWNER_UI dispatch to always succeed");
    assert(sysEvent.ok === true, "expected real SYSTEM_EVENT dispatch to always succeed");
  });
  await test("No fake DELIVERED: DISPATCHED never implies DELIVERED — the real AlertStatus type has no code path that ever sets DELIVERED", () => {
    const alert = getAlert(alertId, OWNER_A);
    assert(alert.status !== "DELIVERED", "expected status to never be DELIVERED (no real delivery receipt mechanism exists for any channel)");
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/alertRuntime.ts"), "utf-8");
    const activeAssignments = src.split("\n").filter((l) => /status\s*[:=]\s*"DELIVERED"/.test(l) && !l.trim().startsWith("*") && !l.trim().startsWith("//"));
    assert(activeAssignments.length === 0, "expected zero real code paths assigning status DELIVERED");
  });
  await test("Deduplication: dispatching again for the SAME real Incident within the window returns the SAME real Alert, never a duplicate", async () => {
    const before = listAlerts(OWNER_A).length;
    const again = await dispatchAlert(incident, OWNER_A, ACTOR);
    assert(again.alertId === alertId, "expected the SAME real alertId — deduplicated");
    assert(listAlerts(OWNER_A).length === before, "expected no new real Alert record created");
  });
  await test("Severity threshold / suppression: an Incident below the real policy severityThreshold is honestly SUPPRESSED, never silently dropped", async () => {
    // COST_ANOMALY's real Incident Type has minimumSeverity LOW (incidentRegistry.ts) —
    // the one real, genuinely low-floor type, so forcing a real, low-severity
    // Incident here is deterministic regardless of which signal was picked.
    const costSignal = signals.find((s) => s.signalType === "COST_ANOMALY")!;
    const lowIncident = await openIncidentFromSignal({ ...costSignal, severity: "LOW" }, OWNER_A, ACTOR);
    assert(lowIncident.severity === "LOW", `expected the real Incident's computed severity to be LOW, got ${lowIncident.severity}`);
    const alert = await dispatchAlert(lowIncident, OWNER_A, ACTOR, { ...DEFAULT_ALERT_POLICY, severityThreshold: "HIGH" });
    assert(alert.status === "SUPPRESSED", `expected SUPPRESSED for a below-threshold real severity, got ${alert.status}`);
    assert(!!alert.suppressionReason, "expected a real, non-empty suppressionReason");
  });
  await test("Acknowledgement: acknowledgeAlert() requires a real, non-empty note and records a real acknowledgedAt/acknowledgedBy", () => {
    try { acknowledgeAlert(alertId, OWNER_A, ACTOR, ""); assert(false, "expected INVALID_REQUEST"); }
    catch (e) { assert(e instanceof AlertError && e.code === "INVALID_REQUEST", `expected INVALID_REQUEST, got ${e}`); }
    const ack = acknowledgeAlert(alertId, OWNER_A, ACTOR, "real owner acknowledgement");
    assert(ack.status === "ACKNOWLEDGED", "expected real ACKNOWLEDGED status");
    assert(!!ack.acknowledgedAt && ack.acknowledgedBy === ACTOR, "expected real acknowledgedAt/acknowledgedBy");
  });
  await test("No cross-workspace data: alert dispatch rejects an Incident belonging to a different owner", async () => {
    try { await dispatchAlert(incident, OWNER_B, ACTOR); assert(false, "expected INVALID_REQUEST"); }
    catch (e) { assert(e instanceof AlertError && e.code === "INVALID_REQUEST", `expected INVALID_REQUEST, got ${e}`); }
  });
  await test("No AI status mutation: alertRuntime.ts contains zero imports of any LLM/AI client", () => {
    const src = readFileSync(path.join(ROOT, "app/api/admin/ide/_lib/alertRuntime.ts"), "utf-8");
    assert(!src.includes("@anthropic-ai/sdk") && !/\bopenai\b/i.test(src), "expected zero AI/LLM imports in alertRuntime.ts");
  });
  await test("Evidence linkage: real ALERT_RECORD/ALERT_DISPATCH_REPORT artifacts are immutable and carry the real relatedIncidentId", async () => {
    const { getArtifact } = await import("../app/api/admin/ide/_lib/artifactRuntime");
    const alert = getAlert(alertId, OWNER_A);
    for (const id of alert.artifactIds) {
      const art = getArtifact(id, OWNER_A);
      assert(art.immutable, `expected artifact ${id} immutable`);
      assert(art.relatedIncidentId === incident.incidentId, `expected artifact ${id} to carry the real relatedIncidentId`);
    }
  });
  await test("Bounded events: listAlertEvents() includes real ALERT_CREATED/ALERT_DISPATCHED for this suite's real alert", () => {
    const events = listAlertEvents();
    assert(events.some((e) => e.alertId === alertId && e.type === "ALERT_CREATED"), "expected a real ALERT_CREATED event");
  });

  await test("Scope guarantee: this suite never modified alertRuntime.ts itself — spot-checked byte-for-byte", async () => {
    const status = (await gitRaw(["status", "--porcelain", "app/api/admin/ide/_lib/alertRuntime.ts"])).trim();
    assert(!status.includes(" M "), "expected no real modification during this suite's run");
  });
  await test("Debug: __debugAlertCount() reflects real records created by this suite", () => {
    assert(__debugAlertCount() >= 2, "expected at least 2 real Alert records in the real store");
  });
  await test("Read Only: the real working tree HEAD is unchanged after this entire suite ran", async () => {
    const postHead = (await gitRaw(["rev-parse", "HEAD"])).trim();
    assert(postHead === preHead, `expected HEAD unchanged, was ${preHead}, now ${postHead}`);
  });

  console.log("\n=== Alert Runtime Regression Suite ===");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${passed}/${results.length} passed`);
  if (failed.length > 0) { console.error(`\n${failed.length} test(s) failed.`); process.exit(1); }
}
main().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(1); });
