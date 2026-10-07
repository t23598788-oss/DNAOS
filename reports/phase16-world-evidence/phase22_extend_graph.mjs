import fs from "node:fs";
import path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf-8"));
const graph = read("evidence_graph.json");
const loop = read("action_loop_result.json");

let edgeSeq = graph.edges.length;
const edge = (from, to, relationship) => graph.edges.push({ edge_id: `p22_e${edgeSeq++}`, from, to, relationship });

graph.nodes.push(
  { id: "BLOCKED_EXAMPLE:bottleneck-score", kind: "CONSTRAINT", statement: loop.mandated_example_trace.reason, decision: loop.mandated_example_trace.decision, origin_registry: "action_loop_result.json", origin_record_id: "mandated_example_trace" },
  { id: "PROVEN_RESOLUTION:async-spawn", kind: "PROVEN_RESOLUTION", ...loop.proven_resolution, origin_registry: "action_loop_result.json", origin_record_id: loop.proven_resolution.resolution_id },
  { id: "CAPABILITY_INDEX_ENTRY:server_hang_or_timeout", kind: "RESOURCE", ...loop.capability_lookup.capability, origin_registry: "capability_index.json", origin_record_id: "server_hang_or_timeout" },
);
edge("PROBLEM_SIGNAL:control", "PROVEN_RESOLUTION:async-spawn", "resolved_by");
edge("CAPABILITY_INDEX_ENTRY:server_hang_or_timeout", "PROVEN_RESOLUTION:async-spawn", "backing_capability");
edge("BLOCKED_EXAMPLE:bottleneck-score", "PROBLEM_SIGNAL:control", "was_not_used_as_evidence_for");

graph.node_kinds_used = [...new Set(graph.nodes.map((n) => n.kind))];
graph.generated_at = new Date().toISOString();
fs.writeFileSync(path.join(DIR, "evidence_graph.json"), JSON.stringify(graph, null, 2), "utf-8");
console.log(JSON.stringify({ node_count: graph.nodes.length, edge_count: graph.edges.length }, null, 2));
