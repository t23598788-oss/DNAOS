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
import { loadEvidenceForTask, saveEvidence } from "./memory-store";
import type { WorkOrder } from "./types";
import {
  MACHINE_CONTRACT_VERSION,
  MACHINE_INPUT_CONTRACT_VERSION,
  ERROR_CODES,
  type DnaOsAgentInput,
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
  /** ผู้ฟัง stdout ทีละบรรทัดของ Agent Host — ส่งต่อตรง ๆ ไม่ตีความที่ชั้นนี้ */
  onEvent?: (line: string) => void;
  /** The exact env the child may draw its allowlisted values from — launchAgent's own AGENT_ENV_ALLOWLIST still filters this down to PATH/TMPDIR/LANG/LC_ALL only. */
  hostEnv: Readonly<Record<string, string | undefined>>;
  /**
   * SANDBOX PROFILE V1: the real absolute repository paths this launch may
   * READ — assigned source plus declared dependency reads. Omitted means
   * "workspace only", never "the whole repository".
   */
  repositoryReadPaths?: readonly string[];
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
      repositoryReadPaths: request.repositoryReadPaths ?? [],
      onEvent: request.onEvent,
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
    /**
     * CLAUDE ไม่เดินทางนี้แล้ว (Owner, IMPLEMENT_LOCAL_CLAUDE_CODE_TRUSTED_
     * EXECUTION_BOUNDARY) — `runAgentWorkOrder` แยกไปที่
     * `control/claude-execution-boundary/` ซึ่งประกอบ argv ของตัวเองทั้งชุด
     *
     * `--bare` ถูกถอดออกจากที่นี่ด้วย เพื่อไม่ให้มีจุดใดในระบบที่ยังบอกว่า Claude
     * ถูกเรียกด้วยธงนั้น: คอมเมนต์เดิมของมันเองระบุว่า "OAuth and keychain are
     * never read" ซึ่งคือสาเหตุตรง ๆ ของ "Not logged in" ที่วัดได้ ส่วนเหตุผลเดิม
     * ที่ต้องใส่มัน (Claude crash เพราะ exec `security` ไม่ได้ใต้กรง) ถูกแก้ที่
     * ต้นเหตุแล้วในโปรไฟล์เฉพาะของขอบเขตนั้น
     *
     * ค่าที่คืนตรงนี้เหลือไว้เพื่อความครบถ้วนของฟังก์ชัน ไม่ใช่เส้นทางที่ใช้จริง
     */
    return ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "plan", "--no-session-persistence", "--", instruction];
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
/**
 * ที่มาของการรัน — สองเส้นทางที่ต่างกันจริง ไม่ใช่เส้นเดียวที่บางครั้งขาดข้อมูล
 *
 * ADMITTED_TASK: งานที่ผ่าน submitTask/admission มาแล้ว จึงมี task identity ของตัวเอง
 *   อยู่แล้ว การสร้าง id ใหม่ตรงนี้คือการแยกร่าง lifecycle ซึ่งทำให้ policy decision
 *   ของงานนั้นตามหาไม่เจอ (นี่คือบั๊กที่ FIX_TASK_IDENTITY_PROPAGATION ปิด)
 *
 * DIRECT: การรัน worker ระดับล่างที่ไม่มี admitted task จริง ๆ — launcher ของ
 *   connections/agent-registry, งาน scheduler และเทสต์ระดับ host ทั้งหมดอยู่กลุ่มนี้
 *   มันไม่ควรถูกบังคับให้แกล้งทำเป็นมี task ที่ผ่าน admission
 *
 * ส่งเป็น string = DIRECT (รูปเดิม ผู้เรียกเดิมทุกตัวจึงไม่ต้องแก้)
 */
export type AgentExecutionOrigin =
  | { kind: "ADMITTED_TASK"; task_id: string; command_id: string }
  | { kind: "DIRECT"; correlation_id: string };

/**
 * ดึง "สิ่งที่ Agent พูด" ออกจากหนึ่งบรรทัดของ stream ที่มันปล่อยอยู่แล้ว
 *
 * ไม่ได้นิยาม protocol ใหม่ — อ่านรูปที่ `--output-format stream-json` (Claude)
 * และ `--json` (Codex) ปล่อยจริงเท่านั้น: ข้อความผู้ช่วยอยู่ใน
 * `message.content[].text` และผลสรุปอยู่ใน `result`
 *
 * บรรทัดที่ไม่เข้าสองรูปนี้ถูกข้าม ไม่เดา ไม่แต่งข้อความขึ้นมาแทน
 */
function agentSpokenText(line: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(line); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const node = parsed as { type?: unknown; result?: unknown; message?: { content?: unknown } };
  const content = node.message?.content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((c): c is { type?: string; text: string } => Boolean(c) && typeof c === "object" && typeof (c as { text?: unknown }).text === "string")
      .map((c) => c.text.trim())
      .filter((t) => t !== "");
    if (texts.length > 0) return texts.join("\n");
  }
  if (node.type === "result" && typeof node.result === "string" && node.result.trim() !== "") return node.result.trim();
  return null;
}

/**
 * เรียก Claude ผ่านขอบเขตที่เชื่อถือได้ แล้วแปลงผลให้เป็นรูปเดียวกับ dispatch ปกติ
 *
 * ที่นี่ไม่มีการตัดสินใจเรื่องสิทธิ์เลย — executable, argv, environment และ
 * โปรไฟล์ sandbox ทั้งหมดถูกกำหนดโดย `control/claude-execution-boundary/`
 * ฟังก์ชันนี้ส่งได้แค่ "งาน" กับ "โฟลเดอร์ที่อนุมัติแล้ว" เท่านั้น
 *
 * หลักฐานที่บันทึกมีเฉพาะชื่อ env ไม่ใช่ค่า และไม่มีอะไรที่มาจาก Keychain
 * เพราะทั้งไฟล์นี้และขอบเขตนั้นไม่เคยอ่าน Keychain — ตัวที่อ่านคือ Claude เอง
 * ในโปรเซสของมัน
 */
async function dispatchViaClaudeBoundary(input: {
  taskId: string; workOrderId: string; workerKind: WorkerKind; workspaceDir: string;
  objective: string; timeoutMs: number; launcherPid: number; onEvent: (line: string) => void;
}): Promise<AgentHostDispatchResult> {
  const { runClaudeCodeLocally } = await import("../claude-execution-boundary/contract");
  const boundary = await runClaudeCodeLocally({
    provider: "CLAUDE_CODE",
    execution_mode: "LOCAL_MACHINE_AUTH",
    caller: "control/agent-gateway/agent-host-dispatch.ts",
    objective: input.objective,
    workspace: input.workspaceDir,
    task_id: input.taskId,
    work_order_id: input.workOrderId,
    timeout_ms: input.timeoutMs,
  });

  // ข้อความระหว่างทางของ Claude เข้าสายหลักฐานเส้นเดียวกับ worker อื่นทุกประการ
  for (const line of boundary.stdout.split("\n")) input.onEvent(line);

  saveEvidence({
    evidence_id: newEvidenceId(), task_id: input.taskId, kind: "execution_output",
    source: "control/claude-execution-boundary/boundary.ts#trusted-boundary",
    recorded_at: new Date().toISOString(),
    payload: {
      execution_mode: "LOCAL_MACHINE_AUTH",
      boundary_status: boundary.status,
      authenticated: boundary.authenticated,
      api_key_source: boundary.api_key_source,
      executable: boundary.executable,
      sanitized_argv: boundary.sanitized_argv,
      env_names: boundary.env_names,
      sandbox_profile_hash: boundary.sandbox_profile_hash,
      exit_code: boundary.exit_code,
      reason: boundary.reason,
    },
  });

  // คำขอที่ไม่ผ่านประตูของขอบเขต = worker ใช้ไม่ได้ ไม่ใช่ "รันแล้วล้มเหลว"
  if (boundary.status === "EXECUTABLE_UNAVAILABLE" || boundary.status === "CALLER_NOT_ALLOWED" || boundary.status === "INVALID_REQUEST") {
    return { task_id: input.taskId, worker_kind: input.workerKind, status: "WORKER_NOT_AVAILABLE",
      reason: `${boundary.status}: ${boundary.reason ?? ""}` };
  }

  return {
    task_id: input.taskId, worker_kind: input.workerKind, status: "LAUNCHED",
    launch: {
      launchId: boundary.launch_id,
      pid: boundary.pid,
      parentPid: input.launcherPid,
      cwd: input.workspaceDir,
      // ชื่อเท่านั้น — ค่าไม่ถูกบันทึกลงหลักฐานไม่ว่ากรณีใด
      envPassed: Object.fromEntries(boundary.env_names.map((name) => [name, "(passed — value never recorded)"])),
      stdout: boundary.stdout,
      stderr: boundary.stderr,
      exitCode: boundary.exit_code,
      signal: null,
      timedOut: boundary.status === "TIMED_OUT",
      startedAt: boundary.started_at,
      completedAt: boundary.ended_at,
      durationMs: new Date(boundary.ended_at).getTime() - new Date(boundary.started_at).getTime(),
    },
  };
}

export async function runAgentWorkOrder(workOrder: WorkOrder, origin: string | AgentExecutionOrigin, hostEnv: Readonly<Record<string, string | undefined>>): Promise<DnaOsAgentResult> {
  const executionOrigin: AgentExecutionOrigin =
    typeof origin === "string" ? { kind: "DIRECT", correlation_id: origin } : origin;
  const command_id = executionOrigin.kind === "ADMITTED_TASK"
    ? executionOrigin.command_id : executionOrigin.correlation_id;
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

  if (executionOrigin.kind === "ADMITTED_TASK" && !executionOrigin.task_id) {
    // ปิดตาย ไม่สร้าง task id แทนให้ — งานที่บอกว่าผ่าน admission แล้วต้องมี identity ของมันจริง
    return {
      protocol: MACHINE_CONTRACT_VERSION, work_order_id: `wo-${command_id}`, workspace_id: "(none)",
      launch_id: null, result_id: newEvidenceId(), verification_id: null,
      task_id: "(none)", worker_id: workOrder.agent_run?.worker_kind ?? "(none)",
      status: "FAIL_CLOSED", summary: "execution declared ADMITTED_TASK origin without a task_id",
      error_code: ERROR_CODES.MISSING_ADMITTED_TASK_ID, severity: "CRITICAL",
      artifacts: [], evidence_refs: [], requested_actions: [],
      errors: [{ error_code: ERROR_CODES.MISSING_ADMITTED_TASK_ID, severity: "CRITICAL", retryable: false, required_capability: null }],
      verification: { verified: false, method: "execution_origin_shape", checked_against: ["admitted_task_id_present"] },
      runtime: { launcher_pid: launcherPid, sandbox_pid: null, agent_pid: null, ppid_chain: [launcherPid],
        uid: typeof process.getuid === "function" ? process.getuid() : -1, executable: "(none)", workspace: "(none)",
        sandbox_profile_hash: null, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), exit_code: null },
      exit_code: null,
    };
  }

  const run = workOrder.agent_run;
  const workOrderId = `wo-${command_id}`;
  /**
   * งานที่ admit แล้วใช้ task identity เดิมของมัน ไม่สร้างใหม่
   * งาน DIRECT ไม่มี admitted task จึงได้ id ที่ผูกกับ correlation ของตัวเอง —
   * ไม่ใช่ fallback ของกรณีแรก แต่เป็นคนละเส้นทางที่ประกาศไว้ชัด
   */
  const taskId = executionOrigin.kind === "ADMITTED_TASK"
    ? executionOrigin.task_id
    : `task-${command_id}-agent-host`;

  // WORKSPACE_MANAGER integration (Owner, Phase 2): when a real workspace_id
  // is present, it is the ONLY source of truth for read/write scope — the
  // Agent never chose these paths itself, WorkspaceManager did, before this
  // function ever ran.
  const { getWorkspace, transitionWorkspace, assignAgent } = await import("./workspace-manager");
  const workspace = run.workspace_id ? getWorkspace(run.workspace_id) : undefined;
  const workspaceId = workspace?.workspace_id ?? run.workspace_id ?? "(no-workspace-manager)";
  const readPaths = workspace?.allowed_read_paths ?? run.assigned_source_paths;
  /**
   * P6 ISOLATED CODING (Owner, CONNECT_OWNER_SOFTWARE_WORK_TO_EXISTING_GIT_WORKTREE).
   *
   * ถ้า TaskWorkspace ถูกผูกกับการจอง source ไว้แล้วผ่านสะพานเดิม
   * `linkSourceReservation` ของที่ Agent เขียนได้จริงต้องเป็น git worktree ของ
   * การจองนั้น ไม่ใช่ไดเรกทอรี lifecycle เปล่า ๆ — นี่คือความหมายของการผูก ถ้า
   * ผูกแล้วแต่ยังส่ง path เดิมไปให้ Agent การผูกก็ไม่มีผลอะไรเลย
   *
   * TaskWorkspace ยังเป็นตัวตนของ task/lifecycle เหมือนเดิมทุกอย่าง อ่าน
   * `allowed_read_paths` จากที่เดิม และเมื่อไม่มีการผูก (งานที่ไม่แตะ source จริง)
   * พฤติกรรมเดิมคงอยู่ครบ — ไม่มีการเดา path ของ worktree เอง ต้องค้นจาก
   * `reservation_id` ที่ถูกบันทึกไว้เท่านั้น
   */
  const { loadReservation } = await import("../source-workspace/contract");
  const sourceReservation = workspace?.source_reservation_id ? loadReservation(workspace.source_reservation_id) : null;
  const writeWorkspace = sourceReservation?.worktree_path ?? workspace?.allowed_write_workspace ?? run.workspace_path;

  if (workspace) {
    transitionWorkspace(workspaceId, "PREPARE_CONTEXT", "context resolved from WorkspaceManager");
    assignAgent(workspaceId, run.worker_kind);
    transitionWorkspace(workspaceId, "RUNNING", `dispatching to Agent Host, task_id=${taskId}`);
  }

  /**
   * STRUCTURED AGENT INPUT (Owner, COMPLETE_STRUCTURED_AGENT_INPUT).
   *
   * ก่อนหน้านี้ `DnaOsAgentInput` ถูกประกาศไว้แต่ไม่มีใครสร้างเลย — สิ่งที่ถึงตัว
   * Agent จริงคือ `run.instruction` ดิบ ๆ ซึ่งแปลว่ามีแหล่งความจริงสองทางวิ่งขนานกัน
   * ตรงนี้คือจุดที่สายขาด และนี่คือจุดที่ต่อ
   *
   * ทุกฟิลด์มาจากสิ่งที่ระบบ resolve มาแล้วก่อนถึงบรรทัดนี้ ไม่มีฟิลด์ไหนที่ Agent
   * เป็นคนบอก และไม่มีฟิลด์ไหนที่เดาขึ้นมา — `authorization_reference` เป็น null ได้
   * ถ้างานนั้นยังไม่มี policy decision ซึ่งเป็นการรายงานว่า "ไม่มีแหล่งที่มา"
   * ไม่ใช่การเติมค่าหลอก
   */
  const policyEvidenceId = ((): string | null => {
    try {
      const ev = loadEvidenceForTask(taskId).find((e) => e.kind === "policy_decision");
      return ev?.evidence_id ?? null;
    } catch { return null; }
  })();
  const agentInput: DnaOsAgentInput = {
    protocol: MACHINE_INPUT_CONTRACT_VERSION,
    work_order_id: workOrderId,
    workspace_id: workspaceId,
    objective: run.instruction,
    context_refs: run.dependency_read_paths,
    source_refs: readPaths,
    allowed_operations: [workOrder.operation === "CREATE" ? "FILE_CREATE" : "FILE_MODIFY"],
    expected_outputs: [],
    acceptance_criteria: [],
    task_type: workOrder.operation === "CREATE" ? "CREATE_FILE" : "MODIFY_FILE",
    authorization_reference: policyEvidenceId,
    allowed_write_paths: [writeWorkspace],
    forbidden_files: workOrder.forbidden_files,
    verification_requirements: workOrder.required_tests,
    required_checks: [],
    expected_result_contract: MACHINE_CONTRACT_VERSION,
  };

  const resolution = resolveWorker(run.worker_kind);
  /**
   * คำสั่งที่ worker ได้รับต้อง "มาจาก" สัญญานี้ ไม่ใช่ช่องทางอิสระอีกช่องหนึ่ง
   * จึงเรนเดอร์จาก `agentInput.objective` ไม่ใช่จาก `run.instruction` โดยตรง
   * — ค่าเดียวกันในวันนี้ แต่แหล่งความจริงเหลือทางเดียว ถ้าวันหน้ามีใครแก้
   * objective ระหว่างทาง คำสั่งที่ Agent ได้รับจะเปลี่ยนตาม ไม่ใช่แยกกันเดิน
   */
  const argv = resolution.ok ? buildInstructionArgv(run.worker_kind, agentInput.objective, resolution.worker.defaultArgv) : [];

  /**
   * ขอบเขตที่ kernel จะบังคับ ต้องเท่ากับที่บอก Agent ไว้เป๊ะ
   * ถ้าไม่ตรง แปลว่า Agent กำลังจะทำงานใต้ขอบเขตที่มันไม่ได้ถูกบอก — หยุดดีกว่ารัน
   */
  const kernelWriteScope = writeWorkspace;
  if (agentInput.allowed_write_paths[0] !== kernelWriteScope) {
    throw new Error(`AGENT_INPUT_SCOPE_MISMATCH: declared=${agentInput.allowed_write_paths[0]} kernel=${kernelWriteScope}`);
  }

  // หลักฐานของ "สิ่งที่ถูกอนุญาตจริง" — เก็บก่อนปล่อยโปรเซส ไม่ใช่หลังจากรู้ผล
  const inputEvidenceId = newEvidenceId();
  saveEvidence({ evidence_id: inputEvidenceId, task_id: taskId, kind: "execution_output",
    source: "control/agent-gateway/agent-host-dispatch.ts#DNA_OS_AGENT_INPUT_V1",
    recorded_at: new Date().toISOString(), payload: { agent_input: agentInput } });

  /**
   * AGENT_MESSAGE (Owner, USE_EXISTING_CONTINUATION_MODEL ข้อ 1)
   *
   * ทุกอย่างที่ Agent พูดระหว่างทางถูกบันทึกเป็น evidence แถวหนึ่งต่อหนึ่งข้อความ
   * ด้วย `saveEvidence` ตัวเดิมและ kind เดิม ("execution_output") — ไม่มีสโตร์ใหม่
   * ไม่มีชนิดใหม่ ผูกกับ task_id เดียวกับผลสุดท้าย จึงตามกลับได้ด้วยของที่มีอยู่
   *
   * นี่คือสิ่งที่หายไปทั้งหมดก่อนหน้านี้: โปรเซสพูดออกมาจริง แต่ไม่มีใครฟัง
   */
  const spoken: string[] = [];
  const onEvent = (line: string): void => {
    const text = agentSpokenText(line);
    if (text === null) return;
    spoken.push(text);
    saveEvidence({
      evidence_id: newEvidenceId(), task_id: taskId, kind: "execution_output",
      source: "control/agent-gateway/agent-host-dispatch.ts#agent-message",
      recorded_at: new Date().toISOString(),
      payload: { agent_message: text, sequence: spoken.length },
    });
  };

  /**
   * CLAUDE เดินคนละขอบเขตกับ worker อื่น (Owner, IMPLEMENT_LOCAL_CLAUDE_CODE_
   * TRUSTED_EXECUTION_BOUNDARY) เพราะมันต้องใช้การยืนยันตัวตนของเครื่องที่ Owner
   * ล็อกอินไว้แล้ว ซึ่งต้องการสิทธิ์ที่ Agent ทั่วไปต้องไม่มีเด็ดขาด
   *
   * ผลลัพธ์ถูกประกอบให้มีรูปเดียวกับที่ `dispatchToAgentHost` คืน ทุกบรรทัดที่อยู่
   * ใต้จุดนี้ (interpretLaunchResult, evidence, runtime, workspace transition)
   * จึงทำงานเหมือนเดิมทั้งหมด — ไม่มีเส้นทางแปลผลชุดที่สองในระบบ
   *
   * CODEX / LOCAL / GEMINI ไม่ถูกแตะเลย ยังเดิน launchAgent ตัวเดิมและกรงเดิม
   */
  const dispatch = run.worker_kind === "CLAUDE"
    ? await dispatchViaClaudeBoundary({
      taskId, workOrderId, workerKind: run.worker_kind, workspaceDir: writeWorkspace,
      objective: agentInput.objective, timeoutMs: run.timeout_ms, launcherPid, onEvent,
    })
    : await dispatchToAgentHost({
      task_id: taskId,
      onEvent,
      worker_kind: run.worker_kind,
      workspace_dir: writeWorkspace,
      instructionArgv: argv,
      timeoutMs: run.timeout_ms,
      outsideProbeDirs: unassignedSiblingRepos(readPaths),
      // อ่านได้เฉพาะที่ระบบ resolve มาให้แล้ว: source ที่มอบหมาย + dependency ที่ประกาศ
      repositoryReadPaths: [...readPaths, ...run.dependency_read_paths],
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
