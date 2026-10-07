// Extends evidence_graph.json (additive only, does not touch existing
// nodes/edges) with the PROBLEM -> PEOPLE -> SERVICE -> CHANNEL -> USER ->
// USAGE -> RESULT -> PRICE -> PAYMENT -> CASH chain, per service_candidates.json.
// Every added node's status is real (mostly UNPROVEN/0) — no fabricated counts.
// Run: node reports/phase16-world-evidence/extend_graph_with_services.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
const graph = read("evidence_graph.json");
const services = read("service_candidates.json").service_candidates;

let edgeSeq = graph.edges.length;
const edge = (from, to, relationship) => graph.edges.push({ edge_id: `svc_e${edgeSeq++}`, from, to, relationship });

for (const svc of services) {
  const pid = svc.problem_id;
  const peopleId = `PEOPLE:${pid}`;
  const serviceId = `SERVICE:${pid}`;
  const channelId = `CHANNEL:${pid}`;
  const userId = `USER:${pid}`;
  const usageId = `USAGE:${pid}`;
  const resultId = `RESULT:${pid}`;
  const priceId = `PRICE:${pid}`;
  const paymentId = `PAYMENT:${pid}`;
  const cashId = `CASH:${pid}`;

  graph.nodes.push(
    { id: peopleId, kind: "PEOPLE", target_group: svc.target_group, status: "IDENTIFIED_CATEGORY_ONLY", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: serviceId, kind: "SERVICE", solution: svc.solution, existing_capabilities: svc.existing_capabilities, status: svc.status, origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: channelId, kind: "CHANNEL", status: svc.delivery_channel, note: "candidate channels named from external evidence — no DNA OS usage evidence on any of them yet", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: userId, kind: "USER", real_count: 0, status: "NONE_OBSERVED", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: usageId, kind: "USAGE", real_count: 0, status: "NONE_OBSERVED", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: resultId, kind: "RESULT", real_count: 0, status: "NONE_OBSERVED", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: priceId, kind: "PRICE", value: svc.price, status: "REFERENCE_ONLY_NOT_THAI_CONFIRMED", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: paymentId, kind: "PAYMENT", real_count: 0, status: "NONE_OBSERVED", origin_registry: "service_candidates.json", origin_record_id: pid },
    { id: cashId, kind: "CASH", amount_thb: 0, status: "NONE_RECEIVED", origin_registry: "service_candidates.json", origin_record_id: pid },
  );

  edge(`EVIDENCE:${pid}`, peopleId, "identifies");
  edge(peopleId, serviceId, "targeted_by");
  edge(serviceId, channelId, "delivered_through");
  edge(channelId, userId, "reaches");
  edge(userId, usageId, "generates");
  edge(usageId, resultId, "produces");
  edge(resultId, priceId, "priced_at");
  edge(priceId, paymentId, "requires");
  edge(paymentId, cashId, "settles_to");
  // reverse-traceable by construction: cash <- payment <- price <- result <- usage <- user <- channel <- service <- people <- EVIDENCE <- OBSERVATION <- SOURCE
}

graph.node_kinds_used = [...new Set(graph.nodes.map((n) => n.kind))];
graph.generated_at = new Date().toISOString();
fs.writeFileSync(path.join(DIR, "evidence_graph.json"), JSON.stringify(graph, null, 2), "utf-8");
console.log(JSON.stringify({ node_count: graph.nodes.length, edge_count: graph.edges.length, node_kinds: graph.node_kinds_used }, null, 2));
