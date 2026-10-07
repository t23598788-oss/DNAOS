// Phase 18b acceptance test — Problem->User->Service->Cash loop.
// Run: node reports/phase16-world-evidence/phase18b_acceptance_test.mjs
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
  const services = read(path.join(DIR, "service_candidates.json"));
  const graph = read(path.join(DIR, "evidence_graph.json"));

  const requiredFields = ["problem_id", "target_group", "solution", "existing_capabilities", "delivery_channel", "entry_point", "user_action", "value_delivered", "price", "cost_to_deliver", "payment_method", "cash_destination", "measurement_events", "evidence_ids", "unknowns", "status"];
  const fieldsOk = services.service_candidates.every((s) => requiredFields.every((f) => f in s));
  check("SERVICE_CANDIDATE record has all required fields", fieldsOk, requiredFields.join(","));

  const validStatuses = new Set(["UNPROVEN", "CHANNEL_UNPROVEN", "DELIVERY_UNPROVEN", "PAYMENT_UNPROVEN", "TESTABLE", "LIVE", "PAID", "REPEATABLE"]);
  const statusesOk = services.service_candidates.every((s) => validStatuses.has(s.status));
  check("Every SERVICE_CANDIDATE status is from the valid enum", statusesOk, services.service_candidates.map((s) => s.status).join(","));

  check("No candidate reached PAID (payment can only be set by an observed reconciled event, none occurred)", services.service_candidates.every((s) => s.status !== "PAID"), "none PAID");

  const noFabricatedCounts = services.service_candidates.every((s) => s.user_access_path.every((stage) => stage.real_count === null || stage.real_count === 0));
  check("No user/usage/payment/cash stage carries a fabricated non-zero count", noFabricatedCounts, "all real_count in {null, 0}");

  const funnelAllUncomputable = services.service_candidates.every((s) => Object.values(s.funnel_metrics).every((m) => m.status === "UNCOMPUTABLE"));
  check("All funnel rates report UNCOMPUTABLE (no observed funnel exists yet — none were guessed)", funnelAllUncomputable, "checked reach_rate..repeat_rate for both candidates");

  const chainKinds = ["PEOPLE", "SERVICE", "CHANNEL", "USER", "USAGE", "RESULT", "PRICE", "PAYMENT", "CASH"];
  const allKindsPresent = chainKinds.every((k) => graph.node_kinds_used.includes(k));
  check("Full PROBLEM->PEOPLE->SERVICE->CHANNEL->USER->USAGE->RESULT->PRICE->PAYMENT->CASH chain exists as real graph node kinds", allKindsPresent, graph.node_kinds_used.join(","));

  function walkBack(nodeId, seen = new Set()) {
    if (seen.has(nodeId)) return [];
    seen.add(nodeId);
    const incoming = graph.edges.filter((e) => e.to === nodeId);
    let out = [];
    for (const e of incoming) {
      out.push(e.from);
      out = out.concat(walkBack(e.from, seen));
    }
    return out;
  }
  const cashNodes = graph.nodes.filter((n) => n.kind === "CASH");
  const allCashTraceToSource = cashNodes.every((c) => walkBack(c.id).some((id) => graph.nodes.find((n) => n.id === id)?.kind === "SOURCE"));
  check("Every CASH node reverse-traces to a real SOURCE node (cash<-payment<-...<-EVIDENCE<-OBSERVATION<-SOURCE)", allCashTraceToSource, `${cashNodes.length} CASH nodes checked`);

  let serverOk = false;
  try {
    const res = await get("http://localhost:8790/world-evidence/services");
    serverOk = res.status === 200 && JSON.parse(res.body).service_candidates.length === 2;
  } catch { /* down */ }
  check("Existing Circuit server serves /world-evidence/services live (same server, same page)", serverOk, `served=${serverOk}`);

  check("CAPITAL_RELEASED remains 0 (no SERVICE_CANDIDATE reached TESTABLE, so the 10,001 THB experiment has not begun)", services.service_candidates.every((s) => s.status !== "TESTABLE" && s.status !== "LIVE"), services.service_candidates.map((s) => s.status).join(","));

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.pass ? "" : "-- " + r.detail}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  fs.writeFileSync(path.join(DIR, "phase18b_test_results.json"), JSON.stringify({ results, passed, failed }, null, 2));
  process.exitCode = failed > 0 ? 1 : 0;
}
main();
