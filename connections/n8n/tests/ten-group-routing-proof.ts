/**
 * หน้าที่: the first REAL routing proof — ten events, one per routing group,
 * plus two deliberate anti-loop cases, all sent to the LIVE n8n workflow at
 * `https://n8n.srv1740014.hstgr.cloud/webhook/dna-os-outbound-proof` and
 * routed through the real DNA OS resolver and the real agent gateway.
 *
 * THE EVENTS ARE BUILT FROM REAL SYSTEM STATE, not invented scenarios: the
 * RESOURCE_COMPUTE event carries a real measured work_id and its real
 * evidence_ref; the COST_BILLING event carries the real reason LOCAL_MAC has
 * no rate card; the INFRASTRUCTURE event names the real launchd service on
 * 8788. Where a real failure has not occurred, the event describes a real
 * CONDITION that exists right now rather than a fabricated incident.
 *
 * NOTHING HERE ASSERTS A PASS IT DID NOT GET. Every event's real outcome is
 * printed, including UNRESOLVED_OWNER and a gateway BLOCKED — both are
 * correct results that prove the router refuses to invent an owner and
 * refuses to bypass the gateway.
 *
 * Usage: npx tsx connections/n8n/tests/ten-group-routing-proof.ts
 */

import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { routeDnaOsEvent } from "../contract";
import { ROUTE_GROUPS } from "../types";
import type { DnaOsCentralEvent, RouteGroup, RoutedEventOutcome } from "../types";

const TRACE = `trace-${randomUUID().slice(0, 8)}`;
const OWNER = "owner-tam";
const NOW = new Date().toISOString();

function event(partial: Partial<DnaOsCentralEvent> & { event_type: string; source: string }): DnaOsCentralEvent {
  return {
    event_id: `evt-${randomUUID()}`,
    work_id: null,
    trace_id: TRACE,
    owner_id: OWNER,
    severity: "MEDIUM",
    status: "OPEN",
    message: "",
    capability_id: null,
    resource_id: null,
    error_code: null,
    evidence_ref: null,
    occurred_at: NOW,
    payload: {},
    hop_count: 0,
    origin: "DNA_OS",
    ...partial,
  } as DnaOsCentralEvent;
}

/** One event per group, each anchored in something that is really true today. */
const EVENTS: readonly { expect: RouteGroup; event: DnaOsCentralEvent }[] = [
  {
    expect: "OWNER_COMMAND",
    event: event({
      source: "OWNER_TEXT", event_type: "owner.command.received", severity: "MEDIUM", status: "RECEIVED",
      message: "route DNA OS events through n8n",
      payload: { requested_action: "build owner event agent router", interface: "terminal" },
    }),
  },
  {
    expect: "RUNTIME_ERROR",
    event: event({
      source: "control/recovery-supervisor", event_type: "runtime.service.restarted",
      error_code: "SERVICE_DOWN", severity: "HIGH", status: "OPEN",
      message: "com.dnaos.dna-os-compute-api was restarted by launchctl kickstart -k",
      capability_id: "dna-os-compute-api",
      payload: { launchd_label: "com.dnaos.dna-os-compute-api", observed_pid: 69810, retry_count: 0 },
    }),
  },
  {
    expect: "SECURITY_POLICY",
    event: event({
      source: "credentials/registry", event_type: "credential.reference.read",
      error_code: "AUTH_REQUIRED", severity: "HIGH", status: "OPEN",
      message: "n8n API access requires the keychain-held credential reference",
      payload: { credential_ref: "credential://macos-keychain/dna-os/n8n-api-key", secret_value_included: false },
    }),
  },
  {
    expect: "SOFTWARE_CODE",
    event: event({
      source: "governance/release-gate", event_type: "test.suite.completed",
      severity: "LOW", status: "PASSED",
      message: "13 python tests and the control-plane suite passed",
      payload: { python_tests: 13, typecheck: "clean" },
    }),
  },
  {
    expect: "INFRASTRUCTURE",
    event: event({
      source: "observability/joint-monitor", event_type: "service.health.checked",
      severity: "LOW", status: "HEALTHY",
      message: "dna-os-compute-api answering on 127.0.0.1:8788",
      payload: { port: 8788, bound_interface: "127.0.0.1", public: false, routes_ok: 6 },
    }),
  },
  {
    expect: "DATABASE_DATA",
    event: event({
      source: "research/storage", event_type: "database.rowcount.observed",
      severity: "INFO", status: "OBSERVED",
      message: "research.db executions grew after the live regression run",
      payload: { database: "research.db", table: "executions", rows: 110, with_per_process_cpu: 9 },
    }),
  },
  {
    expect: "RESOURCE_COMPUTE",
    event: event({
      source: "research/measurements/process_probe.py", event_type: "measurement.work.completed",
      severity: "INFO", status: "COMPLETED",
      message: "per-process measurement completed for a real work item",
      capability_id: "real-work-resource-cost-measurement",
      work_id: "work-7145629f0694",
      evidence_ref: "research.db:executions:exec-ad5e2b25e717|raw_measurements:exp-real-work-7279362f::002d8880",
      payload: { process_id: 71196, duration_ms: 1391.474708, cpu_total_ms: 1353.194, resource_status: "PARTIAL" },
    }),
  },
  {
    expect: "COST_BILLING",
    event: event({
      source: "research/measurements/work_cost.py", event_type: "cost.calculation.completed",
      error_code: "RATE_CARD_MISSING", severity: "MEDIUM", status: "NOT_MEASURED",
      message: "LOCAL_MAC has no published $/hour, so TOTAL_ACTUAL_COST is NOT_MEASURED",
      capability_id: "real-work-resource-cost-measurement",
      payload: { compute_source_id: "LOCAL_MAC", total_cost_usd_micros: null, never_substituted_with_zero: true },
    }),
  },
  {
    expect: "EXTERNAL_INTEGRATION",
    event: event({
      source: "connections/n8n/outbound-webhook.ts", event_type: "webhook.outbound.sent",
      severity: "INFO", status: "DELIVERED",
      message: "DNA OS event delivered to the n8n orchestration workflow",
      payload: { workflow_id: "jiNltcrOhck2wYtM", direction: "DNA_OS_TO_N8N", inbound_port_opened: false },
    }),
  },
  {
    expect: "EVIDENCE_VERIFICATION",
    event: event({
      source: "research/experiments/verify_real_work.py", event_type: "verification.segment.reported",
      error_code: "EVIDENCE_MISSING", severity: "MEDIUM", status: "UNKNOWN",
      message: "network and GPU per-process metrics are NOT_MEASURED with an OS-level reason",
      capability_id: "real-work-resource-cost-measurement",
      evidence_ref: "research/reports/frozen_work_evidence.jsonl",
      payload: { not_measured_fields: ["network_in_bytes", "network_out_bytes", "gpu_runtime_ms"], zeros_substituted: 0 },
    }),
  },
];

async function main(): Promise<void> {
  const outcomes: RoutedEventOutcome[] = [];
  let classified = 0, resolved = 0, unresolvedOwner = 0, loops = 0, dispatched = 0;

  console.log("=".repeat(100));
  console.log(`TEN-GROUP ROUTING PROOF   trace_id=${TRACE}   live n8n workflow jiNltcrOhck2wYtM`);
  console.log("=".repeat(100));
  console.log(`${"EXPECTED".padEnd(24)}${"CLASSIFIED".padEnd(24)}${"SIGNAL".padEnd(20)}${"OWNER".padEnd(34)}STATUS`);

  for (const spec of EVENTS) {
    const outcome = await routeDnaOsEvent(spec.event);
    outcomes.push(outcome);
    const group = outcome.decision?.route_group ?? null;
    const correct = group === spec.expect;
    if (correct) classified += 1;
    if (outcome.resolution.resolved) resolved += 1;
    if (outcome.route_status === "UNRESOLVED_OWNER") unresolvedOwner += 1;
    if (outcome.route_status === "LOOP_DETECTED") loops += 1;
    if (outcome.dispatch) dispatched += 1;

    console.log(
      `${spec.expect.padEnd(24)}${String(group ?? "-").padEnd(24)}` +
      `${String(outcome.decision?.classification_signal ?? "-").padEnd(20)}` +
      `${String(outcome.resolution.capability_id ?? "UNRESOLVED_OWNER").padEnd(34)}` +
      `${outcome.route_status}${correct ? "" : "   <-- MISCLASSIFIED"}` +
      `${outcome.dispatch ? `  dispatch=${outcome.dispatch.STATUS}` : ""}`,
    );
  }

  // --- anti-loop, proven rather than asserted ---------------------------
  console.log("\nANTI-LOOP");
  const replay = await routeDnaOsEvent(EVENTS[0].event);
  console.log(`  duplicate event_id        -> ${replay.route_status}  (${replay.hops.at(-1)?.ERROR_CODE ?? "-"})`);
  const overHop = await routeDnaOsEvent(event({
    source: "DNA_OS", event_type: "owner.command.received", hop_count: 11,
    message: "an event that has already been passed around eleven times",
  }));
  console.log(`  hop_count 11 > MAX_HOPS 10 -> ${overHop.route_status}  (${overHop.hops.at(-1)?.ERROR_CODE ?? "-"})`);
  const loopProven = replay.route_status === "LOOP_DETECTED" && overHop.route_status === "LOOP_DETECTED";

  // --- observability: every hop, for the Control Workspace line ----------
  const allHops = outcomes.flatMap((o) => o.hops);
  console.log("\nOBSERVABILITY");
  console.log(`  hop records: ${allHops.length}  (every one carries FROM/TO/EVENT_ID/TRACE_ID/START/END/DURATION_MS/STATUS)`);
  const withoutEvidence = outcomes.filter((o) => !o.evidence_ref).length;

  const report = {
    trace_id: TRACE,
    generated_at: new Date().toISOString(),
    workflow_id: outcomes[0]?.decision?.workflow_id ?? null,
    groups_supported: ROUTE_GROUPS,
    events_tested: EVENTS.length,
    classified_correctly: classified,
    routed_success: outcomes.filter((o) => o.route_status === "ROUTED").length,
    routed_failed: outcomes.filter((o) => o.route_status !== "ROUTED" && o.route_status !== "UNRESOLVED_OWNER").length,
    unresolved_owner: unresolvedOwner,
    resolved_owner: resolved,
    dispatched: dispatched,
    loop_detected_cases: { duplicate_event_id: replay.route_status, over_max_hops: overHop.route_status },
    loop_guard_proven: loopProven,
    events_without_evidence_ref: withoutEvidence,
    hop_records: allHops,
    outcomes: outcomes.map((o) => ({
      event_id: o.event.event_id, event_type: o.event.event_type, source: o.event.source,
      route_group: o.decision?.route_group ?? null,
      classification_signal: o.decision?.classification_signal ?? null,
      classification_matched: o.decision?.classification_matched ?? null,
      capability_id: o.resolution.capability_id,
      capability_source: o.resolution.capability_source,
      permission_requirement: o.resolution.permission_requirement,
      considered: o.resolution.considered,
      route_status: o.route_status,
      dispatch_status: o.dispatch?.STATUS ?? null,
      dispatch_error: o.dispatch?.ERROR_CODE ?? null,
      order_forbidden_actions: o.order?.FORBIDDEN_ACTIONS ?? null,
      evidence_ref: o.evidence_ref,
    })),
  };
  const path = `connections/n8n/evidence/ten-group-routing-proof-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));

  console.log("\nSUMMARY");
  console.log(`  EVENTS_TESTED        : ${report.events_tested}`);
  console.log(`  CLASSIFIED_CORRECTLY : ${report.classified_correctly}/${report.events_tested}`);
  console.log(`  ROUTED_SUCCESS       : ${report.routed_success}`);
  console.log(`  ROUTED_FAILED        : ${report.routed_failed}`);
  console.log(`  UNRESOLVED_OWNER     : ${report.unresolved_owner}`);
  console.log(`  LOOP_GUARD_PROVEN    : ${report.loop_guard_proven}`);
  console.log(`  NO_EVIDENCE_REF      : ${report.events_without_evidence_ref}`);
  console.log(`  evidence             : ${path}`);
}

main().catch((error) => { console.error("PROOF RUN FAILED:", error); process.exit(1); });
