import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { persistWorkerRegistration, listWorkerRegistrations, type WorkerRegistration } from "./worker-registration";

export type AssignmentStatus = "ASSIGNED" | "DISPATCHED" | "ACCEPTED" | "RUNNING" | "EVIDENCE_RECEIVED" | "EVIDENCE_VALIDATED" | "COMPLETED" | "WORKER_RELEASED" | "FAILED";
export interface AssignmentRecord { assignment_id: string; task_id: string; worker_id: string; provider: string; runtime_id: string; session_id: string; capability: string; correlation_token: string; status: AssignmentStatus; evidence_id?: string; updated_at: string; }
const FILE = join(process.cwd(), "connections/agent-registry/data/assignments.jsonl");
function persist(row: AssignmentRecord): void { mkdirSync(join(process.cwd(), "connections/agent-registry/data"), { recursive: true }); appendFileSync(FILE, `${JSON.stringify(row)}\n`, { mode: 0o600 }); }
export function completeAssignment(record: AssignmentRecord, evidenceId: string): { assignment: AssignmentRecord; worker: WorkerRegistration } {
  const now = new Date().toISOString();
  const completed = { ...record, status: "COMPLETED" as const, evidence_id: evidenceId, updated_at: now }; persist({ ...record, status: "EVIDENCE_RECEIVED", evidence_id: evidenceId, updated_at: now }); persist({ ...record, status: "EVIDENCE_VALIDATED", evidence_id: evidenceId, updated_at: now }); persist(completed);
  const worker = listWorkerRegistrations().find((entry) => entry.worker_id === record.worker_id);
  if (!worker) throw new Error("WORKER_REGISTRATION_NOT_FOUND");
  const released: WorkerRegistration = { ...worker, status: "IDLE", safe_to_assign: true, current_task_id: null, heartbeat_at: now, transport_resumable: true, transport_verified_at: now, transport_evidence_ref: evidenceId, last_probe_evidence_id: worker.last_probe_evidence_id ?? evidenceId, evidence: [...worker.evidence, `assignment_evidence_verified=true`, `assignment_evidence_id=${evidenceId}`] };
  persistWorkerRegistration(released);
  const releasedAssignment = { ...completed, status: "WORKER_RELEASED" as const, updated_at: new Date().toISOString() }; persist(releasedAssignment);
  return { assignment: releasedAssignment, worker: released };
}
