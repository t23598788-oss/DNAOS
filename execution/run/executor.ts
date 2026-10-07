/**
 * หน้าที่: the execution core — ported from the old repo's real, proven
 * `app/api/admin/ide/_lib/executionRuntime.ts` (see
 * `../../reports/EXECUTION_MIGRATION_PLAN.md`). Resolves a `command_id`
 * through `./registry.ts` (the only place executable/argv are decided),
 * requires a real `ALLOW` `ExecutionPermissionDecision` from
 * `../../permissions/execution-policy/` whose scope matches the request,
 * spawns with `shell:false`, and turns raw process output into
 * sanitized, sequenced execution events.
 *
 * PORTED, NOT REWRITTEN: process-group kill, grace-period SIGTERM→SIGKILL,
 * per-process concurrency + exclusive-lock-key guards, output-limit
 * truncation, and before/after `git status` workspace-integrity checking
 * are all the same design as the old repo's — see each function's
 * comment for what changed only in naming.
 *
 * NEW (did not exist in the old repo): every execution now requires a
 * real, scope-matched, unexpired `ALLOW` `ExecutionPermissionDecision`
 * before a run record is even created — the old repo's execution engine
 * sat behind only a coarse `requireAuth(ADMIN_TIER)` route check (see
 * `../../reports/EXECUTION_MIGRATION_PLAN.md` §11,
 * `../../reports/EXECUTION_POLICY_LAYER_REPORT.md`). This is the one
 * real behavior change from the old implementation, and it is additive
 * (a strictly narrower gate), never a relaxation.
 *
 * Input: `ExecutionRequest` + the `ExecutionPermissionDecision` the
 * caller obtained from `../../permissions/execution-policy/contract.ts`.
 * Output: `ExecutionResult` (returned synchronously once queued/refused;
 * completion is observed via `subscribeToExecutionEvents` or by polling
 * `getExecution`), `ExecutionEvent` stream.
 * Dependency ที่อนุญาต: ./types.ts, ./registry.ts, ./result.ts,
 * ./audit.ts, ./host-runtime.ts, ../../permissions/execution-policy/
 * (type only — this file never evaluates permission itself, only
 * verifies an already-decided `ExecutionPermissionDecision`).
 * สิ่งที่ห้ามแตะ: never call `spawnProcess` with an executable/argv that
 * did not come from `./registry.ts`'s `getCommandDescriptor()`. Never
 * skip `verifyPermissionOrThrow` — there is no code path in this file
 * that reaches `spawnProcess` without it having returned normally first.
 * Never import from `../../control/command-router/`,
 * `../../control/owner-command/`, or any `route.ts` — this file has zero
 * public HTTP entrypoint by design this round (see
 * `../../reports/EXECUTION_CORE_PORT_REPORT.md` §RUNTIME_ENTRYPOINT).
 *
 * NOT_YET_BUILT: no real caller yet — see ./tests/executor.test.ts for
 * the only current caller, which drives this module directly by hand.
 */

import { defaultAuditSink, buildAuditEvent } from "./audit";
import {
  buildChildEnv,
  getCommandDescriptor,
  isCommandDenied,
  resolveWorkingDirectory,
  validateDynamicArgs,
} from "./registry";
import { captureCommandOutputSync, byteLength, killProcessGroup, newExecutionId, nowIso, sha256Hasher, spawnProcess, type HostChildProcess } from "./host-runtime";
import { diffWorkspaceSnapshots, mapTerminalStatus, sanitizeChunk } from "./result";
import { type CommandDescriptor, ExecutionError, type ExecutionEvent, type ExecutionRequest, type ExecutionResult } from "./types";

import type { ExecutionPermissionDecision } from "../../permissions/execution-policy/contract";

const GLOBAL_MAX_CONCURRENT = 4;
const PER_IDENTITY_MAX_CONCURRENT = 2;
const GRACE_PERIOD_MS = 5_000;
export const MAX_EXECUTION_HISTORY = 50;
const WORKSPACE_SNAPSHOT_TIMEOUT_MS = 5_000;

interface ExecState {
  result: ExecutionResult;
  events: ExecutionEvent[];
  listeners: Set<(event: ExecutionEvent) => void>;
  child: HostChildProcess | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  nextSeq: number;
  exclusiveLockKey: string | null;
  stdoutHasher: ReturnType<typeof sha256Hasher>;
  stderrHasher: ReturnType<typeof sha256Hasher>;
  workspaceSnapshotBefore: string | undefined;
  timedOut: boolean;
  cancelled: boolean;
  processStartFailed: boolean;
}

const executions = new Map<string, ExecState>();
const activeLockKeys = new Set<string>();

function isActive(status: ExecutionResult["status"]): boolean {
  return status === "queued" || status === "running";
}

function activeCountGlobal(): number {
  let n = 0;
  for (const s of executions.values()) if (isActive(s.result.status)) n++;
  return n;
}

function activeCountForIdentity(identityId: string): number {
  let n = 0;
  for (const s of executions.values()) if (s.result.identity_id === identityId && isActive(s.result.status)) n++;
  return n;
}

function evictStaleHistory(): void {
  const terminal = [...executions.values()]
    .filter((s) => !isActive(s.result.status))
    .sort((a, b) => (a.result.completedAt ?? "").localeCompare(b.result.completedAt ?? ""));
  const overflow = executions.size - MAX_EXECUTION_HISTORY;
  if (overflow <= 0) return;
  for (let i = 0; i < Math.min(overflow, terminal.length); i++) {
    executions.delete(terminal[i].result.execution_id);
  }
}

function emitEvent(state: ExecState, partial: Omit<ExecutionEvent, "seq" | "ts">): void {
  const event: ExecutionEvent = { ...partial, seq: state.nextSeq++, ts: nowIso() };
  state.events.push(event);
  for (const listener of state.listeners) listener(event);
}

function releaseSlot(state: ExecState): void {
  if (state.exclusiveLockKey) activeLockKeys.delete(state.exclusiveLockKey);
  state.child = null;
  if (state.timeoutTimer) {
    clearTimeout(state.timeoutTimer);
    state.timeoutTimer = null;
  }
  if (state.graceTimer) {
    clearTimeout(state.graceTimer);
    state.graceTimer = null;
  }
}

function captureWorkspaceSnapshot(cwd: string): string | undefined {
  return captureCommandOutputSync("git", ["status", "--porcelain=v2"], cwd, WORKSPACE_SNAPSHOT_TIMEOUT_MS);
}

function finalize(state: ExecState, exitCode: number | null, signal: string | null): void {
  if (!isActive(state.result.status)) return; // already terminal

  let workspacePolicyViolation = false;
  if (state.workspaceSnapshotBefore !== undefined) {
    const after = captureWorkspaceSnapshot(state.result.workingDirectory);
    if (after !== undefined) {
      const changed = diffWorkspaceSnapshots(state.workspaceSnapshotBefore, after);
      state.result.workspaceChangedPaths = changed;
      if (state.result.mode === "READ_ONLY" && changed.length > 0) {
        workspacePolicyViolation = true;
        state.result.workspacePolicyViolation = true;
      }
    }
  }

  const { status, errorCode } = mapTerminalStatus({
    exitCode,
    signal,
    timedOut: state.timedOut,
    cancelled: state.cancelled,
    truncated: state.result.truncated,
    workspacePolicyViolation,
    processStartFailed: state.processStartFailed,
  });

  const completedAt = nowIso();
  state.result.status = status;
  state.result.completedAt = completedAt;
  state.result.exitCode = exitCode;
  state.result.signal = signal;
  state.result.errorCode = errorCode as ExecutionResult["errorCode"];
  state.result.durationMs = state.result.startedAt ? new Date(completedAt).getTime() - new Date(state.result.startedAt).getTime() : 0;
  state.result.stdoutHash = state.stdoutHasher.digestHex();
  state.result.stderrHash = state.stderrHasher.digestHex();

  const eventTypeByStatus: Partial<Record<ExecutionResult["status"], ExecutionEvent["type"]>> = {
    passed: "execution.completed",
    failed: "execution.failed",
    cancelled: "execution.cancelled",
    timed_out: "execution.timeout",
    output_limited: "execution.output_limited",
  };
  emitEvent(state, { type: eventTypeByStatus[status] ?? "execution.failed" });
  releaseSlot(state);
  evictStaleHistory();

  defaultAuditSink.record(
    buildAuditEvent({
      execution_id: state.result.execution_id,
      correlation_id: state.result.correlation_id,
      command_id: state.result.command_id,
      identity_id: state.result.identity_id,
      account_id: state.result.account_id,
      workspace_id: state.result.workspace_id,
      permission_decision_id: state.result.permission_decision_id,
      started_at: state.result.startedAt,
      completed_at: state.result.completedAt,
      exit_code: state.result.exitCode,
      status: state.result.status,
      error_code: state.result.errorCode,
      duration_ms: state.result.durationMs,
      verification_result:
        state.workspaceSnapshotBefore === undefined
          ? "not_verified"
          : workspacePolicyViolation
            ? "workspace_policy_violation"
            : (state.result.workspaceChangedPaths?.length ?? 0) > 0
              ? "workspace_changed_as_expected"
              : "workspace_unchanged",
      stdout_reference: state.result.stdoutHash,
      stderr_reference: state.result.stderrHash,
    }),
  );
}

function killGracefully(state: ExecState): void {
  const child = state.child;
  if (!child || child.killed || child.exitCode !== null || !child.pid) return;
  killProcessGroup(child.pid, "SIGTERM");
  state.graceTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed && child.pid) killProcessGroup(child.pid, "SIGKILL");
  }, GRACE_PERIOD_MS);
}

/**
 * Wrapped in its own try/catch so a malformed `ExecutionPermissionDecision`
 * (missing/wrong-shaped fields — never expected from a real
 * `evaluateExecutionPermission()` call, but this function must never
 * trust its caller) fails closed as `ExecutionError("PERMISSION_DENIED")`,
 * the same fail-closed discipline
 * `../../permissions/execution-policy/policy.ts` applies to its own
 * evaluation — never an unrelated raw `TypeError` escaping to the caller.
 */
function verifyPermissionOrThrow(request: ExecutionRequest, decision: ExecutionPermissionDecision | undefined): void {
  if (!decision) {
    throw new ExecutionError("PERMISSION_DENIED", "no permission decision supplied");
  }
  try {
    if (decision.decision_id !== request.permission_decision_id) {
      throw new ExecutionError("PERMISSION_DENIED", "permission_decision_id does not match the supplied decision");
    }
    if (decision.decision !== "ALLOW") {
      throw new ExecutionError("PERMISSION_DENIED", `permission decision is "${decision.decision}", not ALLOW`);
    }
    if (
      decision.scope.account_id !== request.account_id ||
      decision.scope.workspace_id !== request.workspace_id ||
      decision.scope.capability !== request.capability ||
      decision.scope.command_id !== request.command_id
    ) {
      throw new ExecutionError("PERMISSION_DENIED", "permission decision scope does not match this request");
    }
    if (decision.expires_at && new Date(decision.expires_at).getTime() <= Date.now()) {
      throw new ExecutionError("PERMISSION_DENIED", "permission decision has expired");
    }
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    throw new ExecutionError("PERMISSION_DENIED", `permission decision could not be verified: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveArgv(descriptor: CommandDescriptor, request: ExecutionRequest): readonly string[] {
  const dynamicArgv = descriptor.dynamicArgOrder.filter((key) => request.requested_args[key] !== undefined).map((key) => String(request.requested_args[key]));
  return [...descriptor.fixedArgs, ...dynamicArgv];
}

/**
 * The only function a caller may use to start an execution. Refuses to
 * start (throws `ExecutionError`, creates no run record at all) on any
 * permission failure, unknown command, denied command, missing owner
 * confirmation, or concurrency/lock exhaustion — matching STEP 5 of
 * `../../reports/EXECUTION_MIGRATION_PLAN.md`'s fail-closed requirement.
 */
export function startExecution(request: ExecutionRequest, decision: ExecutionPermissionDecision | undefined): ExecutionResult {
  verifyPermissionOrThrow(request, decision);

  const descriptor = getCommandDescriptor(request.command_id);
  if (!descriptor) {
    throw new ExecutionError("UNKNOWN_COMMAND", `unknown command_id: ${request.command_id}`);
  }

  validateDynamicArgs(descriptor, request.requested_args);
  const cwd = resolveWorkingDirectory(descriptor);
  const fullArgv = resolveArgv(descriptor, request);

  const denyCheck = isCommandDenied(descriptor.executable, fullArgv);
  if (denyCheck.denied) {
    throw new ExecutionError("COMMAND_DENIED", denyCheck.reason ?? "command denied by policy");
  }

  if (descriptor.requiresOwnerConfirmation && request.owner_confirmation !== true) {
    throw new ExecutionError("OWNER_CONFIRMATION_REQUIRED", `command "${descriptor.command_id}" changes the workspace and requires owner_confirmation:true`);
  }

  if (!descriptor.allowConcurrent && activeCountGlobal() >= GLOBAL_MAX_CONCURRENT) {
    throw new ExecutionError("CONCURRENCY_LIMIT", "global concurrent execution limit reached");
  }
  if (activeCountForIdentity(request.identity_id) >= PER_IDENTITY_MAX_CONCURRENT) {
    throw new ExecutionError("CONCURRENCY_LIMIT", "per-identity concurrent execution limit reached");
  }
  if (descriptor.exclusiveLockKey && activeLockKeys.has(descriptor.exclusiveLockKey)) {
    throw new ExecutionError("COMMAND_BUSY", `command "${descriptor.command_id}" is already running elsewhere (exclusive lock "${descriptor.exclusiveLockKey}")`);
  }

  const executionId = newExecutionId();
  const queuedAt = nowIso();
  const result: ExecutionResult = {
    execution_id: executionId,
    correlation_id: request.correlation_id,
    command_id: descriptor.command_id,
    identity_id: request.identity_id,
    account_id: request.account_id,
    workspace_id: request.workspace_id,
    permission_decision_id: request.permission_decision_id,
    status: "queued",
    queuedAt,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    outputBytes: 0,
    truncated: false,
    errorCode: null,
    workingDirectory: cwd,
    mode: descriptor.mode,
    changesWorkspace: descriptor.changesWorkspace,
    ownerConfirmation: request.owner_confirmation === true,
    resolvedArgv: sanitizeChunk(fullArgv.join(" ")).split(" ").filter(Boolean),
    stdoutHash: null,
    stderrHash: null,
    workspaceChangedPaths: undefined,
    workspacePolicyViolation: false,
  };

  const state: ExecState = {
    result,
    events: [],
    listeners: new Set(),
    child: null,
    timeoutTimer: null,
    graceTimer: null,
    nextSeq: 0,
    exclusiveLockKey: descriptor.exclusiveLockKey,
    stdoutHasher: sha256Hasher(),
    stderrHasher: sha256Hasher(),
    workspaceSnapshotBefore: captureWorkspaceSnapshot(cwd),
    timedOut: false,
    cancelled: false,
    processStartFailed: false,
  };
  executions.set(executionId, state);
  emitEvent(state, { type: "execution.queued" });

  if (descriptor.exclusiveLockKey) activeLockKeys.add(descriptor.exclusiveLockKey);

  let child: HostChildProcess;
  try {
    child = spawnProcess(descriptor.executable, fullArgv, { cwd, env: buildChildEnv(), detached: true });
  } catch {
    if (descriptor.exclusiveLockKey) activeLockKeys.delete(descriptor.exclusiveLockKey);
    state.processStartFailed = true;
    finalize(state, null, null);
    return state.result;
  }

  state.child = child;
  result.status = "running";
  result.startedAt = nowIso();
  emitEvent(state, { type: "execution.started" });

  const timeoutMs = request.timeout_ms && request.timeout_ms <= descriptor.timeoutMs ? request.timeout_ms : descriptor.timeoutMs;

  const appendOutput = (stream: "stdout" | "stderr", chunkText: string) => {
    if (result.truncated) return;
    const clean = sanitizeChunk(chunkText);
    const hasher = stream === "stdout" ? state.stdoutHasher : state.stderrHasher;
    const bytes = byteLength(clean);
    if (result.outputBytes + bytes > descriptor.maxOutputBytes) {
      const remaining = Math.max(0, descriptor.maxOutputBytes - result.outputBytes);
      const partial = clean.slice(0, remaining);
      if (partial.length > 0) {
        result.outputBytes += byteLength(partial);
        hasher.update(partial);
        emitEvent(state, { type: stream === "stdout" ? "execution.stdout" : "execution.stderr", stream, text: partial });
      }
      result.truncated = true;
      killGracefully(state);
      return;
    }
    result.outputBytes += bytes;
    hasher.update(clean);
    emitEvent(state, { type: stream === "stdout" ? "execution.stdout" : "execution.stderr", stream, text: clean });
  };

  child.stdout?.on("data", (chunk: { toString(encoding: string): string }) => appendOutput("stdout", chunk.toString("utf-8")));
  child.stderr?.on("data", (chunk: { toString(encoding: string): string }) => appendOutput("stderr", chunk.toString("utf-8")));

  state.timeoutTimer = setTimeout(() => {
    state.timedOut = true;
    killGracefully(state);
  }, timeoutMs);

  child.on("error", () => {
    state.processStartFailed = true;
    finalize(state, null, null);
  });

  child.on("exit", (code: number | null, signal: string | null) => {
    finalize(state, code, signal);
  });

  return result;
}

export function getExecution(executionId: string, identityId: string): ExecutionResult {
  const state = executions.get(executionId);
  if (!state) throw new ExecutionError("EXECUTION_NOT_FOUND", "no execution with that id");
  if (state.result.identity_id !== identityId) throw new ExecutionError("EXECUTION_NOT_FOUND", "this execution belongs to a different identity");
  return state.result;
}

export function listExecutions(identityId: string): ExecutionResult[] {
  return [...executions.values()]
    .filter((s) => s.result.identity_id === identityId)
    .map((s) => s.result)
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
}

export function cancelExecution(executionId: string, identityId: string): ExecutionResult {
  const state = executions.get(executionId);
  if (!state) throw new ExecutionError("EXECUTION_NOT_FOUND", "no execution with that id");
  if (state.result.identity_id !== identityId) throw new ExecutionError("EXECUTION_NOT_FOUND", "this execution belongs to a different identity");
  if (!isActive(state.result.status)) return state.result;
  state.cancelled = true;
  killGracefully(state);
  return state.result;
}

export function subscribeToExecutionEvents(executionId: string, onEvent: (event: ExecutionEvent) => void): { replay: readonly ExecutionEvent[]; unsubscribe: () => void } | null {
  const state = executions.get(executionId);
  if (!state) return null;
  state.listeners.add(onEvent);
  return {
    replay: [...state.events],
    unsubscribe: () => {
      state.listeners.delete(onEvent);
    },
  };
}

/** Test-only introspection — never imported by any future route. */
export function __debugExecutionCount(): number {
  return executions.size;
}
export function __debugActiveLockKeys(): string[] {
  return [...activeLockKeys];
}
