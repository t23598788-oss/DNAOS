/**
 * หน้าที่: (RETIRED raw path, Owner "DNA OS Single Process Creation Gate
 * — Consolidation", 2026-08-24) — this file used to `execFile("codex", ...)`
 * directly (bare name, PATH-resolved — never an authority decision) plus
 * two more raw `execFile("/bin/pwd"...)`/`execFile("/usr/bin/git"...)`
 * calls in `runCodexSessionBridge`. `runCodexWorkOrder` now routes
 * through `control/agent-gateway/contract.ts#runAgentWorkOrder` (Agent
 * Gateway -> Agent Host -> sandbox-exec), and the git/pwd probes route
 * through `execution/run/contract.ts#requestProcessExecution` (the
 * Process Gate). No raw `child_process`/`execFile` remains in this file.
 * Codex's own `-s read-only` flag is still passed as defense in depth,
 * never treated as DNA OS's actual security boundary.
 */
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkOrder } from "../../control/agent-gateway/types";
import { validateWorkOrder } from "../../control/agent-gateway/work-order-validator";
import { runAgentWorkOrder } from "../../control/agent-gateway/contract";
import { requestProcessExecution } from "../../execution/run/contract";

const CANONICAL_ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
declare const process: { env: Record<string, string | undefined>; argv: string[]; exitCode?: number; cwd(): string };
const BOOTSTRAP_URL = process.env.DNA_OS_BOOTSTRAP_URL ?? "http://127.0.0.1:8791";

export interface CodexSessionContext { provider: "codex"; runtime_id: string; session_id: string; thread_id?: string; workspace_root: string; transport: string; capabilities: string[]; started_at: string; heartbeat_at: string; correlation_token: string; }
export interface BridgeResult { status: "READY" | "BLOCKED"; reason?: string; context: CodexSessionContext | null; registration_id?: string; challenge_id?: string; probe_task_id?: string; evidence_id?: string; }
export type CodexBridgeResult = { status: "VERIFIED" | "BLOCKED"; files_changed: string[]; tests: string[]; evidence_ref: string; next_action: string | null };

export async function isCodexCliAvailable(): Promise<boolean> {
  const { resolveWorker } = await import("../../control/agent-host/contract");
  return resolveWorker("CODEX").ok;
}

/**
 * Runs a real WorkOrder against Codex THROUGH Agent Host — never a
 * direct spawn/execFile.
 */
export async function runCodexWorkOrder(workOrder: WorkOrder, taskId: string, timeoutMs: number, options: { idempotencyKey?: string } = {}): Promise<{ ok: true; result: CodexBridgeResult } | { ok: false; reason: "SESSION_UNAVAILABLE" | "VALIDATOR_FAILED" | "TIMEOUT" | "EXECUTION_FAILED"; result: CodexBridgeResult }> {
  const validation = validateWorkOrder(workOrder);
  if (!validation.ok) return { ok: false, reason: "VALIDATOR_FAILED", result: { status: "BLOCKED", files_changed: [], tests: [], evidence_ref: `evidence://codex/${taskId}`, next_action: validation.reason_codes.join(",") } };

  const runOrder: WorkOrder = {
    ...workOrder,
    agent_run: {
      worker_kind: "CODEX",
      instruction: workOrder.requested_change,
      assigned_source_paths: [CANONICAL_ROOT],
      dependency_read_paths: [],
      workspace_path: CANONICAL_ROOT,
      timeout_ms: timeoutMs,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };
  const result = await runAgentWorkOrder(runOrder, taskId, process.env);
  if (result.status === "BLOCKED" && result.error_code === "WORKER_NOT_AVAILABLE") {
    return { ok: false, reason: "SESSION_UNAVAILABLE", result: { status: "BLOCKED", files_changed: [], tests: [], evidence_ref: `evidence://codex/${taskId}`, next_action: "CODEX_NOT_AVAILABLE" } };
  }
  if (result.status === "ERROR" && result.error_code === "LAUNCH_TIMEOUT") {
    return { ok: false, reason: "TIMEOUT", result: { status: "BLOCKED", files_changed: [], tests: [], evidence_ref: `evidence://codex/${taskId}`, next_action: "CODEX_TIMEOUT" } };
  }
  if (result.status !== "PASS") {
    return { ok: false, reason: "EXECUTION_FAILED", result: { status: "BLOCKED", files_changed: [], tests: [], evidence_ref: `evidence://codex/${taskId}`, next_action: result.summary || "CODEX_EXECUTION_FAILED" } };
  }
  return { ok: true, result: { status: "VERIFIED", files_changed: [workOrder.target_path], tests: [...workOrder.required_tests], evidence_ref: `evidence://codex/${taskId}`, next_action: null } };
}

function contextFromEnvironment(): CodexSessionContext | null {
  const session_id = process.env.CODEX_SESSION_ID?.trim();
  if (!session_id || session_id === "UNKNOWN") return null;
  const workspace_root = resolve(process.cwd());
  return { provider: "codex", runtime_id: process.env.CODEX_RUNTIME_ID?.trim() ?? "", session_id, ...(process.env.CODEX_THREAD_ID ? { thread_id: process.env.CODEX_THREAD_ID } : {}), workspace_root, transport: process.env.CODEX_TRANSPORT ?? "stdio", capabilities: (process.env.CODEX_CAPABILITIES ?? "inspect").split(",").map((x) => x.trim()).filter(Boolean), started_at: process.env.CODEX_STARTED_AT ?? new Date().toISOString(), heartbeat_at: new Date().toISOString(), correlation_token: process.env.CODEX_CORRELATION_TOKEN?.trim() ?? "" };
}

/** Real pwd/git probes, routed through the Process Gate — never a raw execFile. */
async function processGateProbe(executableId: string, argv: readonly string[]): Promise<string> {
  const result = await requestProcessExecution({ request_id: `pg-req-${randomUUID()}`, parent_work_order_id: null, requester_identity: "connections/agent-registry/codex-session-bridge.ts", executable_id: executableId, argv, cwd: CANONICAL_ROOT });
  if (result.status !== "EXECUTED") throw new Error(`${executableId}:${result.status}:${result.reason ?? ""}`);
  return result.stdout.trim();
}

export async function runCodexSessionBridge(): Promise<BridgeResult> {
  const context = contextFromEnvironment();
  if (!context) return { status: "BLOCKED", reason: "SESSION_ID_REQUIRED_FROM_CODEX_SESSION_CONTEXT", context: null };
  if (!context.runtime_id || !context.correlation_token) return { status: "BLOCKED", reason: "RUNTIME_ID_AND_CORRELATION_TOKEN_REQUIRED", context };
  if (context.workspace_root !== CANONICAL_ROOT) return { status: "BLOCKED", reason: "BLOCKED_WORKSPACE_MISMATCH", context };
  const registration = await fetch(`${BOOTSTRAP_URL}/workers/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ worker_id: `codex:${context.session_id}`, provider: "codex", runtime_id: context.runtime_id, session_id: context.session_id, transport: context.transport, capabilities: context.capabilities, workspace_scope: context.workspace_root, heartbeat_at: context.heartbeat_at }) });
  const registrationBody = await registration.json() as { registration_id?: string; challenge_id?: string; error?: string };
  if (!registration.ok || !registrationBody.challenge_id) return { status: "BLOCKED", reason: registrationBody.error ?? `BOOTSTRAP_HTTP_${registration.status}`, context };
  const cwd = process.cwd(); // real process.cwd() -- no subprocess needed for this one
  const [root, branch] = await Promise.all([
    processGateProbe("git.rev-parse-toplevel", ["rev-parse", "--show-toplevel"]),
    processGateProbe("git.branch-show-current", ["branch", "--show-current"]),
  ]);
  const probe_task_id = `probe-${context.correlation_token}`;
  const evidence_id = `evidence-${context.correlation_token}`;
  const probe = await fetch(`${BOOTSTRAP_URL}/workers/bootstrap/${encodeURIComponent(registrationBody.challenge_id)}/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge_id: registrationBody.challenge_id, session_id: context.session_id, probe_task_id, evidence: { evidence_id, cwd, repository_root: root, git_branch: branch }, completed_at: new Date().toISOString() }) });
  if (!probe.ok) return { status: "BLOCKED", reason: `PROBE_HTTP_${probe.status}`, context, registration_id: registrationBody.registration_id, challenge_id: registrationBody.challenge_id, probe_task_id, evidence_id };
  return { status: "READY", context, registration_id: registrationBody.registration_id, challenge_id: registrationBody.challenge_id, probe_task_id, evidence_id };
}

declare const fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
declare const console: { log(...a: unknown[]): void; error(...a: unknown[]): void };
declare const URL: { new (url: string): { pathname: string } };
declare const importMeta: { url: string };

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  runCodexSessionBridge().then((result) => { console.log(JSON.stringify(result)); process.exitCode = result.status === "READY" ? 0 : 2; }).catch((error) => { console.error(JSON.stringify({ status: "BLOCKED", reason: error instanceof Error ? error.message : String(error) })); process.exitCode = 2; });
}
