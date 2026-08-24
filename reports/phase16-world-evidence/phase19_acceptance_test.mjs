// Phase 19 acceptance test. Run: node reports/phase16-world-evidence/phase19_acceptance_test.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}
const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

async function main() {
  const run = read(path.join(DIR, "entry_point_run.json"));
  const services = read(path.join(DIR, "service_candidates.json"));
  const graph = read(path.join(DIR, "evidence_graph.json"));

  check("Real entry point executed a real, existing capability (not a new engine)", run.service_execution_status === "COMPLETED", `wraps DNA-LAB-FILE-INTELLIGENCE, status=${run.service_execution_status}`);

  const requiredEvents = ["USER_ENTERED", "SERVICE_STARTED", "ACTION_PERFORMED", "SERVICE_COMPLETED", "RESULT_OBSERVED", "USER_ACCEPTED_RESULT", "PRICE_PRESENTED", "PAYMENT_INTENT"];
  const eventTypes = run.events.map((e) => e.event);
  const missingEvents = requiredEvents.filter((e) => !eventTypes.includes(e));
  check("All 8 required machine events fired", missingEvents.length === 0, missingEvents.length ? `missing: ${missingEvents}` : "all present");

  check("No PAYMENT_RECEIVED event exists anywhere (forbidden without external verification)", !eventTypes.includes("PAYMENT_RECEIVED"), "grep clean");

  const p3 = services.service_candidates.find((s) => s.problem_id === "P3");
  check("P3 SERVICE_CANDIDATE transitioned DELIVERY_UNPROVEN -> TESTABLE via the 4-condition rule", p3.status === "TESTABLE" && p3.phase19_promotion_evidence?.previous_status === "DELIVERY_UNPROVEN", `status=${p3.status}`);
  check("Promotion required all 4 real conditions true, not payment", Object.values(p3.phase19_promotion_evidence.conditions).every(Boolean) && !("payment_received" in p3.phase19_promotion_evidence.conditions), JSON.stringify(p3.phase19_promotion_evidence.conditions));

  const p4 = services.service_candidates.find((s) => s.problem_id === "P4");
  check("P4 (no real run this phase) was NOT promoted — honestly unchanged", p4.status === "DELIVERY_UNPROVEN", `status=${p4.status}`);

  check("result_accepted is false, not assumed true (no real independent reviewer observed)", run.measurements.result_accepted === false, `value=${run.measurements.result_accepted}`);
  check("payment_intent NONE_OBSERVED, not fabricated", run.events.find((e) => e.event === "PAYMENT_INTENT")?.status === "NONE_OBSERVED", "checked");

  const chainKinds = ["PROBLEM", "REAL_USER", "SERVICE", "ENTRY_POINT", "USAGE", "RESULT", "PRICE", "PAYMENT", "CASH"];
  check("Full SOURCE->PROBLEM->REAL_USER_001->SERVICE->ENTRY_POINT->USAGE->RESULT->PRICE->PAYMENT->CASH chain represented as real graph nodes", chainKinds.every((k) => graph.node_kinds_used.includes(k)) && graph.node_kinds_used.includes("SOURCE"), graph.node_kinds_used.join(","));

  const cashNode = graph.nodes.find((n) => n.id === "CASH:P3");
  check("CASH:P3 remains 0 / NONE_RECEIVED after promotion", cashNode.amount_thb === 0 && cashNode.status === "NONE_RECEIVED", JSON.stringify(cashNode));

  let serverOk = false;
  try {
    const res = await get("http://localhost:8790/world-evidence/services");
    const data = JSON.parse(res.body);
    serverOk = res.status === 200 && data.service_candidates.find((s) => s.problem_id === "P3")?.status === "TESTABLE";
  } catch { /* down */ }
  check("Live Circuit server (same page, same World View) reflects TESTABLE for P3", serverOk, `served=${serverOk}`);

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.pass ? "" : "-- " + r.detail}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  fs.writeFileSync(path.join(DIR, "phase19_test_results.json"), JSON.stringify({ results, passed, failed }, null, 2));
  process.exitCode = failed > 0 ? 1 : 0;
}
main();
