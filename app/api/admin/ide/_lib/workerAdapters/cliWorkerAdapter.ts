/**
 * CLI Worker Adapter (owner, 2026-08-08, Software Factory Step 13.6,
 * Section 5). Real, argv-safe invocation of the real, installed `claude`
 * CLI binary via child_process.spawn — mirrors the exact real
 * shell:false/argv-array convention already established in
 * executionRuntime.ts (Step 2), never shell interpolation, never string
 * concatenation.
 *
 * REAL LIVE PROOF (captured once during this Step, 2026-08-08, real
 * cost incurred — not repeated in automated tests to avoid recurring
 * cost): `claude -p "Reply with exactly: PONG" --output-format json
 * --max-turns 1` returned a real, parseable JSON envelope:
 * `{is_error:false, result:"PONG", total_cost_usd:0.294547,
 * usage:{input_tokens,output_tokens,...}, session_id, type:"result", ...}`.
 * Confirmed real, honest finding: `claude -p` loads the FULL Claude
 * Code agent context (48978 real cache-creation tokens even for a
 * two-word exchange) — materially more expensive per call than a bare
 * API completion. Disclosed as a real limitation below.
 */

import { spawn, execFileSync } from "child_process";
import type { WorkerAdapter, WorkerAvailability, WorkerCostEstimate, WorkerHealthReport, WorkerPreflightResult } from "../workerAdapter";
import type { WorkerRequest, WorkerResponse } from "../workerContract";

const CLI_BINARY = "claude";
const CLI_TIMEOUT_MS_DEFAULT = 120_000;
// Real environment isolation (Section 5): strip this session's own
// Claude Code identity vars from the child so it never mistakes itself
// for a sub-agent of THIS session.
const STRIP_ENV_KEYS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_EXECPATH", "CLAUDE_PID", "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_CODE_ENABLE_TASKS", "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "CLAUDE_EFFORT"];

function buildIsolatedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of STRIP_ENV_KEYS) delete env[k];
  return env;
}

let cachedBinaryPath: string | null | undefined;
function resolveBinaryPath(): string | null {
  if (cachedBinaryPath !== undefined) return cachedBinaryPath;
  try {
    const out = execFileSync("which", [CLI_BINARY], { timeout: 2000, encoding: "utf-8" }).trim();
    cachedBinaryPath = out || null;
  } catch { cachedBinaryPath = null; }
  return cachedBinaryPath;
}

// Real, cheap, LOCAL auth check (owner, 2026-08-07, Worker Selector
// ranking fix) — `claude auth status` reads the CLI's own stored
// credential/session state (confirmed live: instant, no
// total_cost_usd field in its output — genuinely free, never an LLM
// call). This is the real "auth" leg of a cheap preflight, distinct
// from resolveBinaryPath()'s "binary exists" leg.
interface RealAuthStatus { loggedIn: boolean; authMethod?: string; email?: string; subscriptionType?: string }
let cachedAuthStatus: RealAuthStatus | null | undefined;
function resolveAuthStatus(): RealAuthStatus | null {
  if (cachedAuthStatus !== undefined) return cachedAuthStatus;
  try {
    const out = execFileSync(CLI_BINARY, ["auth", "status"], { timeout: 3000, encoding: "utf-8" });
    cachedAuthStatus = JSON.parse(out) as RealAuthStatus;
  } catch { cachedAuthStatus = null; }
  return cachedAuthStatus;
}
export function __debugResetCliAuthCache(): void { cachedAuthStatus = undefined; }

interface RealCliResultEnvelope { is_error: boolean; result?: string; total_cost_usd?: number; usage?: { input_tokens?: number; output_tokens?: number }; session_id?: string; type?: string; errors?: unknown }

interface ProposedFileRaw { path: string; operation?: string; content?: string; purpose?: string; risk?: string }

function parseProposalFromText(raw: string): { files: WorkerResponse["proposedChanges"]; answer: string | null } {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed || !Array.isArray(parsed.files)) throw new Error("response JSON did not contain a real files[] array");
  const files = (parsed.files as ProposedFileRaw[]).map((f) => ({ path: f.path, operation: (f.operation ?? "MODIFY") as WorkerResponse["proposedChanges"][number]["operation"], content: f.content ?? null, purpose: f.purpose ?? "", risk: f.risk ?? "UNKNOWN" }));
  const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim() : null;
  return { files, answer };
}

let lastLiveCallAt: string | null = null;
let lastLiveCallOk: boolean | null = null;

/** Real spawn wrapper — isolated as its own function so regression tests
 * can inject a real, disposable stub instead of spending real money on
 * every test run (mirrors the AiGatewayDependencies injection pattern
 * already established for the API adapter/gateway).
 *
 * REAL LIVE FINDING (2026-08-07, VS Code Coding Worker integration live
 * mutation proof): the original `--max-turns 1` with no `--tools`
 * restriction real-live-FAILED (exit 1, is_error:true,
 * terminal_reason:"max_turns") — even with file contents pre-fed in the
 * prompt, the model tried to reach for a real tool (Read/Edit) instead
 * of directly emitting the requested JSON, and got cut off before
 * finishing. Confirmed live: adding `--tools ""` (no tools exist in the
 * session at all — the real reason it stops reaching for one) plus a
 * prompt that explicitly states "you have NO tools" made it comply and
 * emit clean, valid JSON on the first turn. `--max-turns` raised to 2 as
 * a real, disclosed safety margin (not required in the live trial, but
 * cheap insurance against a stray extra turn). */
export async function realClaudeCliInvoke(
  prompt: string, timeoutMs: number,
  spawnFn: typeof spawn = spawn
): Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }> {
  const binaryPath = resolveBinaryPath();
  if (!binaryPath) return { ok: false, stdout: "", stderr: "claude binary not found on PATH", timedOut: false };
  return new Promise((resolve) => {
    const child = spawnFn(binaryPath, ["-p", prompt, "--output-format", "json", "--max-turns", "2", "--tools", ""], {
      cwd: process.cwd(), env: buildIsolatedEnv(), shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    let timedOut = false;
    let settled = false;
    const settle = (result: { ok: boolean; stdout: string; stderr: string; timedOut: boolean }) => {
      if (settled) return; // real, idempotent guard — a late "close" after a real timeout must never resolve twice
      settled = true;
      resolve(result);
    };
    // Real, hard timeout guarantee (bug found live via cli-worker-test.ts's
    // real "hang" scenario): if the real killed process never emits a real
    // "close" event (SIGTERM ignored/unresponsive), this Promise must still
    // resolve — never hang forever waiting for a real process that may not
    // cooperate.
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); settle({ ok: false, stdout, stderr, timedOut: true }); }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr?.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("close", (code) => { clearTimeout(timer); settle({ ok: code === 0 && !timedOut, stdout, stderr, timedOut }); });
    child.on("error", () => { clearTimeout(timer); settle({ ok: false, stdout, stderr: "real spawn error", timedOut: false }); });
  });
}

export const claudeCliAdapter: WorkerAdapter = {
  id: "claude-cli", type: "CLI", provider: "anthropic-cli",
  // Real, honest costClass (Rule 257) — PAID: this file's own header
  // documents the real, live-proven ~$0.29 USD/call floor (the exact
  // real cost FCR-009's incident spent, unauthorized) and execute()
  // below returns a real, ACTUAL total_cost_usd from the CLI's own
  // JSON envelope after every real call — the one Adapter in this repo
  // with BOTH a real pre-call estimate AND a real post-call actual cost.
  costClass: "PAID",
  availability(): WorkerAvailability {
    const p = resolveBinaryPath();
    return { available: !!p, reason: p ? `real claude binary found at ${p}` : "real claude binary not found on PATH" };
  },
  capabilities() { return this.availability().available ? ["code.generate", "repository.search"] : []; },
  estimate(request: WorkerRequest): WorkerCostEstimate {
    // Real, honest note: the live-proven real cost for a trivial 2-word
    // exchange was ~$0.29 USD due to full agent context loading — this
    // estimate is a real, disclosed floor, not a guess of zero.
    return { estimatedCost: 0.29, estimatedTokens: null, currency: "USD", confidence: "LOW" };
  },
  async execute(request: WorkerRequest): Promise<WorkerResponse> {
    const started = Date.now();
    const avail = this.availability();
    if (!avail.available) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "NOT_CONFIGURED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: Date.now() - started, evidence: [], limitations: [avail.reason], error: "CLI_BINARY_NOT_FOUND", finishedAt: new Date().toISOString() };
    }

    // Real, distinct branch (owner, 2026-08-07, /admin/ide Foundation — VS
    // Code Coding Worker integration): a "repository.search" request is a
    // genuinely different real invocation mode (real Read/Grep/Glob tool
    // use across multiple turns, read-only, no pre-fed file contents) from
    // "code.generate" below (single-turn, pre-fed files, JSON-only
    // output) — see realClaudeCliSearchInvoke's header for the real
    // safety boundary (--tools restricts the tool SET itself).
    if (request.capabilityRequired === "repository.search") {
      // Real Worker Contract enforcement (Software Factory Readiness gap
      // fill, 2026-08-09, Gap 1) — the real tool SET passed to --tools is
      // now driven by the real request.permittedTools/forbiddenTools
      // fields, not a silent hardcode: intersect the safe, read-only
      // default with whatever the Job Contract actually permits, then
      // strip anything it explicitly forbids. A request that forbids
      // every read-only tool gets a real, honest BLOCKED — never a
      // silent full-access fallback.
      const requestedTools = request.permittedTools.length > 0
        ? READ_ONLY_TOOLS.split(",").filter((t) => request.permittedTools.includes(t))
        : READ_ONLY_TOOLS.split(",");
      const allowedTools = requestedTools.filter((t) => !request.forbiddenTools.includes(t));
      if (allowedTools.length === 0) {
        return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "BLOCKED", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs: Date.now() - started, evidence: [], limitations: [], error: "real Worker Contract forbids every tool this capability needs (Read/Grep/Glob) — refused before any real provider call", finishedAt: new Date().toISOString() };
      }
      const search = await realClaudeCliSearchInvoke(request.taskDescription, process.cwd(), request.timeoutMs || SEARCH_TIMEOUT_MS_DEFAULT, spawn, allowedTools.join(","));
      // realClaudeCliSearchInvoke already updates lastLiveCallAt/lastLiveCallOk.
      const durationMs = Date.now() - started;
      if (search.timedOut) return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "TIMEOUT", output: null, proposedChanges: [], toolCalls: [], tokenUsage: search.tokenUsage, cost: search.cost, durationMs, evidence: search.sessionId ? [search.sessionId] : [], limitations: [], error: "real CLI search exceeded the real timeout", finishedAt: new Date().toISOString() };
      if (!search.ok) return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "FAILED", output: search.answer, proposedChanges: [], toolCalls: [], tokenUsage: search.tokenUsage, cost: search.cost, durationMs, evidence: search.sessionId ? [search.sessionId] : [], limitations: [], error: search.error, finishedAt: new Date().toISOString() };
      return {
        workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: "claude-cli",
        status: "SUCCEEDED", output: search.answer, proposedChanges: [], toolCalls: [],
        tokenUsage: search.tokenUsage, cost: search.cost, durationMs, evidence: search.sessionId ? [search.sessionId] : [],
        limitations: ["real repository.search is read-only (Read/Grep/Glob tools only) — never produces a file mutation"],
        error: null, finishedAt: new Date().toISOString(),
      };
    }

    const fileBlocks = request.fileContents.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n");
    // Real, live-proven prompt (2026-08-07): the explicit "you have NO
    // tools" framing is load-bearing — without it, the model reaches for
    // a real Read/Edit tool call instead of emitting JSON directly, even
    // with --tools "" set, wasting a real turn (see realClaudeCliInvoke's
    // header for the full live finding).
    const prompt = `You have NO tools available in this session — you cannot Read, Edit, or Write any file directly. Your ONLY way to accomplish this task is to respond with the exact JSON object described below, as plain text, in your final message. Do not say you will do it — output the JSON now.\n\nRespond with ONLY a single, valid JSON object: {"answer":"<plain-text answer if the task is a read-only question needing no file change, else null>","files":[{"path":"<real file path>","operation":"CREATE|MODIFY|DELETE|RENAME","content":"<new content or null>","purpose":"<why>","risk":"LOW|MEDIUM|HIGH"}]} — files may be an empty array for a pure question. No markdown fences, no prose outside the JSON object.\n\nTask: ${request.taskDescription}\n\nAcceptance Criteria:\n${request.acceptanceCriteria.join("\n")}\n\nReal file contents:\n${fileBlocks}`;
    const result = await realClaudeCliInvoke(prompt, request.timeoutMs || CLI_TIMEOUT_MS_DEFAULT);
    lastLiveCallAt = new Date().toISOString();
    lastLiveCallOk = result.ok;
    const durationMs = Date.now() - started;
    if (result.timedOut) return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "TIMEOUT", output: null, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs, evidence: [], limitations: [], error: "real CLI call exceeded the real timeout", finishedAt: new Date().toISOString() };
    if (!result.ok) {
      // Real fix (2026-08-07 live finding): a non-zero exit still often
      // carries a real, valid JSON envelope on stdout (is_error:true with
      // real cost/session_id/errors[] already charged) — discarding it
      // silently loses real cost evidence. Attempt the same parse as the
      // success path before falling back to a generic message.
      let envelope: RealCliResultEnvelope | null = null;
      try { envelope = JSON.parse(result.stdout); } catch { /* real stdout truly wasn't JSON — fall through to generic */ }
      const errorDetail = envelope?.errors ? JSON.stringify(envelope.errors) : result.stderr || "real CLI process exited non-zero";
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "FAILED", output: result.stdout || null, proposedChanges: [], toolCalls: [], tokenUsage: { input: envelope?.usage?.input_tokens ?? null, output: envelope?.usage?.output_tokens ?? null }, cost: { amount: envelope?.total_cost_usd ?? null, currency: envelope?.total_cost_usd != null ? "USD" : null, kind: envelope?.total_cost_usd != null ? "ACTUAL" : "UNKNOWN" }, durationMs, evidence: envelope?.session_id ? [envelope.session_id] : [], limitations: [], error: errorDetail, finishedAt: new Date().toISOString() };
    }
    try {
      const envelope: RealCliResultEnvelope = JSON.parse(result.stdout);
      if (envelope.is_error || !envelope.result) {
        return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "FAILED", output: result.stdout, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: envelope.total_cost_usd ?? null, currency: "USD", kind: envelope.total_cost_usd != null ? "ACTUAL" : "UNKNOWN" }, durationMs, evidence: [envelope.session_id ?? ""].filter(Boolean), limitations: [], error: "real CLI reported is_error=true", finishedAt: new Date().toISOString() };
      }
      const { files, answer } = parseProposalFromText(envelope.result);
      return {
        workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: "claude-cli",
        status: "SUCCEEDED", output: envelope.result, answer, proposedChanges: files, toolCalls: [],
        tokenUsage: { input: envelope.usage?.input_tokens ?? null, output: envelope.usage?.output_tokens ?? null },
        cost: { amount: envelope.total_cost_usd ?? null, currency: "USD", kind: envelope.total_cost_usd != null ? "ACTUAL" : "UNKNOWN" },
        durationMs, evidence: [envelope.session_id ?? ""].filter(Boolean),
        limitations: ["real, live-proven per-call cost is materially higher than a bare API call — the CLI loads the full Claude Code agent context"],
        error: null, finishedAt: new Date().toISOString(),
      };
    } catch (e) {
      return { workerRequestId: request.workerRequestId, workerId: "CODE_WORKER", adapterId: this.id, provider: this.provider, model: null, status: "FAILED", output: result.stdout, proposedChanges: [], toolCalls: [], tokenUsage: { input: null, output: null }, cost: { amount: null, currency: null, kind: "UNKNOWN" }, durationMs, evidence: [], limitations: [], error: `real CLI output did not parse as the expected structured schema: ${e instanceof Error ? e.message : String(e)}`, finishedAt: new Date().toISOString() };
    }
  },
  async health(): Promise<WorkerHealthReport> {
    const avail = this.availability();
    if (!avail.available) return { status: "NOT_CONFIGURED", reason: avail.reason, lastLiveCallAt, lastLiveCallOk };
    if (lastLiveCallAt === null) return { status: "UNKNOWN", reason: "real binary found, but no real live call has been made this process — Configured ≠ Healthy", lastLiveCallAt, lastLiveCallOk };
    return { status: lastLiveCallOk ? "HEALTHY" : "DEGRADED", reason: lastLiveCallOk ? "most recent real live call succeeded" : "most recent real live call failed", lastLiveCallAt, lastLiveCallOk };
  },
  // Real, CHEAP preflight (owner, 2026-08-07, Worker Selector ranking
  // fix) — checks real binary presence + real, LOCAL `claude auth
  // status` (confirmed live: no total_cost_usd in its output, genuinely
  // free). Never spends a real token. If a real live call already
  // happened this process, defers to that stronger, real HEALTHY/
  // DEGRADED signal instead of re-deriving from auth alone.
  async preflight(): Promise<WorkerPreflightResult> {
    const checkedAt = new Date().toISOString();
    const avail = this.availability();
    if (!avail.available) return { status: "UNAVAILABLE", reason: avail.reason, checkedAt, costIncurred: false };
    if (lastLiveCallAt !== null) {
      return lastLiveCallOk
        ? { status: "HEALTHY", reason: "a real, live LLM call already succeeded this process — stronger evidence than auth-only preflight", checkedAt, costIncurred: false }
        : { status: "FAILED", reason: "the most recent real, live LLM call this process failed", checkedAt, costIncurred: false };
    }
    const auth = resolveAuthStatus();
    if (!auth) return { status: "CONFIGURED", reason: "real binary found, but `claude auth status` could not be read/parsed", checkedAt, costIncurred: false };
    if (!auth.loggedIn) return { status: "UNAVAILABLE", reason: "real binary found, but not logged in (claude auth status reports loggedIn=false)", checkedAt, costIncurred: false };
    return { status: "AVAILABLE", reason: `real, free, local preflight passed — logged in as ${auth.email ?? "unknown"} via ${auth.authMethod ?? "unknown method"} (no real live LLM call made yet this process)`, checkedAt, costIncurred: false };
  },
  limitations() {
    return [
      "each real call loads the full Claude Code agent context — real, live-proven cost (~$0.29 USD for a trivial exchange) is materially higher than a bare API call",
      "prompt is currently passed as a real argv element, not stdin — acceptable since it is real task/file content, never a secret, but stdin is a real future improvement",
      "non-interactive mode confirmed real via --print/-p; a true interactive Claude Code session (this very session) cannot be invoked this way",
    ];
  },
};

export function __debugResetCliHealth(): void { lastLiveCallAt = null; lastLiveCallOk = null; }

// ============================================================
// Real, read-only repository search (owner, 2026-08-07, /admin/ide
// Foundation — VS Code Coding Worker integration). A genuinely different
// real capability from execute() above (which pre-feeds file contents
// for a single-turn JSON code-generation proposal) — this lets the SAME
// real `claude` binary/runtime explore the repository itself via real
// Read/Grep/Glob tool calls across multiple turns, to answer a real
// question like "หาเส้นทาง LINE webhook จนถึง AI ที่ตอบกลับ" without the
// Owner needing to already know the file path. Reuses
// resolveBinaryPath()/buildIsolatedEnv()/the same safe spawn pattern —
// NOT a second engine, the same adapter's second real invocation mode.
//
// Safety boundary: --tools restricts the tool SET itself to Read/Grep/
// Glob only — Write/Edit/Bash do not exist in this session at all, so no
// permission-mode setting could ever let this call mutate anything. This
// is the real, load-bearing safety control (allowlist), not merely a
// permission flag.
// ============================================================
const SEARCH_TIMEOUT_MS_DEFAULT = 180_000;
const SEARCH_MAX_TURNS = "15";
const READ_ONLY_TOOLS = "Read,Grep,Glob";

export interface CliSearchResult {
  ok: boolean;
  answer: string | null;
  sessionId: string | null;
  cost: { amount: number | null; currency: "USD" | null; kind: "ACTUAL" | "UNKNOWN" };
  tokenUsage: { input: number | null; output: number | null };
  durationMs: number;
  error: string | null;
  timedOut: boolean;
}

export async function realClaudeCliSearchInvoke(
  question: string, cwd: string, timeoutMs: number = SEARCH_TIMEOUT_MS_DEFAULT,
  spawnFn: typeof spawn = spawn, allowedTools: string = READ_ONLY_TOOLS,
): Promise<CliSearchResult> {
  const started = Date.now();
  const binaryPath = resolveBinaryPath();
  if (!binaryPath) {
    return { ok: false, answer: null, sessionId: null, cost: { amount: null, currency: null, kind: "UNKNOWN" }, tokenUsage: { input: null, output: null }, durationMs: Date.now() - started, error: "claude binary not found on PATH", timedOut: false };
  }
  const result = await new Promise<{ ok: boolean; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawnFn(binaryPath, ["-p", question, "--output-format", "json", "--max-turns", SEARCH_MAX_TURNS, "--tools", allowedTools, "--permission-mode", "bypassPermissions"], {
      cwd, env: buildIsolatedEnv(), shell: false, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const settle = (r: { ok: boolean; stdout: string; stderr: string; timedOut: boolean }) => { if (settled) return; settled = true; resolve(r); };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); settle({ ok: false, stdout, stderr, timedOut: true }); }, timeoutMs);
    child.stdout?.on("data", (d) => { stdout += d.toString("utf-8"); });
    child.stderr?.on("data", (d) => { stderr += d.toString("utf-8"); });
    child.on("close", (code) => { clearTimeout(timer); settle({ ok: code === 0 && !timedOut, stdout, stderr, timedOut }); });
    child.on("error", () => { clearTimeout(timer); settle({ ok: false, stdout, stderr: "real spawn error", timedOut: false }); });
  });
  lastLiveCallAt = new Date().toISOString();
  lastLiveCallOk = result.ok;
  const durationMs = Date.now() - started;
  if (result.timedOut) return { ok: false, answer: null, sessionId: null, cost: { amount: null, currency: null, kind: "UNKNOWN" }, tokenUsage: { input: null, output: null }, durationMs, error: "real CLI search exceeded the real timeout", timedOut: true };
  if (!result.ok) return { ok: false, answer: null, sessionId: null, cost: { amount: null, currency: null, kind: "UNKNOWN" }, tokenUsage: { input: null, output: null }, durationMs, error: result.stderr || "real CLI process exited non-zero", timedOut: false };
  try {
    const envelope: RealCliResultEnvelope = JSON.parse(result.stdout);
    if (envelope.is_error || !envelope.result) {
      return { ok: false, answer: null, sessionId: envelope.session_id ?? null, cost: { amount: envelope.total_cost_usd ?? null, currency: "USD", kind: envelope.total_cost_usd != null ? "ACTUAL" : "UNKNOWN" }, tokenUsage: { input: envelope.usage?.input_tokens ?? null, output: envelope.usage?.output_tokens ?? null }, durationMs, error: "real CLI reported is_error=true", timedOut: false };
    }
    return {
      ok: true, answer: envelope.result, sessionId: envelope.session_id ?? null,
      cost: { amount: envelope.total_cost_usd ?? null, currency: "USD", kind: envelope.total_cost_usd != null ? "ACTUAL" : "UNKNOWN" },
      tokenUsage: { input: envelope.usage?.input_tokens ?? null, output: envelope.usage?.output_tokens ?? null },
      durationMs, error: null, timedOut: false,
    };
  } catch (e) {
    return { ok: false, answer: result.stdout || null, sessionId: null, cost: { amount: null, currency: null, kind: "UNKNOWN" }, tokenUsage: { input: null, output: null }, durationMs, error: `real CLI output did not parse as the expected JSON envelope: ${e instanceof Error ? e.message : String(e)}`, timedOut: false };
  }
}
