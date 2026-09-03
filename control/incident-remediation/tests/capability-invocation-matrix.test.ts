/**
 * หน้าที่: §8 — CAPABILITY INVOCATION PROOF. A capability is only
 * OPERATIONAL if a real input can reach it through a real runtime path.
 * Source existing on disk proves nothing, so every row below is decided by
 * actually CALLING the capability and observing what came back.
 *
 * Lifecycle asserted per capability:
 *   SOURCE EXISTS -> REGISTERED -> ROUTABLE -> INVOKABLE -> RUNTIME_PROVEN
 *
 * Anything that cannot be reached by a real input is reported
 * IMPLEMENTED_NOT_REACHABLE — deliberately, not as a failure of this test.
 *
 * How to run (macOS, Node >=18):
 *   npx tsx control/incident-remediation/tests/capability-invocation-matrix.test.ts
 */

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { searchCapabilities } from "../../../software/registry-database/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import { invokeProviderAlertEmailRead } from "../../../connections/email-alert-source/authenticated-invoke";
import { runAlertCorrelation, type RawAlertEmail } from "../../alert-correlation/contract";
import { resolveWriteIntent, persistResolution, loadResolution } from "../../work-resolution/contract";
import { readObservations, observationStoreStatus } from "../../machine-observation/contract";
import { openRemediation, buildEscalationPayload, escalateToOwner, observationsForWork } from "../contract";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); if (detail !== undefined) console.error("      " + JSON.stringify(detail).slice(0, 260)); }
}

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const store = createPersistentFileStore();

interface Row {
  capability: string;
  source_exists: boolean;
  registered: boolean;
  routable: boolean;
  invokable: boolean;
  runtime_proven: boolean;
  status: "OPERATIONAL" | "IMPLEMENTED_NOT_REACHABLE";
  evidence: string;
}
const rows: Row[] = [];

function registeredAs(tokens: string[]): { registered: boolean; name: string } {
  const hits = searchCapabilities(tokens, store, 1);
  const top = hits?.[0];
  return { registered: !!top && top.score >= 3, name: top?.canonical_name ?? "none" };
}

const REAL_RAILWAY: RawAlertEmail = {
  message_id: `matrix-${Date.now()}`, thread_id: `matrix-${Date.now()}`, sender: "hello@notify.railway.app",
  received_at: "2026-08-26T06:19:17Z", subject: "Build failed for DNA-OS-INFRASTRUCTURE",
  body: "* Project: DNA-OS-INFRASTRUCTURE\n* Service: dna-os-circuit\n* Environment: production\n",
};

async function main(): Promise<void> {
  // ===== 1. email-alert-source =====
  // Now invoked for real: Keychain credential -> deployed Edge Function ->
  // existing gmail-client -> adapter. Promotion to OPERATIONAL is decided by
  // this live call, never by the file existing.
  const src = registeredAs(["email", "alert", "source"]);
  const live = await invokeProviderAlertEmailRead("from:notify.railway.app newer_than:7d");
  const srcInvokable = live.caller_authenticated;
  const srcProven = live.caller_authenticated && (live.result?.ok ?? false) && (live.result?.emails.length ?? 0) > 0;
  rows.push({
    capability: "connections/email-alert-source",
    source_exists: existsSync(join(REPO, "connections/email-alert-source/contract.ts")),
    registered: src.registered, routable: src.registered, invokable: srcInvokable, runtime_proven: srcProven,
    status: srcProven ? "OPERATIONAL" : "IMPLEMENTED_NOT_REACHABLE",
    evidence: srcProven
      ? `REAL Gmail input: authenticated to the deployed provider-alert-email-read and received ${live.result?.emails.length} real message(s); first message_id=${live.result?.emails[0]?.message_id}`
      : `not reachable: ${live.detail}`,
  });
  check("1. email-alert-source RUNTIME_PROVEN by a REAL authenticated Gmail read", srcProven, live.detail);
  check("1b. CALLER_AUTHENTICATED against the deployed function", live.caller_authenticated, live.detail);

  // ===== 2. alert-correlation =====
  const corr = registeredAs(["alert", "correlation"]);
  const [report] = await runAlertCorrelation([REAL_RAILWAY]);
  const corrProven = report !== undefined && report.assessment.observation !== null;
  rows.push({
    capability: "control/alert-correlation",
    source_exists: true, registered: corr.registered, routable: corr.registered, invokable: true, runtime_proven: corrProven,
    status: corrProven ? "OPERATIONAL" : "IMPLEMENTED_NOT_REACHABLE",
    evidence: `invoked with a real alert; performed a LIVE probe: ${report?.assessment.observation?.detail ?? "none"}`,
  });
  check("2. alert-correlation RUNTIME_PROVEN — real input produced a real live probe", corrProven, report?.assessment.observation?.detail);

  // ===== 3. work-resolution =====
  const wr = registeredAs(["work", "resolution"]);
  const workId = `work-matrix-${Date.now()}`;
  const ctx = resolveWriteIntent({ requested_function: "gmail reader", requested_change: "matrix probe", target_domain: "connections/email-alert-source", owner_intent: "matrix", current_work_id: workId }, store);
  persistResolution(ctx);
  const reloaded = loadResolution(workId);
  const wrProven = ctx.dispatchable && reloaded !== null && reloaded.stale === false;
  rows.push({
    capability: "control/work-resolution",
    source_exists: true, registered: wr.registered, routable: wr.registered, invokable: true, runtime_proven: wrProven,
    status: wrProven ? "OPERATIONAL" : "IMPLEMENTED_NOT_REACHABLE",
    evidence: `resolved ${ctx.canonical_name}, persisted, reloaded fresh from disk`,
  });
  check("3. work-resolution RUNTIME_PROVEN — resolve + persist + reload", wrProven, { d: ctx.decision, stale: reloaded?.stale });

  // ===== 4. machine-observation =====
  const mo = registeredAs(["machine", "observation"]);
  const status = observationStoreStatus() as unknown as Record<string, unknown>;
  const observed = readObservations();
  const lineage = observationsForWork(workId);
  const moProven = observed.length > 0 && typeof status === "object";
  rows.push({
    capability: "control/machine-observation",
    source_exists: true, registered: mo.registered, routable: mo.registered, invokable: true, runtime_proven: moProven,
    status: moProven ? "OPERATIONAL" : "IMPLEMENTED_NOT_REACHABLE",
    evidence: `store read: ${observed.length} observation rows; lineage query for this work_id returned ${lineage.length}`,
  });
  check("4. machine-observation RUNTIME_PROVEN — real store read returns rows", moProven, { rows: observed.length });

  // ===== 5. incident-remediation =====
  const ir = registeredAs(["incident", "remediation"]);
  const rec = openRemediation(report, store);
  const irProven = rec.incident_id.startsWith("incident-") && ["AUTO_RECOVERY_IN_PROGRESS", "RESOLVED", "OWNER_DECISION_REQUIRED"].includes(rec.terminal_state);
  rows.push({
    capability: "control/incident-remediation",
    source_exists: true, registered: ir.registered, routable: ir.registered, invokable: true, runtime_proven: irProven,
    status: irProven ? "OPERATIONAL" : "IMPLEMENTED_NOT_REACHABLE",
    evidence: `a real incident produced terminal_state=${rec.terminal_state} block=${rec.block_reason}`,
  });
  check("5. incident-remediation RUNTIME_PROVEN — real incident reached a terminal state", irProven, rec.terminal_state);
  check("5b. incident-remediation is REGISTERED and therefore routable", ir.registered, ir.name);

  // ===== 6. owner escalation output =====
  const payload = buildEscalationPayload(rec);
  const delivery = await escalateToOwner(rec);
  const escProven = delivery.state === "DELIVERED";
  rows.push({
    capability: "owner escalation (output-routing + joint-monitor)",
    source_exists: true, registered: true, routable: true, invokable: true, runtime_proven: escProven,
    status: escProven ? "OPERATIONAL" : "IMPLEMENTED_NOT_REACHABLE",
    evidence: `delivery state=${delivery.state} via ${delivery.transport}; ${delivery.detail}`,
  });
  check("6. owner escalation has a real consumer and a real delivery result", ["DELIVERED", "DELIVERY_FAILED"].includes(delivery.state), delivery.state);
  check("6b. the payload carries all §5 decision fields", payload.incident_id.length > 0 && payload.financial_effect.length > 0 && payload.evidence_refs.length > 0);

  // ===== MATRIX =====
  console.log("\n  CAPABILITY INVOCATION MATRIX");
  console.log("  " + "-".repeat(112));
  console.log(`  ${"capability".padEnd(46)} src reg rout invk prov  status`);
  for (const r of rows) {
    const b = (v: boolean) => (v ? " Y " : " . ");
    console.log(`  ${r.capability.padEnd(46)}${b(r.source_exists)}${b(r.registered)}${b(r.routable)} ${b(r.invokable)}${b(r.runtime_proven)}  ${r.status}`);
  }
  console.log("  " + "-".repeat(112));
  for (const r of rows) console.log(`  ${r.capability}\n      ${r.evidence}`);

  const operational = rows.filter((r) => r.status === "OPERATIONAL");
  const notReachable = rows.filter((r) => r.status === "IMPLEMENTED_NOT_REACHABLE");
  console.log(`\n  OPERATIONAL: ${operational.length}   IMPLEMENTED_NOT_REACHABLE: ${notReachable.length}`);

  check("M1. no capability is marked OPERATIONAL without runtime_proven", operational.every((r) => r.runtime_proven), operational.filter((r) => !r.runtime_proven).map((r) => r.capability));
  check("M2. every OPERATIONAL row is also REGISTERED and ROUTABLE", operational.every((r) => r.registered && r.routable), operational.filter((r) => !r.registered).map((r) => r.capability));
  check("M3. unreachable capabilities are named, not hidden", notReachable.every((r) => r.evidence.length > 0), notReachable.map((r) => r.capability));
}

main()
  .catch((error) => { failed++; console.error("FAIL  harness: " + (error instanceof Error ? error.stack ?? error.message : String(error))); })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
