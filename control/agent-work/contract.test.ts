import { admitAgentWork } from "./contract";

const result = admitAgentWork({
  command_id: "ocmd-agent-work-proof",
  work_id: "work-agent-work-proof",
  parent_work_id: null,
  owner_request: "Inspect the source and runtime and report evidence",
  work_kind: "READ_ONLY_AGENT_INSPECTION",
  required_capability: "agent-host",
  target: "Owner command pipeline",
  workspace_scope: "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",
  side_effect_class: "READ_ONLY",
  authority_ref: "owner-delegated-agent-work",
  resource_requirements: ["authorized-agent-worker"],
  expected_result: "inspection report with evidence",
  verification_requirements: ["persisted-result", "evidence-lineage"],
});
if (!result.ok) throw new Error(`admission rejected: ${result.missing_fields.join(",")}`);
console.log(JSON.stringify({ ok: true, admission_id: result.admission_id, work_id: result.work.work_id, evidence_id: result.evidence_id }));
