import { randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/memory-store";
import { recordOwnerVisibleResult } from "../owner-command-semantics/contract";

export function returnAgentResult(input: {
  command_id: string; work_id: string; assignment_id: string; worker_instance_id: string;
  runtime_id: string; session_id: string; launch_id: string; pid: number; exit_code: number | null;
  agent_outcome: "FAILED" | "COMPLETED"; error?: string; raw_request: string;
}): { evidence_id: string } {
  const evidence_id = `ev-${randomUUID()}`;
  const result = { status: input.agent_outcome, process_exit_code: input.exit_code, error: input.error ?? null, execution_id: input.launch_id, worker_instance_id: input.worker_instance_id, runtime_id: input.runtime_id, session_id: input.session_id, assignment_id: input.assignment_id, work_id: input.work_id, evidence_id };
  saveEvidence({ evidence_id, task_id: input.work_id, kind: "execution_output", source: "control/agent-result-return/contract.ts#returnAgentResult", recorded_at: new Date().toISOString(), payload: { command_id: input.command_id, result } });
  recordOwnerVisibleResult(input.command_id, "identity-deadboard-owner", input.raw_request, { command_id: input.command_id, work_id: input.work_id, assignment_id: input.assignment_id, result, evidence_refs: [evidence_id] });
  return { evidence_id };
}
