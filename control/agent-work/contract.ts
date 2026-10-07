import { randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/memory-store";

export const AGENT_WORK_CONTRACT_VERSION = "1" as const;

export interface AgentWorkRequest {
  command_id: string;
  work_id: string;
  parent_work_id: string | null;
  owner_request: string;
  work_kind: "READ_ONLY_AGENT_INSPECTION";
  required_capability: string;
  target: string;
  workspace_scope: string;
  side_effect_class: "READ_ONLY";
  authority_ref: string;
  resource_requirements: readonly string[];
  expected_result: string;
  verification_requirements: readonly string[];
}

export type AgentWorkAdmission =
  | { ok: true; admission_id: string; work: AgentWorkRequest; evidence_id: string }
  | { ok: false; reason: "AGENT_WORK_ADMISSION_INCOMPLETE"; missing_fields: readonly string[] };

/** Agent-work boundary; intentionally does not accept or alter FILE WorkOrder. */
export function admitAgentWork(input: AgentWorkRequest): AgentWorkAdmission {
  const required: readonly (keyof AgentWorkRequest)[] = [
    "command_id", "work_id", "owner_request", "required_capability", "target",
    "workspace_scope", "authority_ref", "expected_result",
  ];
  const missing = required.filter((field) => typeof input[field] !== "string" || String(input[field]).trim() === "");
  if (input.resource_requirements.length === 0) missing.push("resource_requirements");
  if (input.verification_requirements.length === 0) missing.push("verification_requirements");
  if (missing.length > 0) return { ok: false, reason: "AGENT_WORK_ADMISSION_INCOMPLETE", missing_fields: missing };

  const admission_id = `agent-work-admission-${randomUUID()}`;
  const evidence_id = `ev-${randomUUID()}`;
  saveEvidence({
    evidence_id,
    task_id: input.work_id,
    kind: "admission",
    source: "control/agent-work/contract.ts#admitAgentWork",
    recorded_at: new Date().toISOString(),
    payload: { contract_version: AGENT_WORK_CONTRACT_VERSION, admission_id, work: input },
  });
  return { ok: true, admission_id, work: input, evidence_id };
}
