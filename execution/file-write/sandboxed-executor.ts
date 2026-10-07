/**
 * หน้าที่: `executeFileWriteSandboxed()` — the same gate-verified contract
 * as `./executor.ts`'s `executeFileWrite`, but the actual byte-level write
 * happens inside a real, kernel-confined child process
 * (`../../control/agent-host/contract.ts`'s `launchAgent`) instead of
 * in-process — Owner, 2026-08-22 ("Filesystem Jail & Admission Gate", see
 * `/Users/tam/.claude/plans/zesty-spinning-ripple.md`). `./executor.ts`'s
 * own header names the exact gap this closes: "It does not and cannot
 * stop a coding agent... from writing anywhere in this repo completely
 * outside this call chain" — that gap is about a caller BYPASSING
 * `executeFileWrite` entirely, which this file does not change (a caller
 * with raw fs access can still bypass either function equally). What this
 * DOES close is the gap `../tests/bypass-detection.test.ts` names as
 * `BYPASS_STILL_EXISTS`: even a caller that DOES go through this module
 * only had an in-memory `WriteGateDecision` object standing between it
 * and an unbounded `fs.writeFileSync` — a bug in that decision, or in
 * this file's own logic, had no second, independent, physical barrier.
 * Now it does: a write outside `workspaceScope` gets a REAL kernel
 * EPERM/ENOENT from the sandbox, regardless of what this file's own
 * gate-check logic concluded.
 *
 * Gated behind `AGENT_HOST_SANDBOXED_WRITES=1` (default OFF) — see
 * `../../control/agent-gateway/adapters/ai-write-adapter.ts`'s one-line
 * call-site swap. Refuses loud (`SANDBOX_LAUNCH_FAILED`) rather than
 * silently falling back to the unsandboxed path on any launch/parse
 * failure — a jail that fails open is worse than no jail.
 *
 * Input: same `FileWriteRequest` + `WriteGateDecision` as
 * `./executor.ts`'s `executeFileWrite`, plus `workspaceScope` (the real
 * repo-relative scope string `control/agent-gateway/types.ts`'s
 * `WorkOrder.workspace_scope` already carries — this file does not widen
 * or infer scope on its own, it only resolves the caller's own declared
 * scope to an absolute path).
 * Output: `FileWriteResult` — identical shape to `executeFileWrite`'s, so
 * every existing caller/reader of a `FileWriteResult` needs zero changes.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts, ./audit.ts,
 * `../../contracts/write-intent/write-intent.ts` (type only),
 * `../../control/agent-host/contract.ts` (its one public entry point,
 * `launchAgent` — a legitimate contract-to-contract call under
 * Capability Folder Law ข้อ 9, same pattern every other cross-capability
 * call in this repo already uses).
 * สิ่งที่ห้ามแตะ: never call `./host-runtime.ts`'s `writeFileReal`
 * directly from this file — the whole point is that the write happens
 * ONLY inside the launched, sandboxed child. Never widen
 * `allowedWorkspaceDir` beyond the caller's own `workspaceScope`. Never
 * fall back to `executeFileWrite` on a sandbox failure — refuse instead.
 */

import { joinPath, newWriteId, nodeExecPath, nowIso, repoRootDirname } from "./host-runtime";
import { recordWriteAudit } from "./audit";
import type { FileWriteRefusalCode, FileWriteRequest, FileWriteResult } from "./types";
import type { WriteGateDecision } from "../../contracts/write-intent/write-intent";
import { launchAgent } from "../../control/agent-host/contract";

const WORKER_SCRIPT_PATH = joinPath(repoRootDirname(), "execution/file-write/sandboxed-write-worker.mjs");
const SANDBOX_TIMEOUT_MS = 10_000;

function refuse(request: FileWriteRequest, writeId: string, code: FileWriteRefusalCode, gateDecisionValue: string): FileWriteResult {
  const result: FileWriteResult = {
    write_id: writeId,
    correlation_id: request.correlation_id,
    intent_id: request.intent_id,
    gate_decision_id: request.gate_decision_id,
    status: "refused",
    refusal_code: code,
    resolved_path: null,
    bytes_written: null,
    completed_at: nowIso(),
  };
  recordWriteAudit({
    write_id: writeId,
    correlation_id: request.correlation_id,
    requesting_identity_id: request.requesting_identity_id,
    intent_id: request.intent_id,
    gate_decision_id: request.gate_decision_id,
    gate_decision_value: gateDecisionValue,
    operation: request.operation,
    target_path: request.target_path,
    target_type: request.target_type,
    status: "refused",
    refusal_code: code,
    resolved_path: null,
    bytes_written: null,
  });
  return result;
}

interface WorkerOutcome {
  ok: boolean;
  bytesWritten?: number;
  reason?: string;
}

function parseWorkerStdout(stdout: string): WorkerOutcome | null {
  const lastLine = stdout.trim().split("\n").filter(Boolean).pop();
  if (!lastLine) return null;
  try {
    return JSON.parse(lastLine) as WorkerOutcome;
  } catch {
    return null;
  }
}

/**
 * Same gate-verification as `./executor.ts`'s `executeFileWrite` — kept
 * as a literal duplicate rather than a shared helper, matching this
 * repo's own precedent of small, independently-readable gate checks per
 * entry point (e.g. `control/command-router/router.ts`'s per-step
 * functions each re-derive their own outcome shape rather than sharing a
 * generic dispatcher). A future pass could factor this out if a third
 * caller appears; not done here to avoid coupling two execution paths
 * (in-process vs sandboxed) through one shared function this early.
 */
export async function executeFileWriteSandboxed(request: FileWriteRequest, decision: WriteGateDecision | undefined, workspaceScope: string): Promise<FileWriteResult> {
  const writeId = newWriteId();

  if (!decision) return refuse(request, writeId, "NO_GATE_DECISION", "absent");
  if (decision.decision_id !== request.gate_decision_id || decision.intent_id !== request.intent_id) {
    return refuse(request, writeId, "GATE_DECISION_MISMATCH", decision.decision);
  }
  const allowedForOperation =
    (request.operation === "CREATE" && decision.decision === "ALLOW_CREATE") ||
    ((request.operation === "MODIFY" || request.operation === "DELETE" || request.operation === "MOVE" || request.operation === "RENAME") && decision.decision === "ALLOW_MODIFY");
  if (!allowedForOperation) return refuse(request, writeId, "GATE_DECISION_NOT_ALLOW", decision.decision);
  if (request.target_type !== "FILE") return refuse(request, writeId, "UNSUPPORTED_TARGET_TYPE", decision.decision);
  if (request.operation !== "CREATE" && request.operation !== "MODIFY") return refuse(request, writeId, "UNSUPPORTED_OPERATION", decision.decision);
  if (request.content === null || request.content === undefined) return refuse(request, writeId, "MISSING_CONTENT", decision.decision);

  const allowedWorkspaceDir = joinPath(repoRootDirname(), workspaceScope);
  const resolvedPath = joinPath(repoRootDirname(), request.target_path);
  const instruction = JSON.stringify({ operation: request.operation, resolvedPath, content: request.content });

  const launch = await launchAgent(
    { allowedWorkspaceDir, agentExecutable: nodeExecPath(), agentArgv: [WORKER_SCRIPT_PATH, instruction], timeoutMs: SANDBOX_TIMEOUT_MS },
    {},
    [],
  );

  if (launch.timedOut || (launch.exitCode !== 0 && launch.exitCode !== null)) {
    return refuse(request, writeId, "FS_ERROR", decision.decision);
  }
  const outcome = parseWorkerStdout(launch.stdout);
  if (!outcome) return refuse(request, writeId, "FS_ERROR", decision.decision);
  if (!outcome.ok || outcome.bytesWritten === undefined) return refuse(request, writeId, "FS_ERROR", decision.decision);

  const result: FileWriteResult = {
    write_id: writeId,
    correlation_id: request.correlation_id,
    intent_id: request.intent_id,
    gate_decision_id: request.gate_decision_id,
    status: "completed",
    refusal_code: null,
    resolved_path: resolvedPath,
    bytes_written: outcome.bytesWritten,
    completed_at: nowIso(),
  };
  recordWriteAudit({
    write_id: writeId,
    correlation_id: request.correlation_id,
    requesting_identity_id: request.requesting_identity_id,
    intent_id: request.intent_id,
    gate_decision_id: request.gate_decision_id,
    gate_decision_value: decision.decision,
    operation: request.operation,
    target_path: request.target_path,
    target_type: request.target_type,
    status: "completed",
    refusal_code: null,
    resolved_path: resolvedPath,
    bytes_written: outcome.bytesWritten,
  });
  return result;
}
