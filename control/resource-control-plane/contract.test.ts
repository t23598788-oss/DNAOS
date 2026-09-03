import { bindResourceControl } from "./contract";

const result = bindResourceControl({
  resource_id: "agent-host/local-process",
  control_surface: "LOCAL_PROCESS",
  authority_scope: "owner-delegated/read-only",
  execution_path: "control/dna-os-execution-transport -> control/agent-host/host#launchAgent",
  evidence_source: "control/agent-gateway/memory-store#saveEvidence",
  operations: ["LAUNCH", "CAPTURE_RESULT"],
});
if (!result.ok) throw new Error(`binding rejected: ${result.missing_fields.join(",")}`);
console.log(JSON.stringify({ ok: true, resource_id: result.binding.resource_id, control_surface: result.binding.control_surface }));
