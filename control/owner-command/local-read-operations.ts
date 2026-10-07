import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { saveEvidence } from "../agent-gateway/memory-store";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const run = promisify(execFile);
export const WORKSPACE = "/Users/tam/Desktop/dna-os-control-workspace";

export type LocalReadRequest = {
  task_id?: string; owner_session_id?: string; requested_operation?: string;
  target?: string; workspace_scope?: string; allowed_operations?: string[];
  side_effect_policy?: string; expected_result?: string; verification_requirement?: string; idempotency_key?: string;
  /**
   * PIPE B lineage carriers. Without these the evidence this executor writes
   * could not be traced back past its own operation_id: capability_id was the
   * hardcoded slug "execution", resource_id was always null, and the owning
   * command was not recorded at all. Optional so every existing caller keeps
   * working unchanged; when absent the field is reported null, never guessed.
   */
  command_id?: string; canonical_capability_id?: string; resource_id?: string;
};

const wrap = (request: LocalReadRequest, command: string | null, result: unknown) => ({
  operation_id: randomUUID(),
  idempotency_key: request.idempotency_key ?? null,
  task_id: request.task_id ?? null, owner_session_id: request.owner_session_id ?? null,
  operation: request.requested_operation ?? null, target: request.target ?? "workspace",
  workspace_scope: WORKSPACE,
  // Canonical capability identity when the caller resolved one; the legacy
  // "execution" slug remains only as a fallback so nothing that already
  // depends on it breaks.
  capability_id: request.canonical_capability_id ?? (request.requested_operation ? "execution" : null),
  command_id: request.command_id ?? null,
  resource_id: request.resource_id ?? null, executor: "DNA-OS Core :8791 / control/owner-command/local-read-operations.ts",
  command, side_effect: "NONE", started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
  observed_at: new Date().toISOString(), result,
});
/**
 * PIPE B fix (Owner, 2026-08-31): the duplicate key now REQUIRES the caller's
 * explicit `idempotency_key`. Before this, the key was the operation shape
 * alone, so every later command issuing the same operation collapsed onto the
 * first run ever recorded and inherited its envelope - a fresh command was
 * answered with another session's task_id and a day-old runtime observation.
 * Idempotency is a promise the CALLER makes by supplying a key; it is not an
 * excuse to hand one command another command's evidence.
 */
function canonicalKey(request: LocalReadRequest): string | null {
  if (!request.requested_operation || !request.workspace_scope) return null;
  if (!request.idempotency_key) return null;
  return JSON.stringify({ idempotency_key: request.idempotency_key, operation: request.requested_operation, target: request.target ?? "workspace", workspace_scope: WORKSPACE, allowed_operations: [...(request.allowed_operations ?? [])].sort(), side_effect_policy: request.side_effect_policy ?? "READ_ONLY" });
}
function findExisting(request: LocalReadRequest): any | null {
  const key = canonicalKey(request); if (!key) return null;
  try {
    const file = join(process.cwd(), "control/agent-gateway/data/evidence.jsonl");
    const lines = readFileSync(file, "utf8").split("\n").reverse();
    for (const line of lines) {
      try { const row = JSON.parse(line); const p = row.payload?.resultEnvelope ?? row.payload; if (row.kind !== "execution_output" || !p || p.executor !== "DNA-OS Core :8791 / control/owner-command/local-read-operations.ts") continue; if (canonicalKey({ ...p, requested_operation: p.operation, workspace_scope: p.workspace_scope, allowed_operations: [p.operation] }) === key) return p; } catch { /* malformed historical row is not a match */ }
    }
  } catch { /* unavailable history means duplicate resolution is unknown */ }
  return null;
}
async function sh(file: string, args: string[], timeout = 10_000) { return await run(file, args, { cwd: WORKSPACE, timeout, maxBuffer: 1024 * 1024 }); }

export async function executeLocalRead(request: LocalReadRequest) {
  const op = request.requested_operation;
  if (!op || (request.target !== undefined && request.target !== "workspace" && request.target !== WORKSPACE)) return wrap(request, null, { status: "BLOCKED", reason: "WORKSPACE_SCOPE_NOT_ALLOWED" });
  if (request.side_effect_policy && request.side_effect_policy !== "READ_ONLY") return wrap(request, null, { status: "BLOCKED", reason: "READ_ONLY_REQUIRED" });
  const existing = findExisting(request);
  if (existing) {
    // Re-stamp with the CURRENT command's identity and say plainly that the
    // observation was reused, including when it was actually taken. The caller
    // must never be told a stale reading is a fresh one.
    return {
      ...existing,
      command_id: request.command_id ?? null,
      task_id: request.task_id ?? existing.task_id ?? null,
      owner_session_id: request.owner_session_id ?? null,
      duplicate_status: "EXACT_DUPLICATE_COMPLETED",
      existing_operation_id: existing.operation_id,
      reused_from_operation_id: existing.operation_id,
      reused_observed_at: existing.observed_at ?? null,
      runtime_freshly_observed: false,
      new_work_created: false,
      evidence_refs: [`local-operation-${existing.operation_id}`],
    };
  }
  if (op === "AGENT_EXECUTION") return wrap(request, null, { status: "RESOURCE_UNAVAILABLE", capability: "AGENT_EXECUTION", reason: "NO_RESOLVED_AGENT_SESSION" });
  if (op === "UI_OBSERVE" || op === "UI_ACTION") return wrap(request, null, { status: "RESOURCE_UNAVAILABLE", capability: "UI_CONTROL", reason: "NO_CORE_CALLABLE_UI_RESOURCE" });
  try {
    const startedAt = new Date().toISOString();
    if (op === "READ_GIT") {
      const [b, r, s, d] = await Promise.all([sh("git", ["branch", "--show-current"]), sh("git", ["rev-parse", "HEAD"]), sh("git", ["status", "--short"]), sh("git", ["diff", "--stat"])]);
      const output = wrap(request, "git branch/rev-parse/status/diff --stat", { status: "OBSERVED", branch: b.stdout.trim(), revision: r.stdout.trim(), status_lines: s.stdout.trim() ? s.stdout.trim().split("\n") : [], diff_summary: d.stdout.trim() });
      persistEvidence(output, startedAt); return output;
    }
    if (op === "INSPECT_PROCESS") { const r = await sh("ps", ["-axo", "pid,ppid,etime,command"]); const output = wrap(request, "ps -axo pid,ppid,etime,command", { status: "OBSERVED", matching_processes: r.stdout.trim().split("\n").filter((x) => /node|server\\.mjs|Code|Claude|dna-os/i.test(x)) }); persistEvidence(output, startedAt); return output; }
    if (op === "CHECK_RUNTIME") { const h = await sh("curl", ["-fsS", "--max-time", "5", "http://127.0.0.1:5181/api/health"]); const g = await sh("curl", ["-fsS", "--max-time", "5", "http://127.0.0.1:8791/graph/system"]); const graph = JSON.parse(g.stdout); const output = wrap(request, "curl GET /api/health + GET /graph/system", { status: "OBSERVED", health: JSON.parse(h.stdout), graph: { nodes: graph.nodes?.length ?? 0, edges: graph.edges?.length ?? 0 } }); persistEvidence(output, startedAt); return output; }
    if (op === "RUN_TEST") { const test = request.expected_result?.startsWith("test/") ? request.expected_result : "test/acceptance.mjs"; if (!/^test\/[A-Za-z0-9._-]+\.mjs$/.test(test)) return wrap(request, null, { status: "BLOCKED", reason: "TEST_NOT_ALLOWLISTED" }); const r = await sh("node", [test], 90_000); const output = wrap(request, `node ${test}`, { status: "OBSERVED", stdout: r.stdout.trim(), stderr: r.stderr.trim() }); persistEvidence(output, startedAt); return output; }
    return wrap(request, null, { status: "UNRESOLVED", reason: "LOCAL_OPERATION_NOT_IMPLEMENTED" });
  } catch (error) { return wrap(request, null, { status: "FAIL", error: error instanceof Error ? error.message : String(error) }); }
}

function persistEvidence(output: ReturnType<typeof wrap>, startedAt: string): void {
  saveEvidence({ evidence_id: `local-operation-${output.operation_id}`, task_id: output.task_id ?? `local-${output.operation_id}`, kind: "execution_output", source: output.executor, recorded_at: output.observed_at, payload: { ...output, idempotency_key: (output as any).idempotency_key ?? null, resultEnvelope: output, started_at: startedAt } });
}
