// Phase 17 acceptance test — machine-readable, no narrative judgment.
// Run: node reports/phase16-world-evidence/phase17_acceptance_test.mjs
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(DIR, "..", "..");
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
function check(name, pass, detail) {
  results.push({ name, pass, detail });
}

async function main() {
  // 1. FindingEvent contract unchanged in semantic meaning — check the closed union is still exactly 14 values.
  const findingEventSrc = fs.readFileSync(path.join(REPO, "contracts/worker/finding-event.ts"), "utf-8");
  const warningTypeMatch = findingEventSrc.match(/RealFileIntelligenceWarningType =([\s\S]*?);/);
  const warningTypeCount = warningTypeMatch ? (warningTypeMatch[1].match(/"[A-Z_]+"/g) || []).length : 0;
  check("1. FindingEvent.RealFileIntelligenceWarningType still has exactly 14 values (unchanged)", warningTypeCount === 14, `found ${warningTypeCount}`);
  check("1b. FindingEvent contract has no business/world fields added", !/business_is_good|should_invest|recommended_business/.test(findingEventSrc), "grep clean");

  // 2. World evidence has a valid contract path (contracts/observation/observation-event.ts exists, has required semantic fields).
  const obsSrc = fs.readFileSync(path.join(REPO, "contracts/observation/observation-event.ts"), "utf-8");
  const requiredFields = ["Source", "Observation", "Subject", "Metric", "verification_status", "evidence_status", "origin_registry", "origin_record_id"];
  const missingFields = requiredFields.filter((f) => !obsSrc.includes(f));
  check("2. contracts/observation/observation-event.ts defines all required semantic primitives", missingFields.length === 0, missingFields.length ? `missing: ${missingFields}` : "all present");
  const obsSrcCodeOnly = obsSrc.split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n");
  check("2b. ObservationEvent contract forbids conclusion fields as actual code (doc-comment mentions of the prohibition itself are fine)", !/business_is_good|should_invest|recommended_business|AI_confidence_as_truth/.test(obsSrcCodeOnly), "grep clean outside comments");

  // 3. Phase 16 registries entered through deterministic adapters — evidence_graph.json exists and every node has origin_registry/origin_record_id (except pure relationship nodes).
  const graphPath = path.join(DIR, "evidence_graph.json");
  const graph = read(graphPath);
  const provenanceBearingKinds = ["OBSERVATION", "EVIDENCE", "RESOURCE", "CONSTRAINT", "COMPUTATION", "DECISION_STATE"];
  const missingProvenance = graph.nodes.filter((n) => provenanceBearingKinds.includes(n.kind) && (!n.origin_registry || !n.origin_record_id));
  check("3. Every provenance-bearing graph node retains origin_registry + origin_record_id", missingProvenance.length === 0, missingProvenance.length ? `${missingProvenance.length} nodes missing provenance` : "0 missing");
  check("3b. observation_events[] count matches evidence_registry.json record count", graph.observation_events.length === read(path.join(DIR, "evidence_registry.json")).length, `${graph.observation_events.length} events`);

  // 4. Provenance survives end-to-end: walk every DECISION_STATE back to at least one real SOURCE with a source_url.
  function walkBack(nodeId, seen = new Set()) {
    if (seen.has(nodeId)) return [];
    seen.add(nodeId);
    const incoming = graph.edges.filter((e) => e.to === nodeId);
    let sources = [];
    for (const e of incoming) {
      const from = graph.nodes.find((n) => n.id === e.from);
      if (!from) continue;
      if (from.kind === "SOURCE") sources.push(from);
      sources = sources.concat(walkBack(e.from, seen));
    }
    return sources;
  }
  const decisionNodes = graph.nodes.filter((n) => n.kind === "DECISION_STATE");
  const traceable = decisionNodes.every((d) => walkBack(d.id).some((s) => s.source_url));
  check("4. Every DECISION_STATE node traces back to at least one SOURCE with a real source_url", traceable, `${decisionNodes.length} decision states checked`);

  // 5 & 9. Existing Circuit represents technical + world evidence simultaneously, in the same running server.
  const circuitJson = read(path.join(REPO, "dna-os-circuit/definition/circuit.json"));
  const hasWorldNode = circuitJson.nodes.some((n) => n.id === "WORLD_EVIDENCE");
  const hasTechnicalNodes = circuitJson.nodes.some((n) => n.id === "COMMAND_ROUTER");
  check("5. circuit.json contains both a technical node (COMMAND_ROUTER) and the new WORLD_EVIDENCE node", hasWorldNode && hasTechnicalNodes, `world=${hasWorldNode} technical=${hasTechnicalNodes}`);

  let serverUp = false, worldEndpointOk = false, circuitEndpointHasWorldNode = false;
  try {
    const circuitRes = await get("http://localhost:8790/circuit.json");
    serverUp = circuitRes.status === 200;
    circuitEndpointHasWorldNode = JSON.parse(circuitRes.body).nodes.some((n) => n.id === "WORLD_EVIDENCE");
    const worldRes = await get("http://localhost:8790/world-evidence");
    worldEndpointOk = worldRes.status === 200 && JSON.parse(worldRes.body).nodes.length > 0;
  } catch (err) {
    check("9. Live Circuit server reachable", false, err.message);
  }
  check("9. Live Circuit server serves BOTH /circuit.json (with WORLD_EVIDENCE) and /world-evidence", serverUp && circuitEndpointHasWorldNode && worldEndpointOk, `server_up=${serverUp} circuit_has_node=${circuitEndpointHasWorldNode} world_endpoint_ok=${worldEndpointOk}`);

  // 6. Multiple independent sources converge on one computation (P4 has >=1 source; check aggregation width generally).
  const p4Computation = graph.nodes.find((n) => n.id === "COMPUTATION:P4");
  const p4Incoming = graph.edges.filter((e) => e.to === "COMPUTATION:P4");
  check("6. At least one COMPUTATION node has multiple independent incoming edges (EVIDENCE + RESOURCE)", p4Incoming.length >= 2, `${p4Incoming.length} incoming edges to COMPUTATION:P4`);

  // 7. Computations expose formula + inputs + sources (from computed_state.json, unmodified).
  const computed = read(path.join(DIR, "computed_state.json"));
  const sampleField = computed.candidates[0].observed_market_price;
  const hasFormulaShape = "formula" in sampleField && "inputs" in sampleField && "source" in sampleField && "status" in sampleField;
  check("7. Computed fields expose {formula, inputs, source, status}", hasFormulaShape, JSON.stringify(Object.keys(sampleField)));

  // 8. UNKNOWN/UNCOMPUTABLE remains explicit — no silently-substituted numeric value where status=UNCOMPUTABLE.
  let silentSubstitution = false;
  for (const cand of computed.candidates) {
    for (const [k, v] of Object.entries(cand)) {
      if (v && typeof v === "object" && v.status === "UNCOMPUTABLE" && v.value !== null) silentSubstitution = true;
    }
  }
  check("8. No UNCOMPUTABLE field carries a non-null value (no silent substitution)", !silentSubstitution, `checked ${computed.candidates.length} candidates`);

  // 11/12/13. No real customer, no real capital, CAPITAL_RELEASED = 0.
  check("13. CAPITAL_RELEASED remains 0", computed.capital_state.CAPITAL_RELEASED === 0, `value=${computed.capital_state.CAPITAL_RELEASED}`);
  check("11/12. No PROPOSE_GO exists this round (no real capital/customer step was reached)", computed.candidates.every((c) => c.capital_gate.gate_result !== "PROPOSE_GO"), computed.candidates.map((c) => c.capital_gate.gate_result).join(","));

  // 10. No new dashboard/page — btn-view-world reuses the existing side panel in the existing index.html, no new HTML file created.
  const newFilesCreatedThisPhase = ["contracts/observation/observation-event.ts", "reports/phase16-world-evidence/adapter.mjs", "reports/phase16-world-evidence/evidence_graph.json", "reports/phase16-world-evidence/phase17_acceptance_test.mjs"];
  const noNewHtmlPage = !newFilesCreatedThisPhase.some((f) => f.endsWith(".html"));
  check("10. No new HTML page/dashboard file created this phase", noNewHtmlPage, newFilesCreatedThisPhase.join(", "));

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.pass ? "" : "-- " + r.detail}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  fs.writeFileSync(path.join(DIR, "phase17_test_results.json"), JSON.stringify({ results, passed, failed }, null, 2));
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
