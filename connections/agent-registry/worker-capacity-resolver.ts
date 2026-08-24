import { buildSessionRegistry, type SessionRegistryEntry } from "./session-registry";
import { listWorkerRegistrations } from "./worker-registration";

export interface WorkerCapacityRequest { capability: string; required_count?: number; }
export interface AssignableWorker { agent_id: string; runtime_id: string | null; session_id: string; process_id: number | null; capabilities: readonly string[]; heartbeat: string; }
export interface WorkerCapacityResult { capability: string; available_workers: AssignableWorker[]; max_concurrency: number; evidence: string[]; resolved_at: string; }

export function hasStrictReadiness(entry: (SessionRegistryEntry | ReturnType<typeof listWorkerRegistrations>[number]) & Record<string, unknown>): boolean {
  return entry.status === "IDLE" && entry.safe_to_assign === true && entry.current_task_id === null &&
    entry.identity_verified === true && entry.workspace_verified === true && entry.probe_verified === true &&
    entry.transport_resumable === true && entry.assignment_evidence_verified === true &&
    Boolean(entry.readiness_verified_at && Array.isArray(entry.readiness_evidence_refs) && entry.readiness_evidence_refs.length > 0) &&
    Date.now() - new Date(String(entry.heartbeat ?? entry.heartbeat_at)).getTime() <= 60_000;
}

/** Capability matching is explicit: exact capability or the registered wildcard. No role/provider inference. */
export function selectAssignableWorkers(entries: readonly SessionRegistryEntry[], capability: string): AssignableWorker[] {
  return entries.filter((entry) => entry.status === "IDLE" && entry.safe_to_assign && entry.capabilities.some((candidate) => candidate === capability || candidate === "*"))
    .map((entry) => ({ agent_id: entry.agent_id, runtime_id: entry.runtime_id, session_id: entry.session_id, process_id: entry.process_id, capabilities: entry.capabilities, heartbeat: entry.heartbeat }));
}

/** Live resolver: reads the canonical Session Registry on every call. It never creates, marks, or assumes a worker. */
export async function resolveWorkerCapacity(request: WorkerCapacityRequest): Promise<WorkerCapacityResult> {
  const entries = await buildSessionRegistry();
  const sessionWorkers = selectAssignableWorkers(entries, request.capability);
  const registeredWorkers = listWorkerRegistrations().filter((worker) => hasStrictReadiness(worker as typeof worker & Record<string, unknown>) && worker.capabilities.some((candidate) => candidate === request.capability || candidate === "*"))
    .map((worker) => ({ agent_id: worker.worker_id, runtime_id: worker.runtime_id, session_id: worker.session_id, process_id: null, capabilities: worker.capabilities, heartbeat: worker.heartbeat_at }));
  const byId = new Map([...sessionWorkers, ...registeredWorkers].map((worker) => [worker.agent_id, worker]));
  const available_workers = [...byId.values()];
  return {
    capability: request.capability,
    available_workers,
    max_concurrency: available_workers.length,
    resolved_at: new Date().toISOString(),
    evidence: [
      "source=connections/agent-registry/session-registry.ts + worker-registration.ts",
      `candidate_entries=${entries.length}`,
      `eligible_workers=${available_workers.length}`,
      "eligibility=status=IDLE && safe_to_assign=true && exact_capability_match",
    ],
  };
}
