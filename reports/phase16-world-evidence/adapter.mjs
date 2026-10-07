// Deterministic adapter: Phase 16 registries -> ObservationEvent[] (per
// contracts/observation/observation-event.ts) -> a generic evidence graph
// using ONLY the primitives Phase 17 specified (SOURCE, OBSERVATION,
// EVIDENCE, SUBJECT, METRIC, RESOURCE, CONSTRAINT, RELATIONSHIP,
// COMPUTATION, DECISION_STATE). No conclusions are written here — every
// node either restates a registry record verbatim or links two existing
// records. Run with: node reports/phase16-world-evidence/adapter.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));

const evidence = read("evidence_registry.json");
const problems = read("problem_registry.json");
const dbc = read("demand_buyer_channel_registry.json");
const prr = read("price_resource_rules_registry.json");
const computed = read("computed_state.json");

const nodes = [];
const edges = [];
const observationEvents = [];
let edgeSeq = 0;
const edge = (from, to, relationship) => edges.push({ edge_id: `e${edgeSeq++}`, from, to, relationship });

// --- SOURCE + OBSERVATION + SUBJECT + METRIC, one chain per evidence record ---
for (const rec of evidence) {
  const sourceNodeId = `SOURCE:${rec.source_id}`;
  const obsNodeId = `OBSERVATION:${rec.evidence_id}`;
  const subjectNodeId = `SUBJECT:${rec.market_domain}:${rec.geography}`;
  const metricNodeId = `METRIC:${rec.evidence_id}`;

  if (!nodes.find((n) => n.id === sourceNodeId)) {
    nodes.push({ id: sourceNodeId, kind: "SOURCE", source_url: rec.source_url, source_type: rec.source_type });
  }
  if (!nodes.find((n) => n.id === subjectNodeId)) {
    nodes.push({ id: subjectNodeId, kind: "SUBJECT", subject_type: rec.market_domain, geography: rec.geography });
  }

  const observationEvent = {
    observation_id: rec.evidence_id,
    source: { source_id: rec.source_id, source_url: rec.source_url, source_type: rec.source_type, observed_at: rec.observed_at },
    subject: { subject_id: subjectNodeId, subject_type: rec.market_domain, geography: rec.geography, market_domain: rec.market_domain },
    metric: { metric_name: rec.claim_type, value: rec.claim_value, unit: rec.unit },
    extraction_method: rec.extraction_method,
    verification_status: rec.verification_status,
    evidence_status: rec.evidence_status,
    freshness_rule: rec.freshness_rule,
    expires_at: rec.expires_at,
    origin_registry: "evidence_registry.json",
    origin_record_id: rec.evidence_id,
  };
  observationEvents.push(observationEvent);

  nodes.push({ id: obsNodeId, kind: "OBSERVATION", ...observationEvent });
  nodes.push({ id: metricNodeId, kind: "METRIC", metric_name: rec.claim_type, value: rec.claim_value, unit: rec.unit, evidence_status: rec.evidence_status });

  edge(sourceNodeId, obsNodeId, "produced");
  edge(obsNodeId, subjectNodeId, "concerns");
  edge(obsNodeId, metricNodeId, "measures");
}

// --- EVIDENCE nodes: one per problem, linking its supporting observations ---
for (const p of problems) {
  const evidenceNodeId = `EVIDENCE:${p.problem_id}`;
  nodes.push({ id: evidenceNodeId, kind: "EVIDENCE", problem_id: p.problem_id, problem_statement: p.problem_statement, status: p.status, origin_registry: "problem_registry.json", origin_record_id: p.problem_id });
  for (const evId of p.evidence_ids) {
    edge(`OBSERVATION:${evId}`, evidenceNodeId, "supports");
  }
  if (p.no_go_reason) {
    const constraintId = `CONSTRAINT:${p.problem_id}`;
    nodes.push({ id: constraintId, kind: "CONSTRAINT", statement: p.no_go_reason, origin_registry: "problem_registry.json", origin_record_id: p.problem_id });
    edge(constraintId, evidenceNodeId, "blocks");
  }
}

// --- RESOURCE nodes from price_resource_rules_registry.json ---
for (const r of prr.resource_registry) {
  const resNodeId = `RESOURCE:${r.problem_id}`;
  nodes.push({ id: resNodeId, kind: "RESOURCE", ...r, origin_registry: "price_resource_rules_registry.json", origin_record_id: r.problem_id });
  edge(`EVIDENCE:${r.problem_id}`, resNodeId, "requires");
}
for (const rule of prr.business_rules) {
  const ruleNodeId = `CONSTRAINT:rule:${rule.rule_id}`;
  nodes.push({ id: ruleNodeId, kind: "CONSTRAINT", rule_class: rule.rule_class, statement: rule.statement, origin_registry: "price_resource_rules_registry.json", origin_record_id: rule.rule_id });
  for (const pid of rule.applies_to_problem_id.split(",")) {
    edge(ruleNodeId, `EVIDENCE:${pid.trim()}`, "constrains");
  }
}

// --- COMPUTATION + DECISION_STATE nodes, straight from computed_state.json (never re-derived here) ---
for (const cand of computed.candidates) {
  const compNodeId = `COMPUTATION:${cand.problem_id}`;
  nodes.push({ id: compNodeId, kind: "COMPUTATION", problem_id: cand.problem_id, fields: cand, origin_registry: "computed_state.json", origin_record_id: cand.problem_id });
  edge(`EVIDENCE:${cand.problem_id}`, compNodeId, "feeds");
  edge(`RESOURCE:${cand.problem_id}`, compNodeId, "feeds");

  const decisionNodeId = `DECISION_STATE:${cand.problem_id}`;
  nodes.push({ id: decisionNodeId, kind: "DECISION_STATE", problem_id: cand.problem_id, gate_result: cand.capital_gate.gate_result, blocking_fields: cand.capital_gate.blocking_fields, origin_registry: "computed_state.json", origin_record_id: cand.problem_id });
  edge(compNodeId, decisionNodeId, "produces");
}

const graph = {
  generated_at: new Date().toISOString(),
  generator: "reports/phase16-world-evidence/adapter.mjs (deterministic, no AI judgment at run time)",
  node_kinds_used: [...new Set(nodes.map((n) => n.kind))],
  nodes,
  edges,
  observation_events: observationEvents,
};

fs.writeFileSync(path.join(DIR, "evidence_graph.json"), JSON.stringify(graph, null, 2), "utf-8");
console.log(JSON.stringify({ node_count: nodes.length, edge_count: edges.length, observation_event_count: observationEvents.length, node_kinds: graph.node_kinds_used }, null, 2));
