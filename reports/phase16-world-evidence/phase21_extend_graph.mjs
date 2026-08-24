// Extends evidence_graph.json (additive) with Phase 21's autonomous
// feedback-loop run: SIGNAL -> EVIDENCE -> ROOT_CAUSE -> POLICY -> VERIFY.
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
const graph = read("evidence_graph.json");
const control = read("control_case_result.json");
const testCase1 = read("test_case_1_result.json");
const sources = read("observation_sources.json");

let edgeSeq = graph.edges.length;
const edge = (from, to, relationship) => graph.edges.push({ edge_id: `p21_e${edgeSeq++}`, from, to, relationship });

for (const s of sources.sources) {
  graph.nodes.push({ id: `SOURCE:obs:${s.source_id}`, kind: "SOURCE", source_type: "ambient_observation_source", status: s.status, origin_registry: "observation_sources.json", origin_record_id: s.source_id });
}

graph.nodes.push(
  { id: "PROBLEM_SIGNAL:control", kind: "PROBLEM_SIGNAL", ...control.signal, origin_registry: "control_case_result.json", origin_record_id: control.signal.signal_id },
  { id: "PROBLEM_SIGNAL:testcase1", kind: "PROBLEM_SIGNAL", claim: testCase1.claim, status: testCase1.status, decision: testCase1.decision, origin_registry: "test_case_1_result.json", origin_record_id: "copy-paste-complaint" },
  { id: "ROOT_CAUSE:control", kind: "ROOT_CAUSE", ...control.root_cause, origin_registry: "control_case_result.json", origin_record_id: "root_cause" },
  { id: "POLICY_DECISION:control:deny", kind: "DECISION_STATE", decision: control.policy.decision.decision, reason_codes: control.policy.decision.reason_codes, target: control.policy.intent.target_path, origin_registry: "control_case_result.json", origin_record_id: control.policy.decision.decision_id },
  { id: "POLICY_DECISION:control:allow", kind: "DECISION_STATE", decision: control.policy_positive_control.decision.decision, reason_codes: control.policy_positive_control.decision.reason_codes, target: control.policy_positive_control.intent.target_path, origin_registry: "control_case_result.json", origin_record_id: control.policy_positive_control.decision.decision_id },
  { id: "RESULT:control:verify", kind: "RESULT", ...control.verification, measured_recurrence_after_fix: control.measured_recurrence_after_fix, origin_registry: "control_case_result.json", origin_record_id: "verification" },
);

edge("SOURCE:obs:dna-os-circuit-server-logs", "PROBLEM_SIGNAL:control", "produced");
edge("PROBLEM_SIGNAL:control", "ROOT_CAUSE:control", "explained_by");
edge("ROOT_CAUSE:control", "POLICY_DECISION:control:deny", "evaluated_for_writable_target");
edge("ROOT_CAUSE:control", "POLICY_DECISION:control:allow", "evaluated_for_positive_control_target");
edge("POLICY_DECISION:control:allow", "RESULT:control:verify", "would_authorize");
edge("RESULT:control:verify", "PROBLEM_SIGNAL:control", "verifies_resolution_of");

edge("SOURCE:obs:chatgpt-web", "PROBLEM_SIGNAL:testcase1", "insufficient_to_produce");
edge("SOURCE:obs:vscode-logs", "PROBLEM_SIGNAL:testcase1", "insufficient_to_produce");
edge("SOURCE:obs:claude-code-sessions", "PROBLEM_SIGNAL:testcase1", "insufficient_to_produce");

graph.node_kinds_used = [...new Set(graph.nodes.map((n) => n.kind))];
graph.generated_at = new Date().toISOString();
fs.writeFileSync(path.join(DIR, "evidence_graph.json"), JSON.stringify(graph, null, 2), "utf-8");
console.log(JSON.stringify({ node_count: graph.nodes.length, edge_count: graph.edges.length, node_kinds: graph.node_kinds_used }, null, 2));
