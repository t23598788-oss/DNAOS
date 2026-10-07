import { randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/memory-store";

export interface ExistingLaunchEvidence {
  launch_id: string;
  pid: number;
  parent_pid: number;
  started_at: string;
  completed_at: string;
  exit_code: number | null;
}

export interface AgentSessionBinding {
  worker_instance_id: string;
  runtime_id: string;
  session_id: string;
  work_id: string;
  resource_id: string;
  launch: ExistingLaunchEvidence;
  evidence_id: string;
}

export type SessionBindingResult = { ok: true; binding: AgentSessionBinding } | { ok: false; reason: string };

/** Creates DNA OS identities around an already-persisted real launch; never aliases PID/launchId. */
export function bindExistingLaunch(input: { work_id: string; resource_id: string; launch: ExistingLaunchEvidence; launch_evidence_id: string }): SessionBindingResult {
  if (!input.work_id || !input.resource_id || !input.launch_evidence_id || !input.launch.launch_id || !Number.isInteger(input.launch.pid) || input.launch.pid <= 0) return { ok: false, reason: "REAL_LAUNCH_EVIDENCE_REQUIRED" };
  const binding: AgentSessionBinding = {
    work_id: input.work_id,
    resource_id: input.resource_id,
    worker_instance_id: `worker-instance-${randomUUID()}`,
    runtime_id: `runtime-${randomUUID()}`,
    session_id: `agent-session-${randomUUID()}`,
    launch: input.launch,
    evidence_id: `ev-${randomUUID()}`,
  };
  saveEvidence({ evidence_id: binding.evidence_id, task_id: input.work_id, kind: "execution_output", source: "control/agent-session-lifecycle/contract.ts#bindExistingLaunch", recorded_at: new Date().toISOString(), payload: { binding, launch_evidence_id: input.launch_evidence_id } });
  return { ok: true, binding };
}
