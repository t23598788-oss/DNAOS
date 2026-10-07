import { randomUUID } from "node:crypto";
import { dispatchToAgentHost } from "../agent-gateway/agent-host-dispatch";
import type { AgentLaunchResult, WorkerKind } from "../agent-host/contract";
import { saveEvidence } from "../agent-gateway/memory-store";

export const EXECUTION_TRANSPORT_CONTRACT_VERSION = "1" as const;

export interface ExecutionTransportRequest {
  command_id: string;
  handoff_id: string;
  worker_kind: WorkerKind;
  workspace_dir: string;
  repository_read_paths: readonly string[];
  instruction_argv: readonly string[];
  host_env: Readonly<Record<string, string | undefined>>;
  allowed_operations: readonly string[];
  side_effect_class: "READ_ONLY";
}

export type ExecutionTransportResult =
  | { ok: true; transport_id: string; execution_id: string; evidence_id: string; launch: AgentLaunchResult }
  | { ok: false; transport_id: string; evidence_id: string; reason: string };

/** DNA OS-owned boundary over the existing Agent Host executor. */
export async function executeThroughExistingAgentHost(request: ExecutionTransportRequest): Promise<ExecutionTransportResult> {
  const transport_id = `transport-${randomUUID()}`;
  if (!request.command_id || !request.handoff_id || request.side_effect_class !== "READ_ONLY" || request.allowed_operations.length === 0) {
    const evidence_id = `ev-${randomUUID()}`;
    saveEvidence({ evidence_id, task_id: request.command_id || transport_id, kind: "admission", source: "control/dna-os-execution-transport/contract.ts", recorded_at: new Date().toISOString(), payload: { contract_version: EXECUTION_TRANSPORT_CONTRACT_VERSION, transport_id, status: "REJECTED", reason: "READ_ONLY transport admission incomplete" } });
    return { ok: false, transport_id, evidence_id, reason: "READ_ONLY_TRANSPORT_ADMISSION_INCOMPLETE" };
  }
  const dispatched = await dispatchToAgentHost({
    task_id: request.command_id,
    worker_kind: request.worker_kind,
    workspace_dir: request.workspace_dir,
    instructionArgv: request.instruction_argv,
    hostEnv: request.host_env,
    repositoryReadPaths: request.repository_read_paths,
  });
  const evidence_id = `ev-${randomUUID()}`;
  if (dispatched.status !== "LAUNCHED") {
    saveEvidence({ evidence_id, task_id: request.command_id, kind: "execution_output", source: "control/dna-os-execution-transport/contract.ts", recorded_at: new Date().toISOString(), payload: { contract_version: EXECUTION_TRANSPORT_CONTRACT_VERSION, transport_id, status: dispatched.status, reason: dispatched.reason } });
    return { ok: false, transport_id, evidence_id, reason: dispatched.reason };
  }
  saveEvidence({ evidence_id, task_id: request.command_id, kind: "execution_output", source: "control/dna-os-execution-transport/contract.ts", recorded_at: new Date().toISOString(), payload: { contract_version: EXECUTION_TRANSPORT_CONTRACT_VERSION, transport_id, execution_id: dispatched.launch.launchId, worker_kind: request.worker_kind, launch: dispatched.launch } });
  return { ok: true, transport_id, execution_id: dispatched.launch.launchId, evidence_id, launch: dispatched.launch };
}
