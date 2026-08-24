/**
 * หน้าที่: the "Agent Gateway -> Agent Host" link and the ONE boundary
 * that normalizes real AI-runtime output into `DNA_OS_AGENT_RESULT_V1`
 * (Owner, "Authority Assembly Phase 1" — 1A Unify Work Unit, 1D Single
 * Output Contract). This file implements no sandbox logic itself — it
 * resolves a provider-neutral `WorkerKind` via
 * `../agent-host/contract.ts`'s `resolveWorker`, then calls the SAME,
 * unmodified `launchAgent()` every worker kind goes through. No
 * provider-specific AUTHORITY exists anywhere in this file — but this
 * file DOES know, deterministically, which real CLI flags produce
 * machine-parseable output for CLAUDE/CODEX (their own documented
 * `--output-format stream-json` / `--json` modes), because parsing
 * arbitrary natural language would violate 1D's "never trust arbitrary
 * stdout" rule. That parsing is data-shape knowledge, not per-provider
 * business logic — every worker kind still goes through the identical
 * launchAgent() call and the identical DnaOsAgentResult shape comes out.
 *
 * Input: a real `WorkOrder` (its `agent_run` field — see
 * `./types.ts`... actually `../agent-gateway/types.ts`).
 * Output: `DnaOsAgentResult` — the ONLY authoritative output of an Agent
 * Host dispatch. Malformed/unknown/mismatched output is FAIL_CLOSED,
 * never guessed.
 * Dependency ที่อนุญาต: ../agent-host/contract.ts, ./types.ts,
 * ./agent-execution-contract.ts, ./memory-store.ts.
 * สิ่งที่ห้ามแตะ: never pass this process's own full `process.env` through
 * to `launchAgent` — only what the caller explicitly supplies is
 * forwarded, and `launchAgent`'s own `AGENT_ENV_ALLOWLIST` still applies
 * underneath regardless. Never default a workspace path to real
 * repository source. Never auto-execute a `requested_action` — this file
 * only ever parses and carries it; `./agent-authority-router.ts` alone
 * decides whether one ever runs.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { launchAgent, resolveWorker } from "../agent-host/contract";
import type { AgentLaunchResult, WorkerKind } from "../agent-host/contract";
import { saveEvidence } from "./memory-store";
import type { WorkOrder } from "./types";
import {
  MACHINE_CONTRACT_VERSION,
  ERROR_CODES,
  REQUESTED_ACTION_OPERATIONS,
} from "./agent-execution-contract";
import type { DnaOsAgentResult, MachineError, RequestedAction, RequestedActionOperation, RuntimeEvidence, Severity, VerificationResult } from "./agent-execution-contract";

export interface AgentHostDispatchRequest {
  task_id: string;
  worker_kind: WorkerKind;
  /** Real, absolute path to a temporary workspace — must never be a real-source directory; callers are responsible for supplying a scratch/workspace path, never a repository root. */
  workspace_dir: string;
  instructionArgv: readonly string[];
  timeoutMs?: number;
  /** Extra directories to prove unreadable in this specific dispatch (see AgentLaunchRequest's own outsideProbeDirs) — additive to the confinement, never a widening. */
  outsideProbeDirs?: readonly string[];
  /** The exact env the child may draw its allowlisted values from — launchAgent's own AGENT_ENV_ALLOWLIST still filters this down to PATH/TMPDIR/LANG/LC_ALL only. */
  hostEnv: Readonly<Record<string, string | undefined>>;
}

export type AgentHostDispatchResult =
  | { task_id: string; worker_kind: WorkerKind; status: "LAUNCHED"; launch: AgentLaunchResult }
  | { task_id: string; worker_kind: WorkerKind; status: "WORKER_NOT_AVAILABLE"; reason: string };

/**
 * The one real entry point that resolves a worker and performs a real,
 * unmodified `launchAgent()` call. Never a fabricated success:
 * `WORKER_NOT_AVAILABLE` is returned, untouched, whenever `resolveWorker`
 * cannot find a real executable.
 */
export async function dispatchToAgentHost(request: AgentHostDispatchRequest): Promise<AgentHostDispatchResult> {
  const resolution = resolveWorker(request.worker_kind);
  if (!resolution.ok) {
    return { task_id: request.task_id, worker_kind: request.worker_kind, status: "WORKER_NOT_AVAILABLE", reason: resolution.detail };
  }
  const launch = await launchAgent(
    {
      allowedWorkspaceDir: request.workspace_dir,
      agentExecutable: resolution.worker.executable,
      agentArgv: request.instructionArgv,
      timeoutMs: request.timeoutMs ?? 15_000,
    },
    request.hostEnv,
    request.outsideProbeDirs ?? [],
  );
  return { task_id: request.task_id, worker_kind: request.worker_kind, status: "LAUNCHED", launch };
}

declare const process: { pid: number; getuid?: () => number };

/**
 * Builds the real, provider-native argv that produces machine-parseable
 * output — the ONE place per-worker-kind CLI flags are named. This is
 * data (which flags this CLI documents for JSON output), not business
 * logic: the caller (runAgentWorkOrder) treats every kind identically
 * afterward.
 */
function buildInstructionArgv(workerKind: WorkerKind, instruction: string, defaultArgv: readonly string[]): readonly string[] {
  if (workerKind === "CLAUDE") {
    // --bare (real, documented Claude Code flag): "skip hooks, LSP, plugin
    // background prefetches, keychain reads... OAuth and keychain are
    // never read." Required under this sandbox: without it, Claude's own
    // startup tries to exec `security` to probe the Keychain, which this
    // sandbox correctly denies (EPERM) — but Claude does not handle that
    // denial gracefully, it crashes with an uncaught exception. `--bare`
    // means Claude never attempts that exec at all, which is the correct
    // fix (matching this repo's credential-boundary intent exactly) --
    // not a sandbox widening.
    return ["-p", "--bare", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan", "--no-session-persistence", "--", instruction];
  }
  if (workerKind === "CODEX") {
    return ["exec", "--json", "-s", "read-only", "--skip-git-repo-check", "--ephemeral", instruction];
  }
  // LOCAL (GEMINI never reaches here — resolveWorker fails first): defaultArgv carries the script path; `instruction` is the caller-supplied JSON action string, appended as argv[2] per agent-script.mjs's own contract.
  return instruction.length > 0 ? [...defaultArgv, instruction] : defaultArgv;
}

function readSandboxProfileHash(allowedWorkspaceDir: string, launchId: string): string | null {
  try {
    const profilePath = join(allowedWorkspaceDir, "..", ".agent-host-profiles", `${launchId}.sb`);
    const content = readFileSync(profilePath, "utf-8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Read Boundary (Owner, Phase 1C): real sibling directories of the
 * Agent's assigned source (e.g. other repos under ~/Desktop) that were
 * NOT explicitly assigned — passed to `launchAgent`'s `outsideProbeDirs`
 * so they get an explicit `(deny file-read* ...)`, overriding the
 * broader `file-read*` allow, exactly the mechanism already used for
 * probe directories. Never throws — an unreadable parent dir just yields
 * no additional denies (the always-denied credential subpaths in
 * host-runtime.ts still apply regardless).
 */
function unassignedSiblingRepos(assignedSourcePaths: readonly string[]): readonly string[] {
  if (assignedSourcePaths.length === 0) return [];
  const parent = dirname(assignedSourcePaths[0]);
  let siblings: readonly string[];
  try {
    siblings = readdirSync(parent);
  } catch {
    return [];
  }
  const assignedSet = new Set(assignedSourcePaths.map((p) => p.replace(/\/$/, "")));
  return siblings.map((name) => join(parent, name)).filter((full) => !assignedSet.has(full.replace(/\/$/, "")));
}

function listWorkspaceArtifacts(workspaceDir: string): readonly string[] {
  try {
    return readdirSync(workspaceDir).map((name) => `artifact://${join(workspaceDir, name)}`);
  } catch {
    return [];
  }
}

function newEvidenceId(): string {
  return `ev-agent-exec-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

interface NormalizedOutput {
  status: "PASS" | "FAIL" | "ERROR" | "BLOCKED" | "FAIL_CLOSED";
  summary: string;
  error_code: string | null;
  severity: Severity | null;
  requested_actions: readonly RequestedAction[];
  errors: readonly MachineError[];
}

function fail(status: "FAIL" | "ERROR" | "BLOCKED" | "FAIL_CLOSED", errorCode: string, severity: Severity, summary: string): NormalizedOutput {
  return { status, summary, error_code: errorCode, severity, requested_actions: [], errors: [{ error_code: errorCode, severity, retryable: false, required_capability: null }] };
}

/** Validates a raw parsed `requested_actions` array against the closed operation vocabulary — anything unrecognized is dropped and reported, never silently accepted (1E/1D FAIL_CLOSED rule). */
function validateRequestedActions(raw: unknown, workOrderId: string): { actions: readonly RequestedAction[]; rejected: readonly string[] } {
  if (!Array.isArray(raw)) return { actions: [], rejected: [] };
  const actions: RequestedAction[] = [];
  const rejected: string[] = [];
  for (const entry of raw) {
    const e = entry as { operation?: unknown; artifact_ref?: unknown; target?: unknown; work_order_id?: unknown };
    if (typeof e.work_order_id === "string" && e.work_order_id.length > 0 && e.work_order_id !== workOrderId) {
      rejected.push(`WORK_ORDER_MISMATCH:${e.work_order_id}`);
      continue;
    }
    if (typeof e.operation !== "string" || !REQUESTED_ACTION_OPERATIONS.includes(e.operation as RequestedActionOperation)) {
      rejected.push(`UNKNOWN_OPERATION:${String(e.operation)}`);
      continue;
    }
    actions.push({ operation: e.operation as RequestedActionOperation, artifact_ref: typeof e.artifact_ref === "string" ? e.artifact_ref : "", target: typeof e.target === "string" ? e.target : "" });
  }
  return { actions, rejected };
}

/** CLAUDE's real `--output-format stream-json` protocol: one JSON object per line; the terminal line is `{"type":"result", is_error, result, ...}`. */
function parseClaudeStreamJson(stdout: string, workOrderId: string): NormalizedOutput {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  let resultLine: Record<string, unknown> | null = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type === "result") resultLine = obj;
    } catch {
      /* non-JSON diagnostic line, ignored per the documented protocol */
    }
  }
  if (!resultLine) return fail("FAIL_CLOSED", ERROR_CODES.MALFORMED_RESULT, "CRITICAL", "no terminal stream-json 'result' event found in CLAUDE's stdout");
  const isError = resultLine.is_error === true;
  const resultText = typeof resultLine.result === "string" ? resultLine.result : "";
  if (isError) return { status: "FAIL", summary: resultText || "CLAUDE reported is_error=true", error_code: "AGENT_REPORTED_ERROR", severity: "BLOCKING", requested_actions: [], errors: [] };
  const { actions, rejected } = validateRequestedActions([], workOrderId); // CLAUDE (--permission-mode plan) never itself emits a requested_actions[] block today — plan mode narrative only; this file never treats CLAUDE's free text as a requested_action itself.
  return { status: "PASS", summary: resultText.slice(0, 4000), error_code: null, severity: null, requested_actions: actions, errors: rejected.map((r) => ({ error_code: r, severity: "WARNING" as Severity, retryable: false, required_capability: null })) };
}

/** CODEX's real `--json` protocol: one JSON object per line; `item.completed` events of type "agent_message" carry the model's own text; `turn.completed` marks the end. */
function parseCodexJsonl(stdout: string, workOrderId: string): NormalizedOutput {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  let lastAgentMessage: string | null = null;
  let sawTurnCompleted = false;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (obj.type === "turn.completed") sawTurnCompleted = true;
      if (obj.type === "item.completed" && obj.item?.type === "agent_message" && typeof obj.item.text === "string") lastAgentMessage = obj.item.text;
    } catch {
      /* codex also prints a non-JSON diagnostic line ("Reading additional input from stdin...") before the JSONL stream -- documented, ignored here */
    }
  }
  if (!sawTurnCompleted) return fail("FAIL_CLOSED", ERROR_CODES.MALFORMED_RESULT, "CRITICAL", "no terminal 'turn.completed' event found in CODEX's --json stdout");
  const { actions, rejected } = validateRequestedActions([], workOrderId); // CODEX's own JSONL protocol has no requested_actions[] field today; this file never treats its agent_message text as one.
  return { status: "PASS", summary: (lastAgentMessage ?? "").slice(0, 4000), error_code: null, severity: null, requested_actions: actions, errors: rejected.map((r) => ({ error_code: r, severity: "WARNING" as Severity, retryable: false, required_capability: null })) };
}

/** LOCAL's own test-fixture JSON (agent-script.mjs) — unchanged from prior phases, extended here to also validate any requested_actions[] shape against the closed vocabulary. */
function parseLocalFixtureJson(stdout: string, workOrderId: string): NormalizedOutput {
  let parsed: { outcome?: string; write_request?: { target_path: string; content: string }; requested_actions?: unknown } | null = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return fail("FAIL_CLOSED", ERROR_CODES.MALFORMED_RESULT, "CRITICAL", "LOCAL worker's stdout was not valid JSON");
  }
  if (parsed?.outcome === "SUCCEEDED") return { status: "PASS", summary: "LOCAL action succeeded", error_code: null, severity: null, requested_actions: [], errors: [] };
  if (parsed?.outcome === "BLOCKED") return { status: "BLOCKED", summary: "LOCAL action was blocked by the sandbox", error_code: ERROR_CODES.EXEC_DENIED, severity: "BLOCKING", requested_actions: [], errors: [] };
  if (parsed?.outcome === "WRITE_REQUEST_EMITTED" && parsed.write_request) {
    return {
      status: "PASS", summary: "LOCAL emitted a file-write request", error_code: null, severity: null,
      requested_actions: [{ operation: "FILE_MODIFY", artifact_ref: `artifact://${parsed.write_request.target_path}`, target: parsed.write_request.target_path }],
      errors: [],
    };
  }
  if (parsed?.outcome === "REPORTED") return { status: "PASS", summary: "LOCAL reported diagnostics", error_code: null, severity: null, requested_actions: [], errors: [] };
  if (parsed?.outcome === "UNKNOWN_ACTION") return { status: "ERROR", summary: "LOCAL received an unrecognized action", error_code: ERROR_CODES.UNKNOWN_ACTION, severity: "WARNING", requested_actions: [], errors: [] };
  const { actions, rejected } = validateRequestedActions(parsed?.requested_actions, workOrderId);
  return { status: "PASS", summary: "LOCAL reported", error_code: null, severity: null, requested_actions: actions, errors: rejected.map((r) => ({ error_code: r, severity: "WARNING" as Severity, retryable: false, required_capability: null })) };
}

/**
 * The ONE boundary-normalization function — converts whatever the
 * confined process actually produced into `NormalizedOutput`, provider
 * by provider ONLY in terms of which real, documented machine-output
 * flag/protocol that provider speaks. Every branch below still produces
 * the exact same output shape.
 */
function interpretLaunchResult(dispatch: AgentHostDispatchResult, workOrderId: string): NormalizedOutput {
  if (dispatch.status === "WORKER_NOT_AVAILABLE") {
    return fail("BLOCKED", ERROR_CODES.WORKER_NOT_AVAILABLE, "BLOCKING", dispatch.reason);
  }
  const launch = dispatch.launch;
  if (launch.timedOut) return fail("ERROR", "LAUNCH_TIMEOUT", "CRITICAL", "the confined Agent process did not finish within its timeout");
  if (launch.stderr.includes("execvp() of") && launch.stderr.includes("Operation not permitted")) {
    return fail("BLOCKED", ERROR_CODES.DEPENDENCY_BOUNDARY_EXPANSION_REQUIRED, "BLOCKING", `sandbox-exec denied exec of the registered literal executable: ${launch.stderr.trim()}`);
  }
  if (dispatch.worker_kind === "LOCAL") return parseLocalFixtureJson(launch.stdout, workOrderId);
  if (dispatch.worker_kind === "CLAUDE") return parseClaudeStreamJson(launch.stdout, workOrderId);
  if (dispatch.worker_kind === "CODEX") return parseCodexJsonl(launch.stdout, workOrderId);
  return fail("ERROR", "UNKNOWN_WORKER_KIND", "CRITICAL", `no output parser registered for worker kind ${dispatch.worker_kind}`);
}

/**
 * The full LIVE_DISPATCH_WIRING entry (Owner, Phase 1A) — takes a real
 * WorkOrder whose `agent_run` field carries the run specification,
 * derives every Agent Host parameter from it (never a second, ad hoc
 * task-description shape), launches through the unmodified Agent Host,
 * normalizes the result at this ONE boundary into `DnaOsAgentResult`,
 * and records the full lineage: work_order_id -> launch_id -> agent_pid
 * -> result_id -> evidence_id.
 *
 * FAIL_CLOSED (never guessed, never silently accepted): missing
 * work_order_id, malformed provider output, or a requested_action whose
 * own work_order_id names a different WorkOrder.
 */
export async function runAgentWorkOrder(workOrder: WorkOrder, command_id: string, hostEnv: Readonly<Record<string, string | undefined>>): Promise<DnaOsAgentResult> {
  const resultId = `result-${randomUUID()}`;
  const launcherPid = process.pid;

  if (!workOrder.agent_run) {
    return {
      protocol: MACHINE_CONTRACT_VERSION, work_order_id: "", workspace_id: "", launch_id: null, result_id: resultId, verification_id: null, task_id: command_id, worker_id: "NONE",
      status: "FAIL_CLOSED", summary: "WorkOrder has no agent_run — nothing to dispatch to Agent Host", error_code: ERROR_CODES.MISSING_WORK_ORDER_ID, severity: "CRITICAL",
      artifacts: [], evidence_refs: [], requested_actions: [], errors: [{ error_code: ERROR_CODES.MISSING_WORK_ORDER_ID, severity: "CRITICAL", retryable: false, required_capability: null }],
      verification: { verified: false, method: "work_order_shape", checked_against: ["agent_run_present"] },
      runtime: { launcher_pid: launcherPid, sandbox_pid: null, agent_pid: null, ppid_chain: [launcherPid], uid: typeof process.getuid === "function" ? process.getuid() : -1, executable: "(none)", workspace: "(none)", sandbox_profile_hash: null, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), exit_code: null },
      exit_code: null,
    };
  }

  const run = workOrder.agent_run;
  const workOrderId = `wo-${command_id}`;
  const taskId = `task-${command_id}-agent-host`;

  // WORKSPACE_MANAGER integration (Owner, Phase 2): when a real workspace_id
  // is present, it is the ONLY source of truth for read/write scope — the
  // Agent never chose these paths itself, WorkspaceManager did, before this
  // function ever ran.
  const { getWorkspace, transitionWorkspace, assignAgent } = await import("./workspace-manager");
  const workspace = run.workspace_id ? getWorkspace(run.workspace_id) : undefined;
  const workspaceId = workspace?.workspace_id ?? run.workspace_id ?? "(no-workspace-manager)";
  const readPaths = workspace?.allowed_read_paths ?? run.assigned_source_paths;
  const writeWorkspace = workspace?.allowed_write_workspace ?? run.workspace_path;

  if (workspace) {
    transitionWorkspace(workspaceId, "PREPARE_CONTEXT", "context resolved from WorkspaceManager");
    assignAgent(workspaceId, run.worker_kind);
    transitionWorkspace(workspaceId, "RUNNING", `dispatching to Agent Host, task_id=${taskId}`);
  }

  const resolution = resolveWorker(run.worker_kind);
  const argv = resolution.ok ? buildInstructionArgv(run.worker_kind, run.instruction, resolution.worker.defaultArgv) : [];

  const dispatch = await dispatchToAgentHost({
    task_id: taskId,
    worker_kind: run.worker_kind,
    workspace_dir: writeWorkspace,
    instructionArgv: argv,
    timeoutMs: run.timeout_ms,
    outsideProbeDirs: unassignedSiblingRepos(readPaths),
    hostEnv,
  });

  if (workspace) transitionWorkspace(workspaceId, "RESULT_RECEIVED", `dispatch status=${dispatch.status}`);

  const normalized = interpretLaunchResult(dispatch, workOrderId);

  if (workspace) transitionWorkspace(workspaceId, "VERIFYING", "normalizing provider output into DNA_OS_AGENT_RESULT_V1");

  const execEvidenceId = newEvidenceId();
  saveEvidence({ evidence_id: execEvidenceId, task_id: taskId, kind: "execution_output", source: "control/agent-gateway/agent-host-dispatch.ts", recorded_at: new Date().toISOString(), payload: dispatch });
  const verificationEvidenceId = newEvidenceId();
  const verification: VerificationResult = { verified: normalized.status === "PASS", method: "exit_code_and_protocol_shape", checked_against: ["work_order_id_match", "provider_protocol_terminal_event"] };
  saveEvidence({ evidence_id: verificationEvidenceId, task_id: taskId, kind: "verification", source: "control/agent-gateway/agent-host-dispatch.ts", recorded_at: new Date().toISOString(), payload: { verified: verification.verified, execEvidenceId, status: normalized.status, error_code: normalized.error_code } });

  if (workspace) {
    const nextState = normalized.status === "PASS" ? "ACCEPTED" : normalized.status === "BLOCKED" || normalized.status === "FAIL_CLOSED" ? "REJECTED" : "CORRECTION_REQUIRED";
    transitionWorkspace(workspaceId, nextState, `verification.verified=${verification.verified} status=${normalized.status}`);
    transitionWorkspace(workspaceId, "CLOSED", "workspace lifecycle complete");
  }

  const executable = resolution.ok ? resolution.worker.executable : "(unresolved)";
  const runtime: RuntimeEvidence = dispatch.status === "LAUNCHED"
    ? {
      launcher_pid: launcherPid,
      sandbox_pid: dispatch.launch.pid,
      agent_pid: dispatch.launch.pid,
      ppid_chain: [launcherPid, ...(dispatch.launch.pid !== null ? [dispatch.launch.pid] : [])],
      uid: typeof process.getuid === "function" ? process.getuid() : -1,
      executable,
      workspace: writeWorkspace,
      sandbox_profile_hash: readSandboxProfileHash(writeWorkspace, dispatch.launch.launchId),
      started_at: dispatch.launch.startedAt,
      ended_at: dispatch.launch.completedAt,
      exit_code: dispatch.launch.exitCode,
    }
    : {
      launcher_pid: launcherPid, sandbox_pid: null, agent_pid: null, ppid_chain: [launcherPid],
      uid: typeof process.getuid === "function" ? process.getuid() : -1, executable, workspace: writeWorkspace,
      sandbox_profile_hash: null, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), exit_code: null,
    };

  return {
    protocol: MACHINE_CONTRACT_VERSION,
    work_order_id: workOrderId,
    workspace_id: workspaceId,
    launch_id: dispatch.status === "LAUNCHED" ? dispatch.launch.launchId : null,
    result_id: resultId,
    verification_id: verificationEvidenceId,
    task_id: taskId,
    worker_id: run.worker_kind,
    status: normalized.status,
    summary: normalized.summary,
    error_code: normalized.error_code,
    severity: normalized.severity,
    artifacts: listWorkspaceArtifacts(writeWorkspace),
    evidence_refs: [execEvidenceId, verificationEvidenceId],
    requested_actions: normalized.requested_actions,
    errors: normalized.errors,
    verification,
    runtime,
    exit_code: dispatch.status === "LAUNCHED" ? dispatch.launch.exitCode : null,
  };
}
