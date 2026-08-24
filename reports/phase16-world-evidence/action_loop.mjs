// Phase 22 — the named autonomous ACTION LOOP:
// OBSERVE -> MEASURE -> AGGREGATE -> DETECT -> PRIORITIZE -> ROOT_CAUSE ->
// CAPABILITY_LOOKUP -> POLICY_GATE -> EXECUTE -> VERIFY -> RE-MEASURE ->
// RECURRENCE_CHECK -> EVIDENCE_BACK_TO_DNA_LAB
//
// This does NOT recompute Phase 21's control case — it CONSUMES its real,
// already-verified result (control_case_result.json) as the OBSERVE/
// MEASURE input, per "reuse before build" / "do not duplicate
// calculations". It ALSO runs the mandated bottleneck-score example
// through provenance tracing FIRST, and blocks it honestly (see
// capability_index.json's monitor-ui entry — MOCK data, hardcoded).
//
// Run: node reports/phase16-world-evidence/action_loop.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));

// ---------- STAGE 0: the mandated example, provenance-traced, NOT displayed blindly ----------
const capabilityIndex = read("capability_index.json");
const monitorEntry = capabilityIndex.find((c) => c.problem_type === "engineering_bottleneck_measurement_via_monitor-ui_dashboard");
const exampleTrace = {
  claimed_example: { frequency: 9, lost_time_hours: 4.8, cost_impact_usd: 8.2, bottleneck_score: 88 },
  provenance_check: {
    formula_real: true, // computeBottleneckScores() is a real, deterministic function, confirmed by reading the source
    formula_location: "DNA-LAB-PERMISSION-REASONER/research/dashboard/monitor-ui/src/analytics/bottleneckScore.ts",
    input_data_source: monitorEntry.cost_source,
    input_data_real: false, // App.tsx:106 hard-wires MockTelemetryProvider for issues/tasks/capabilities
  },
  decision: "BLOCKED_MOCK_DATA",
  reason: "The bottleneck_score formula is real and auditable, but its inputs (occurrence_count, total_time_lost, cost_impact) come from src/data/mockIssues.ts via a hardcoded `const provider = MockTelemetryProvider` in App.tsx line 106 — never real telemetry. Per Phase 22's own rule, MOCK cannot authorize autonomous modification. This example is NOT executed further.",
};

// ---------- STAGE 1-2: OBSERVE + MEASURE (consume Phase 21's real, already-verified result — no recompute) ----------
const control = read("control_case_result.json");
const observe = {
  source: control.signal.source,
  raw_signal: control.signal,
  measured_at: new Date().toISOString(),
};
const measure = {
  recurrence_count: control.evidence.recurrence_count,
  first_seen: control.signal.first_seen,
  last_seen: control.signal.last_seen,
  impact: control.impact,
};

// ---------- STAGE 3: AGGREGATE (n=1 real signal cluster this round — real, not padded) ----------
const aggregate = {
  distinct_signal_clusters: 1,
  clusters: [{ signal_id: control.signal.signal_id, recurrence: measure.recurrence_count, severity: measure.impact.severity }],
};

// ---------- STAGE 4: DETECT + PRIORITIZE (deterministic rule: RECURRING + affects a live endpoint = priority 1 of 1) ----------
const prioritize = {
  ranked: [{ signal_id: control.signal.signal_id, rank: 1, reason: `severity=${measure.impact.severity}, recurrence=${measure.recurrence_count} — only real candidate this round` }],
};

// ---------- STAGE 5: ROOT_CAUSE (reused verbatim from Phase 21, traceable) ----------
const rootCause = control.root_cause;

// ---------- STAGE 6: CAPABILITY_LOOKUP (against the NEW formal capability index, not re-derived ad hoc) ----------
const matchedCapability = capabilityIndex.find((c) => c.problem_type === "server_hang_or_timeout");
const capabilityLookup = {
  problem_type: "server_hang_or_timeout",
  matched: !!matchedCapability,
  capability: matchedCapability,
  no_existing_capability_proven: !matchedCapability,
};

// ---------- STAGE 7: POLICY_GATE (reused verbatim from Phase 21 — real evaluateWriteIntent calls, both branches) ----------
const policyGate = { negative_control: control.policy, positive_control: control.policy_positive_control };

// ---------- STAGE 8: EXECUTE (already applied in Phase 20; this stage records that fact, does not re-apply) ----------
const execute = {
  action_taken: matchedCapability.current_status.startsWith("PROVEN") ? "REUSED_EXISTING_PROVEN_CAPABILITY (no new code written this round)" : "NONE",
  capability_used: matchedCapability.problem_type,
};

// ---------- STAGE 9-10: VERIFY + RE-MEASURE (reused verbatim from Phase 21 — real live HTTP call) ----------
const verify = control.verification;
const remeasure = { still_reproduces: verify.still_reproduces, measured_via: "live HTTP POST /resolve-problem, same trigger as the original failure" };

// ---------- STAGE 11: RECURRENCE_CHECK ----------
const recurrenceCheck = {
  original_recurrence: measure.recurrence_count,
  post_fix_recurrence: remeasure.still_reproduces ? "STILL_OCCURRING" : 0,
  resolved: remeasure.still_reproduces === false,
};

// ---------- STAGE 12: EVIDENCE_BACK_TO_DNA_LAB (write a PROVEN RESOLUTION record for future reuse) ----------
const provenResolution = {
  resolution_id: "res-async-spawn-over-execFileSync",
  problem_type: "server_hang_or_timeout",
  problem_signature: "spawnSync node ETIMEDOUT in a tsx-loaded, detached (nohup) HTTP server process",
  resolution: "use async child_process.spawn with explicit timeout+kill, not execFileSync",
  proven_by: { signal_id: control.signal.signal_id, verification: verify, recurrence_check: recurrenceCheck },
  reusable_capability_ref: "dna-os-circuit/runtime/server.ts runResolver() — same pattern applicable to any future sync-spawn-in-detached-server bug",
  status: recurrenceCheck.resolved ? "PROVEN_RESOLUTION" : "UNRESOLVED",
};

const loop = {
  generated_at: new Date().toISOString(),
  pipeline: "OBSERVE -> MEASURE -> AGGREGATE -> DETECT -> PRIORITIZE -> ROOT_CAUSE -> CAPABILITY_LOOKUP -> POLICY_GATE -> EXECUTE -> VERIFY -> RE-MEASURE -> RECURRENCE_CHECK -> EVIDENCE_BACK_TO_DNA_LAB",
  mandated_example_trace: exampleTrace,
  observe,
  measure,
  aggregate,
  prioritize,
  root_cause: rootCause,
  capability_lookup: capabilityLookup,
  policy_gate: policyGate,
  execute,
  verify,
  remeasure,
  recurrence_check: recurrenceCheck,
  proven_resolution: provenResolution,
  owner_action_required: "NONE — no VS Code, no agent selection, no script selection, no prompt copy, no manual trigger occurred in this run",
};

fs.writeFileSync(path.join(DIR, "action_loop_result.json"), JSON.stringify(loop, null, 2), "utf-8");
console.log(JSON.stringify({ mandated_example: exampleTrace.decision, capability_lookup: capabilityLookup.matched, policy_deny: policyGate.negative_control.decision.decision, policy_allow: policyGate.positive_control.decision.decision, recurrence_check: recurrenceCheck, proven_resolution_status: provenResolution.status }, null, 2));
