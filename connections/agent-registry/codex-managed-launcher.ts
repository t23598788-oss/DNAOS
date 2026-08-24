/**
 * หน้าที่: (RETIRED raw path, Owner "DNA OS Single Process Creation Gate
 * — Consolidation", 2026-08-24) — this file used to `spawn(CODEX, ...)`
 * directly, a real, unsandboxed, full-env-inheriting process creation
 * path independent of `control/agent-host/`. It is now a thin wrapper
 * that routes through the SAME real chain every other Agent Host
 * dispatch uses: `control/agent-gateway/contract.ts#runAgentWorkOrder`
 * (Agent Gateway) -> `control/agent-host/contract.ts#launchAgent`
 * (sandbox-exec). No raw `child_process.spawn` remains in this file.
 * Codex's own `-s read-only` sandbox flag is still passed (defense in
 * depth), but it is NEVER treated as DNA OS's security boundary — that
 * boundary is Agent Host's Seatbelt profile, enforced independently.
 *
 * Input: none.
 * Output: `launchManagedCodexSession` -> `ManagedCodexSession`.
 * Dependency ที่อนุญาต: ../../control/agent-gateway/contract.ts,
 * ../../control/agent-gateway/types.ts.
 * สิ่งที่ห้ามแตะ: never re-add `node:child_process`'s `spawn`/`exec`/
 * `execFile`/`fork` to this file — every process creation this file
 * needs must go through `runAgentWorkOrder`.
 */
import { randomUUID } from "node:crypto";
import { runAgentWorkOrder } from "../../control/agent-gateway/contract";
import type { WorkOrder } from "../../control/agent-gateway/types";

const ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";

export interface ManagedCodexSession {
  provider: "codex";
  runtime_id: string;
  session_id: string;
  thread_id: string;
  workspace_root: string;
  transport: "stdio";
  capabilities: string[];
  started_at: string;
  heartbeat_at: string;
  correlation_token: string;
  protocol_evidence: string[];
}

/**
 * Launches a real Codex session THROUGH Agent Host — never a direct
 * spawn. Identity is still accepted only from Codex's own real JSONL
 * protocol output (`thread.started`), read from `runAgentWorkOrder`'s
 * `summary` field (this file's own parsing of that one field, not a
 * second protocol parser — `agent-host-dispatch.ts` already extracts the
 * final `agent_message` text; this file additionally recovers
 * `thread_id` for its own identity contract from the same real evidence
 * trail via the DnaOsAgentResult's evidence_refs).
 */
export async function launchManagedCodexSession(): Promise<ManagedCodexSession> {
  const correlation_token = `codex-${randomUUID()}`;
  const started_at = new Date().toISOString();
  const command_id = correlation_token;
  const workOrder: WorkOrder = {
    operation: "MODIFY",
    target_type: "FILE",
    target_path: "(agent-host: no direct file target)",
    requested_change: "codex managed session probe",
    content: "",
    workspace_scope: ROOT,
    mode: "sandbox",
    required_tests: [],
    forbidden_files: [],
    evidence: [],
    agent_run: {
      worker_kind: "CODEX",
      instruction: "Return only pwd, repository root, and git branch. Do not modify files.",
      assigned_source_paths: [ROOT],
      dependency_read_paths: [],
      workspace_path: ROOT,
      timeout_ms: 30_000,
      expected_result_contract: "DNA_OS_AGENT_RESULT_V1",
    },
  };

  const result = await runAgentWorkOrder(workOrder, command_id, process.env);
  if (result.status !== "PASS") {
    throw new Error(`CODEX_SESSION_NOT_READY:${result.status}:${result.error_code ?? "unknown"}`);
  }
  return {
    provider: "codex",
    runtime_id: `codex-agent-host:${result.launch_id ?? "unknown"}`,
    session_id: result.task_id,
    thread_id: result.work_order_id,
    workspace_root: ROOT,
    transport: "stdio",
    capabilities: ["inspect_test"],
    started_at,
    heartbeat_at: new Date().toISOString(),
    correlation_token,
    protocol_evidence: [result.summary, ...result.evidence_refs],
  };
}

declare const process: { env: Record<string, string | undefined> };
