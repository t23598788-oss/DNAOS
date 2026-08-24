/**
 * หน้าที่: (RETIRED raw path, Owner "DNA OS Single Process Creation Gate
 * — Consolidation", 2026-08-24) — this file used to `spawn("/usr/local/bin/claude",
 * ...)` directly, with the CHILD's full inherited `process.env` (no `env:`
 * override at all) and `cwd: ROOT` (the real repository root, not a
 * confined workspace) — a real, unsandboxed, credential-exposing process
 * creation path independent of `control/agent-host/`. It now routes
 * through the SAME real chain every Agent Host dispatch uses:
 * `control/agent-gateway/contract.ts#runAgentWorkOrder` (Agent Gateway)
 * -> `control/agent-host/contract.ts#launchAgent` (sandbox-exec,
 * credential-stripped environment, workspace-confined writes).
 *
 * Input: none.
 * Output: `registerManagedClaude` -> `unknown` (the real bootstrap
 * response), unchanged external contract.
 * Dependency ที่อนุญาต: ../../control/agent-gateway/contract.ts,
 * ../../control/agent-gateway/types.ts, node:crypto (randomUUID only).
 * สิ่งที่ห้ามแตะ: never re-add `node:child_process`'s `spawn`/`exec`/
 * `execFile`/`fork` to this file.
 */
import { randomUUID } from "node:crypto";
import { runAgentWorkOrder } from "../../control/agent-gateway/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";

const ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
declare const process: { env: Record<string, string | undefined> };
const DNA_OS = process.env.DNA_OS_BOOTSTRAP_URL ?? "http://127.0.0.1:8791";

interface ClaudeLaunch {
  runtime_id: string;
  session_id: string;
  workspace_root: string;
  correlation_token: string;
  heartbeat_at: string;
  probe: { cwd: string; repository_root: string; git_branch: string };
}

async function launchClaude(): Promise<ClaudeLaunch> {
  const correlation_token = `claude-${randomUUID()}`;
  const workOrder: WorkOrder = {
    operation: "MODIFY",
    target_type: "FILE",
    target_path: "(agent-host: no direct file target)",
    requested_change: "claude managed session probe",
    content: "",
    workspace_scope: ROOT,
    mode: "sandbox",
    required_tests: [],
    forbidden_files: [],
    evidence: [],
    agent_run: {
      worker_kind: "CLAUDE",
      instruction: "Return only pwd, repository root, and git branch. Do not modify files.",
      assigned_source_paths: [ROOT],
      dependency_read_paths: [],
      workspace_path: ROOT,
      timeout_ms: 30_000,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };
  const result = await runAgentWorkOrder(workOrder, correlation_token, process.env);
  if (result.status !== "PASS") throw new Error(`CLAUDE_SESSION_NOT_READY:${result.status}:${result.error_code ?? "unknown"}`);
  return {
    runtime_id: `claude-agent-host:${result.launch_id ?? "unknown"}`,
    session_id: result.task_id,
    workspace_root: ROOT,
    correlation_token,
    heartbeat_at: new Date().toISOString(),
    probe: { cwd: result.runtime.workspace, repository_root: ROOT, git_branch: "" },
  };
}

export async function registerManagedClaude(): Promise<unknown> {
  const launch = await launchClaude();
  const bootstrap = await fetch(`${DNA_OS}/workers/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ worker_id: `claude-code:${launch.session_id}`, provider: "claude-code", runtime_id: launch.runtime_id, session_id: launch.session_id, transport: "stdio", capabilities: ["inspect_test"], workspace_scope: launch.workspace_root, heartbeat_at: launch.heartbeat_at }) });
  const challenge = await bootstrap.json() as { registration_id?: string; challenge_id?: string; error?: string };
  if (!bootstrap.ok || !challenge.challenge_id) return { status: "BLOCKED", reason: challenge.error ?? `BOOTSTRAP_HTTP_${bootstrap.status}`, launch };
  const probe_task_id = `probe-${launch.correlation_token}`;
  const evidence_id = `evidence-${launch.correlation_token}`;
  const probe = await fetch(`${DNA_OS}/workers/bootstrap/${encodeURIComponent(challenge.challenge_id)}/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge_id: challenge.challenge_id, session_id: launch.session_id, probe_task_id, evidence: { evidence_id, ...launch.probe }, completed_at: new Date().toISOString() }) });
  const probeBody = await probe.json() as { registration?: { status?: string; safe_to_assign?: boolean } };
  return { status: probe.ok && probeBody.registration?.status === "IDLE" && probeBody.registration.safe_to_assign === true ? "READY" : "BLOCKED", launch, registration_id: challenge.registration_id, challenge_id: challenge.challenge_id, probe_task_id, evidence_id, probe_status: probe.status, readiness: probeBody.registration };
}

declare const fetch: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
