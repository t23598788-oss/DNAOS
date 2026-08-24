import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentProvider } from "./contract";

export type WorkerLifecycle = "DISCOVERED" | "REGISTERED" | "READINESS_CHECK" | "READINESS_VERIFIED" | "IDLE" | "RESERVED" | "RUNNING" | "UNKNOWN" | "BLOCKED" | "OFFLINE" | "STALE";
export interface WorkerRegistration { worker_id: string; provider: AgentProvider; runtime_id: string; session_id: string; capabilities: string[]; workspace_scope: string; status: WorkerLifecycle | "BLOCKED_NON_RESUMABLE_SESSION"; heartbeat_at: string; current_task_id: string | null; max_active_tasks: number; safe_to_assign: boolean; last_probe_task_id: string | null; last_probe_evidence_id: string | null; evidence: string[]; identity_verified?: boolean; workspace_verified?: boolean; probe_verified?: boolean; transport_resumable?: boolean; assignment_evidence_verified?: boolean; readiness_verified_at?: string; readiness_evidence_refs?: string[]; transport_verified_at?: string; transport_evidence_ref?: string; last_heartbeat_at?: string; heartbeat_evidence_ref?: string; }
export interface ReadinessProbe { task_id: string; evidence_id: string; ok: boolean; output: { cwd: string; repository_root: string; git_branch: string }; }
export interface ReadinessResult { registration: WorkerRegistration; checks: Record<string, boolean>; probe: ReadinessProbe | null; }

const REGISTRY_FILE = join(process.cwd(), "connections/agent-registry/data/worker-registrations.jsonl");
const CANONICAL_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
const challenges = new Map<string, { registration_id: string; input: Omit<WorkerRegistration, "status" | "safe_to_assign" | "last_probe_task_id" | "last_probe_evidence_id" | "evidence">; expires_at: string }>();

function persist(row: WorkerRegistration): void { mkdirSync(join(process.cwd(), "connections/agent-registry/data"), { recursive: true }); appendFileSync(REGISTRY_FILE, `${JSON.stringify(row)}\n`, { mode: 0o600 }); }
export function persistWorkerRegistration(row: WorkerRegistration): void { persist(row); }
export function listWorkerRegistrations(): WorkerRegistration[] {
  if (!existsSync(REGISTRY_FILE)) return []; const latest = new Map<string, WorkerRegistration>();
  for (const line of readFileSync(REGISTRY_FILE, "utf8").split("\n").filter(Boolean)) { try { const row = JSON.parse(line) as WorkerRegistration; latest.set(row.worker_id, row); } catch { /* ignore malformed history */ } }
  return [...latest.values()];
}

/** A worker may only enter IDLE through this handshake. No process scan or provider name can satisfy the probe. */
export async function registerAndCheckReadiness(input: Omit<WorkerRegistration, "status" | "safe_to_assign" | "last_probe_task_id" | "last_probe_evidence_id" | "evidence">, probe?: () => Promise<ReadinessProbe>): Promise<ReadinessResult> {
  const checks: Record<string, boolean> = {
    runtime_reachable: Boolean(input.runtime_id),
    worker_identity: Boolean(input.worker_id && input.session_id && input.session_id !== "UNKNOWN"),
    capability_declared: input.capabilities.length > 0,
    workspace_scope: input.workspace_scope === CANONICAL_ROOT,
    no_active_task: input.current_task_id === null,
    heartbeat_fresh: Date.now() - new Date(input.heartbeat_at).getTime() <= 60_000,
  };
  const initial: WorkerRegistration = { ...input, status: "READINESS_CHECK", safe_to_assign: false, last_probe_task_id: null, last_probe_evidence_id: null, evidence: Object.entries(checks).map(([key, value]) => `${key}=${value}`) };
  if (Object.values(checks).some((value) => !value) || !probe) { initial.status = Object.values(checks).some((value) => !value) ? "BLOCKED" : "UNKNOWN"; persist(initial); return { registration: initial, checks, probe: null }; }
  let result: ReadinessProbe;
  try { result = await probe(); } catch { initial.status = "BLOCKED"; initial.evidence.push("probe=FAILED"); persist(initial); return { registration: initial, checks, probe: null }; }
  checks.harmless_probe = result.ok && Boolean(result.task_id && result.evidence_id && result.output.repository_root === CANONICAL_ROOT);
  const ready = Object.values(checks).every(Boolean);
  const completed: WorkerRegistration = { ...initial, status: ready ? "IDLE" : "BLOCKED", safe_to_assign: ready, last_probe_task_id: result.task_id, last_probe_evidence_id: result.evidence_id, evidence: [...initial.evidence, `probe_ok=${result.ok}`, `probe_evidence_id=${result.evidence_id}`] };
  persist(completed); return { registration: completed, checks, probe: result };
}

export interface BootstrapRequest { worker_id: string; provider: AgentProvider; runtime_id: string; session_id: string; transport: string; capabilities: string[]; workspace_scope: string; heartbeat_at: string; }
export interface BootstrapChallenge { registration_id: string; challenge_id: string; probe_work_order: { action: "read_runtime_identity"; target: string; mode: "harmless" }; required_evidence: string[]; expires_at: string; }
export interface BootstrapProbeSubmission { challenge_id: string; session_id: string; probe_task_id: string; evidence: { evidence_id: string; cwd: string; repository_root: string; git_branch: string }; completed_at: string; }

export function issueBootstrapChallenge(request: BootstrapRequest): BootstrapChallenge | { error: string } {
  if (!request.worker_id || !request.provider || !request.runtime_id || !request.session_id || request.session_id === "UNKNOWN") return { error: "WORKER_IDENTITY_REQUIRED" };
  if (!Array.isArray(request.capabilities) || request.capabilities.length === 0) return { error: "CAPABILITIES_REQUIRED" };
  if (request.workspace_scope !== CANONICAL_ROOT) return { error: "WORKSPACE_SCOPE_DENIED" };
  const registration_id = `registration-${crypto.randomUUID()}`; const challenge_id = `challenge-${crypto.randomUUID()}`; const expires_at = new Date(Date.now() + 60_000).toISOString();
  const input = { worker_id: request.worker_id, provider: request.provider, runtime_id: request.runtime_id, session_id: request.session_id, capabilities: request.capabilities, workspace_scope: request.workspace_scope, heartbeat_at: request.heartbeat_at, current_task_id: null, max_active_tasks: 1 };
  challenges.set(challenge_id, { registration_id, input, expires_at });
  return { registration_id, challenge_id, probe_work_order: { action: "read_runtime_identity", target: CANONICAL_ROOT, mode: "harmless" }, required_evidence: ["challenge_id", "session_id", "probe_task_id", "evidence_id", "cwd", "repository_root", "git_branch", "completed_at"], expires_at };
}

export async function completeBootstrapProbe(submission: BootstrapProbeSubmission): Promise<ReadinessResult | { error: string }> {
  const challenge = challenges.get(submission.challenge_id); if (!challenge) return { error: "CHALLENGE_NOT_FOUND" }; challenges.delete(submission.challenge_id);
  if (Date.now() > new Date(challenge.expires_at).getTime()) return { error: "CHALLENGE_EXPIRED" };
  if (submission.session_id !== challenge.input.session_id) return { error: "SESSION_ID_MISMATCH" };
  return registerAndCheckReadiness(challenge.input, async () => ({ task_id: submission.probe_task_id, evidence_id: submission.evidence.evidence_id, ok: true, output: { cwd: submission.evidence.cwd, repository_root: submission.evidence.repository_root, git_branch: submission.evidence.git_branch } }));
}
