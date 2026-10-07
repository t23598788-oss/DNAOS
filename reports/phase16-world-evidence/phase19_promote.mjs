// Phase 19 — extends the graph with REAL_USER_001's real run, and
// deterministically re-evaluates SERVICE_CANDIDATE.status for P3 (the
// candidate whose existing_capability is DNA-LAB-FILE-INTELLIGENCE — the
// exact tool entry_point.mjs just exercised for real).
// Run: node reports/phase16-world-evidence/phase19_promote.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
const graph = read("evidence_graph.json");
const run = read("entry_point_run.json");
const user = read("real_user_001.json");
const services = read("service_candidates.json");

const PID = "P3"; // the candidate this real run actually exercised
let edgeSeq = graph.edges.length;
const edge = (from, to, relationship) => graph.edges.push({ edge_id: `p19_e${edgeSeq++}`, from, to, relationship });

const problemNodeId = `PROBLEM:REAL_USER_001`;
const userNodeId = `REAL_USER:001`;
const entryPointNodeId = `ENTRY_POINT:${PID}`;

graph.nodes.push(
  { id: problemNodeId, kind: "PROBLEM", ...user, origin_registry: "real_user_001.json", origin_record_id: "REAL_USER_001" },
  { id: userNodeId, kind: "REAL_USER", user_id: "REAL_USER_001", origin_registry: "real_user_001.json", origin_record_id: "REAL_USER_001" },
  { id: entryPointNodeId, kind: "ENTRY_POINT", script: "reports/phase16-world-evidence/entry_point.mjs", wraps_capability: "DNA-LAB-FILE-INTELLIGENCE/src/cli.ts", status: "REAL_RUN_COMPLETED", origin_registry: "entry_point_run.json", origin_record_id: run.run_id },
);

edge(problemNodeId, userNodeId, "affects");
edge(userNodeId, entryPointNodeId, "entered");
edge(entryPointNodeId, `SERVICE:${PID}`, "invokes");

// Real events -> real USAGE/RESULT/PRICE/PAYMENT node updates (overwrite the Phase 18b placeholders with real observed data, same node ids).
const usageNode = graph.nodes.find((n) => n.id === `USAGE:${PID}`);
const resultNode = graph.nodes.find((n) => n.id === `RESULT:${PID}`);
const priceNode = graph.nodes.find((n) => n.id === `PRICE:${PID}`);
const paymentNode = graph.nodes.find((n) => n.id === `PAYMENT:${PID}`);
const cashNode = graph.nodes.find((n) => n.id === `CASH:${PID}`);

if (usageNode) Object.assign(usageNode, { real_count: 1, status: "REAL_RUN_OBSERVED", run_id: run.run_id, time_to_result_ms: run.measurements.time_to_result_ms });
if (resultNode) Object.assign(resultNode, { real_count: 1, status: "MEASURED", found: run.result ?? run.before_after?.AFTER_SERVICE, result_accepted: run.measurements.result_accepted });
if (priceNode) Object.assign(priceNode, { status: "REFERENCE_SHOWN_NOT_AGREED", note: "PRICE_PRESENTED event fired, no agreement observed" });
if (paymentNode) Object.assign(paymentNode, { real_count: 0, status: "NONE_OBSERVED — PAYMENT_INTENT not fired this run, PAYMENT_RECEIVED forbidden without external verification" });
if (cashNode) Object.assign(cashNode, { amount_thb: 0, status: "NONE_RECEIVED" });

edge(entryPointNodeId, usageNode?.id ?? `USAGE:${PID}`, "produced_real_usage");
edge(usageNode?.id ?? `USAGE:${PID}`, resultNode?.id ?? `RESULT:${PID}`, "produced_real_result");

// Deterministic TESTABLE-promotion rule — exactly the 4-condition AND from Phase 19's spec.
function reEvaluateStatus(problemId) {
  const svc = services.service_candidates.find((s) => s.problem_id === problemId);
  const realEntryPointExists = problemId === PID; // only P3 has a real entry_point.mjs run this phase
  const realUserEntered = realEntryPointExists && run.events.some((e) => e.event === "USER_ENTERED");
  const serviceCanExecute = realEntryPointExists && run.service_execution_status === "COMPLETED";
  const resultCanBeMeasured = realEntryPointExists && run.events.some((e) => e.event === "RESULT_OBSERVED");
  const allFourConditionsMet = realEntryPointExists && realUserEntered && serviceCanExecute && resultCanBeMeasured;
  return {
    problem_id: problemId,
    previous_status: svc.status,
    conditions: { real_entry_point_exists: realEntryPointExists, real_user_entered: realUserEntered, service_can_execute: serviceCanExecute, result_can_be_measured: resultCanBeMeasured },
    new_status: allFourConditionsMet ? "TESTABLE" : svc.status,
  };
}

const p3Eval = reEvaluateStatus("P3");
const p4Eval = reEvaluateStatus("P4"); // P4 gets no real run this phase — stays DELIVERY_UNPROVEN, honestly

// Apply the promotion to service_candidates.json (only field changed: status; nothing else rewritten).
for (const evalResult of [p3Eval, p4Eval]) {
  const svc = services.service_candidates.find((s) => s.problem_id === evalResult.problem_id);
  svc.status = evalResult.new_status;
  svc.phase19_promotion_evidence = evalResult;
}
services.capital_rule = "CAPITAL_RELEASED = 0. CASH_RECEIVED = 0 unless independently verified. TESTABLE reached for P3 does not authorize spend.";

fs.writeFileSync(path.join(DIR, "service_candidates.json"), JSON.stringify(services, null, 2), "utf-8");

graph.node_kinds_used = [...new Set(graph.nodes.map((n) => n.kind))];
graph.generated_at = new Date().toISOString();
fs.writeFileSync(path.join(DIR, "evidence_graph.json"), JSON.stringify(graph, null, 2), "utf-8");

console.log(JSON.stringify({ p3: p3Eval, p4: p4Eval }, null, 2));
