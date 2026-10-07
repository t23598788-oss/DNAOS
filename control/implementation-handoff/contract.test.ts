import assert from "node:assert/strict";
import { createImplementationHandoff } from "./contract";

const result = createImplementationHandoff({
  command_id: "cmd-bootstrap-proof",
  parent_work_id: null,
  failure_id: "failure-agent-work-admission",
  evidence_refs: ["evidence://failure/agent-work-admission"],
  owner_authorization_ref: "owner://bootstrap-authorization",
  requested_outcome: "Create the minimum Agent Work admission boundary",
  failure_boundary: "AGENT_WORK_REQUEST -> IMPLEMENTATION_HANDOFF",
  target_scope: ["control/implementation-handoff"],
  workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",
  allowed_operations: ["read_source", "write_source", "run_tests"],
  side_effect_class: "SOURCE_WRITE",
  executor_requirements: ["authorized development executor", "sandboxed workspace"],
  verification_requirements: ["git diff", "targeted tests", "runtime evidence"],
});

assert.equal(result.ok, true);
if (result.ok) {
  assert.match(result.handoff.handoff_id, /^handoff-/);
  assert.match(result.evidence_id, /^ev-/);
  assert.equal(result.handoff.command_id, "cmd-bootstrap-proof");
}
console.log("PASS: implementation handoff validates and persists through existing agent-gateway evidence");
