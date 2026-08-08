/**
 * Execution Runtime for /admin/ide (owner, 2026-08-05, Phase 4) — the
 * "Validated Runner" + "Process" + "Runtime Events" layers in:
 *
 *   IDE / AI / Voice / Workflow → Execution Runtime → Command Registry
 *   → Validated Runner → Process → Runtime Events / Output / Problems
 *
 * A client (any future caller — UI, AI, Voice, Workflow) can only ever send
 * a commandId + typed dynamic args. This module resolves that id through
 * executionRegistry.ts (the only place executable/argv are decided),
 * spawns with shell:false, and turns raw process output into redacted,
 * ANSI-stripped, sequenced runtime events.
 *
 * Concurrency: a single in-memory run store, per-process (this server
 * instance) global + per-owner concurrency counters, and an in-memory
 * exclusive-lock-key set for commands that write shared registry/build
 * artifacts (build, governance, architecture.check).
 *
 * On the existing DB-backed engines/workspace/lockManager.ts (checked
 * first, per instruction): that lock manager is a real, working system,
 * but for a genuinely different problem — coordinating EDITS to a named
 * file/folder/registry/migration/config/database_schema RESOURCE across
 * concurrent AI sessions via a Postgres unique index, with a Supabase
 * client + actor + sessionId required per call and a 5-minute TTL tuned
 * for "a human or AI editing a file." A spawned child process is not a
 * resource-edit lock: it needs no Postgres round-trip, no TTL (it's freed
 * synchronously the instant the process exits or is killed), and no
 * "resource_type" among that lock's fixed enum actually describes "one
 * command execution slot." Forcing this runtime onto that lock would add a
 * live Supabase dependency to every governed command run for a poor
 * conceptual fit. So exclusiveLockKey here is a new, clearly-scoped,
 * single-process in-memory guard — not a duplicate of the DB lock system,
 * which remains the right tool for actual file/registry edits (as
 * engines/workspace/registryWriter.ts already uses it for).
 */
import { spawn, execFileSync, type ChildProcess } from "child_process";
import { randomUUID, createHash } from "crypto";
import {
  type CommandDefinition,
  ExecutionError,
  buildChildEnv,
  getCommandDefinition,
  resolveWorkingDirectory,
  validateDynamicArgs,
  isCommandDenied,
} from "./executionRegistry";


export type RunStatus = "queued" | "running" | "passed" | "failed" | "cancelled" | "timed_out" | "output_limited";

export type RunEventType =
  | "run.queued" | "run.started" | "run.stdout" | "run.stderr"
  | "run.completed" | "run.failed" | "run.cancelled" | "run.timeout" | "run.output_limited";

export interface RunEvent {
  seq: number;
  type: RunEventType;
  ts: string;
  stream?: "stdout" | "stderr";
  text?: string;
}

export interface RunRecord {
  runId: string;
  commandId: string;
  ownerId: string;
  /** Real actor identity (email) for Audit Evidence — same convention as
   * app/api/admin/ide/file/route.ts's audit log actor field. */
  actor: string;
  status: RunStatus;
  startedAt: string | null;
  queuedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  outputBytes: number;
  truncated: boolean;
  errorCode: string | null;
  /** Real, server-decided cwd the process actually ran in — client never
   * supplies this. */
  workingDirectory: string;
  mode: "READ_ONLY" | "WORKSPACE_WRITE";
  changesWorkspace: boolean;
  /** Whether the client passed ownerConfirmation:true for a
   * requiresOwnerConfirmation command — recorded even though the gate is
   * enforced before a run record is ever created, for a complete audit trail. */
  ownerConfirmation: boolean;
  /** Real, normalized argv actually passed to spawn (fixedArgs + validated
   * dynamic args), redacted the same way stdout/stderr are — never the raw
   * client request body. */
  normalizedArguments: string;
  timedOut: boolean;
  cancelled: boolean;
  stdoutHash: string | null;
  stderrHash: string | null;
  /** Workspace Integrity (owner, 2026-08-06) — real `git status
   * --porcelain=v2` diff between before/after this run, captured for every
   * run (not only changesWorkspace ones) so a READ_ONLY command that
   * unexpectedly changes the workspace is caught, not assumed safe. Null
   * until the after-snapshot is captured (i.e. while still running). */
  workspaceChangedPaths: string[] | null;
  /** True only when a command declared mode:"READ_ONLY" but the real
   * before/after git-status snapshot shows the workspace changed anyway —
   * a real policy violation, never auto-fixed or reverted. */
  workspacePolicyViolation: boolean;
}

interface RunState {
  record: RunRecord;
  events: RunEvent[];
  listeners: Set<(event: RunEvent) => void>;
  child: ChildProcess | null;
  timeoutTimer: NodeJS.Timeout | null;
  graceTimer: NodeJS.Timeout | null;
  killedByRuntime: boolean;
  nextSeq: number;
  /** Captured from the CommandDefinition at start time — NOT re-derived by
   * looking commandId up in the registry later, since that would silently
   * no-op for any definition that isn't in the global registry (e.g. a
   * test fixture definition passed directly to executeDefinition()). */
  exclusiveLockKey: string | null;
  stdoutHasher: ReturnType<typeof createHash>;
  stderrHasher: ReturnType<typeof createHash>;
  /** Real `git status --porcelain=v2` output captured immediately before
   * spawn — null if the snapshot itself failed (e.g. not a git repo in a
   * test fixture cwd), in which case the after-comparison is skipped
   * entirely rather than guessed. */
  workspaceSnapshotBefore: string | null;
  /** Set by the timeout timer / cancelRun() just before killing the child,
   * so the real 'exit' handler below can report the correct terminal
   * status instead of whatever exit code the kill itself produced. */
  _timedOut?: boolean;
  _cancelled?: boolean;
}

// ---- Bounds (single-process, in-memory) ----
const GLOBAL_MAX_CONCURRENT = 4;
const PER_OWNER_MAX_CONCURRENT = 2;
const GRACE_PERIOD_MS = 5_000;
export const MAX_RUN_HISTORY = 50;

const runs = new Map<string, RunState>();
const activeLockKeys = new Set<string>();

function activeCountGlobal(): number {
  let n = 0;
  for (const s of runs.values()) if (s.record.status === "queued" || s.record.status === "running") n++;
  return n;
}
function activeCountForOwner(ownerId: string): number {
  let n = 0;
  for (const s of runs.values()) if (s.record.ownerId === ownerId && (s.record.status === "queued" || s.record.status === "running")) n++;
  return n;
}

/** Evicts the oldest terminal (non-active) run records once history exceeds
 * MAX_RUN_HISTORY — active/queued/running runs are never evicted. */
function evictStaleHistory() {
  const terminal = [...runs.values()]
    .filter((s) => s.record.status !== "queued" && s.record.status !== "running")
    .sort((a, b) => (a.record.completedAt ?? "").localeCompare(b.record.completedAt ?? ""));
  const overflow = runs.size - MAX_RUN_HISTORY;
  if (overflow <= 0) return;
  for (let i = 0; i < Math.min(overflow, terminal.length); i++) {
    runs.delete(terminal[i].record.runId);
  }
}

// ---- Secret redaction ----
const STATIC_REDACTION_PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer\s+\S+/gi,
  /sk-[A-Za-z0-9_-]{10,}/g,
  /(api[_-]?key)\s*[:=]\s*['"]?[\w-]+/gi,
  /\btoken\s*=\s*\S+/gi,
  /\bsecret\s*=\s*\S+/gi,
  /\bpassword\s*=\s*\S+/gi,
];
const SECRET_ENV_NAME_PATTERN = /(_KEY|_SECRET|_TOKEN|_PASSWORD|DATABASE_URL)$/i;

function knownSecretEnvValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 6 && SECRET_ENV_NAME_PATTERN.test(name)) values.push(value);
  }
  return values;
}

function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of STATIC_REDACTION_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  for (const secretValue of knownSecretEnvValues()) {
    if (secretValue.length < 6) continue;
    out = out.split(secretValue).join("[REDACTED]");
  }
  return out;
}

// ---- ANSI / control-sequence stripping (first pass) ----
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1B\[[0-9;?]*[a-zA-Z]|\x1B\][^\x07]*(\x07|\x1B\\)|\x1B[=>]/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function sanitizeChunk(text: string): string {
  return redactSecrets(stripAnsi(text));
}

// ---- Workspace Integrity (owner, 2026-08-06) ----
// Real `git status --porcelain=v2` snapshot, before and after every run
// (not only WORKSPACE_WRITE ones) — a READ_ONLY command that unexpectedly
// changes the workspace must be CAUGHT, not assumed safe because of its
// declared mode. Best-effort: if the cwd isn't a real git repo or git
// itself is unavailable, the snapshot is null and no comparison is made
// (never guessed as "unchanged").
function captureWorkspaceSnapshot(cwd: string): string | null {
  try {
    return execFileSync("git", ["status", "--porcelain=v2"], { cwd, encoding: "utf-8", timeout: 5_000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** Real, best-effort diff of changed paths between two porcelain snapshots
 * — line-set difference, path extracted from each line's last
 * whitespace-separated field (porcelain v2's real format). */
function diffWorkspaceSnapshots(before: string, after: string): string[] {
  const beforeLines = new Set(before.split("\n").filter(Boolean));
  const afterLines = after.split("\n").filter(Boolean);
  const changed = new Set<string>();
  for (const line of afterLines) {
    if (!beforeLines.has(line)) {
      const fields = line.trim().split(/\s+/);
      const p = fields[fields.length - 1];
      if (p) changed.add(p);
    }
  }
  const afterLineSet = new Set(afterLines);
  for (const line of before.split("\n").filter(Boolean)) {
    if (!afterLineSet.has(line)) {
      const fields = line.trim().split(/\s+/);
      const p = fields[fields.length - 1];
      if (p) changed.add(p);
    }
  }
  return [...changed].sort();
}

function emitEvent(state: RunState, partial: Omit<RunEvent, "seq" | "ts">) {
  const event: RunEvent = { ...partial, seq: state.nextSeq++, ts: new Date().toISOString() };
  state.events.push(event);
  for (const listener of state.listeners) listener(event);
}

function releaseSlot(state: RunState) {
  if (state.exclusiveLockKey) activeLockKeys.delete(state.exclusiveLockKey);
  state.child = null;
  if (state.timeoutTimer) { clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
  if (state.graceTimer) { clearTimeout(state.graceTimer); state.graceTimer = null; }
}

function finalize(state: RunState, status: RunStatus, exitCode: number | null, signal: NodeJS.Signals | null, errorCode: string | null) {
  if (state.record.status !== "queued" && state.record.status !== "running") return; // already terminal
  const completedAt = new Date();
  state.record.status = status;
  state.record.completedAt = completedAt.toISOString();
  state.record.exitCode = exitCode;
  state.record.signal = signal;
  state.record.errorCode = errorCode;
  state.record.durationMs = state.record.startedAt ? completedAt.getTime() - new Date(state.record.startedAt).getTime() : 0;
  state.record.timedOut = status === "timed_out";
  state.record.cancelled = status === "cancelled";
  state.record.stdoutHash = state.stdoutHasher.digest("hex");
  state.record.stderrHash = state.stderrHasher.digest("hex");

  // Workspace Integrity — only if a real "before" snapshot was captured
  // (skipped entirely, never guessed, if it wasn't).
  if (state.workspaceSnapshotBefore !== null) {
    const after = captureWorkspaceSnapshot(state.record.workingDirectory);
    if (after !== null) {
      const changed = diffWorkspaceSnapshots(state.workspaceSnapshotBefore, after);
      state.record.workspaceChangedPaths = changed;
      if (state.record.mode === "READ_ONLY" && changed.length > 0 && status !== "failed") {
        // A READ_ONLY command changed the workspace — a real policy
        // violation. Downgrade the outcome to failed (never silently
        // "passed"), record evidence, and NEVER auto-revert the change.
        state.record.workspacePolicyViolation = true;
        state.record.status = "failed";
        state.record.errorCode = "WORKSPACE_POLICY_VIOLATION";
      }
    }
  }

  const eventTypeByStatus: Partial<Record<RunStatus, RunEventType>> = {
    passed: "run.completed", failed: "run.failed", cancelled: "run.cancelled",
    timed_out: "run.timeout", output_limited: "run.output_limited",
  };
  const eventType = eventTypeByStatus[state.record.status] ?? "run.failed";
  emitEvent(state, { type: eventType });
  releaseSlot(state);
  evictStaleHistory();
}

/**
 * Kills the entire process GROUP the runtime itself spawned (owner,
 * 2026-08-06) — not just the direct child PID. child is spawned with
 * detached:true (see executeDefinition), which makes it its own process
 * group leader; a negative PID passed to process.kill() signals the whole
 * group on POSIX, so children-of-children (e.g. `npm run build` spawning
 * real webpack workers) are terminated too, never left orphaned.
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH (already dead) or group already gone — real, expected in the
    // race between the child exiting on its own and this call.
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

function killGracefully(state: RunState, onDone: () => void) {
  const child = state.child;
  if (!child || child.killed || child.exitCode !== null || !child.pid) { onDone(); return; }
  state.killedByRuntime = true;
  killProcessGroup(child.pid, "SIGTERM");
  state.graceTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed && child.pid) killProcessGroup(child.pid, "SIGKILL");
  }, GRACE_PERIOD_MS);
}

/**
 * Low-level engine: spawns a REAL child process for an already-resolved
 * CommandDefinition (shell:false, argv array only, allowlisted env, cwd
 * pinned inside the workspace). This is the actual "Process" layer — both
 * startRun() (the real 9 registry commands, used by the HTTP routes) and
 * the regression suite's fixture-command tests call this exact function,
 * so tests exercise real production execution machinery, not a copy of it.
 */
export interface ExecuteOptions {
  actor: string;
  /** Client-supplied confirmation flag — only meaningful (and required
   * true) when def.requiresOwnerConfirmation is set; ignored otherwise. */
  ownerConfirmation?: boolean;
}

export function executeDefinition(def: CommandDefinition, args: Record<string, unknown> | undefined, ownerId: string, options: ExecuteOptions): RunRecord {
  validateDynamicArgs(def, args);
  const cwd = resolveWorkingDirectory(def);

  // Validated dynamic arg VALUES only, each its own literal argv element —
  // never concatenated into a string, never shell-interpreted. Empty for
  // every real registered command today.
  const dynamicArgv = (def.dynamicArgOrder ?? [])
    .filter((key) => args?.[key] !== undefined)
    .map((key) => String(args![key]));
  const fullArgv = [...def.fixedArgs, ...dynamicArgv];

  // Command Policy — defense-in-depth re-check of the FINAL resolved
  // executable+argv, independent of registry membership (see
  // isCommandDenied's doc comment in executionRegistry.ts).
  const denyCheck = isCommandDenied(def.executable, fullArgv);
  if (denyCheck.denied) {
    throw new ExecutionError("COMMAND_DENIED", denyCheck.reason ?? "command denied by policy");
  }

  // WORKSPACE_WRITE commands require an explicit, real client confirmation
  // — never assumed, never defaulted to allowed.
  if (def.requiresOwnerConfirmation && options.ownerConfirmation !== true) {
    throw new ExecutionError("OWNER_CONFIRMATION_REQUIRED", `command "${def.id}" changes the workspace and requires ownerConfirmation:true`);
  }

  if (!def.allowConcurrent && activeCountGlobal() >= GLOBAL_MAX_CONCURRENT) {
    throw new ExecutionError("CONCURRENCY_LIMIT", "global concurrent run limit reached");
  }
  if (activeCountForOwner(ownerId) >= PER_OWNER_MAX_CONCURRENT) {
    throw new ExecutionError("CONCURRENCY_LIMIT", "per-session concurrent run limit reached");
  }
  if (def.exclusiveLockKey && activeLockKeys.has(def.exclusiveLockKey)) {
    throw new ExecutionError("COMMAND_BUSY", `command "${def.id}" is already running elsewhere (exclusive lock "${def.exclusiveLockKey}")`);
  }

  const runId = randomUUID();
  const queuedAt = new Date().toISOString();
  const record: RunRecord = {
    runId, commandId: def.id, ownerId, actor: options.actor, status: "queued",
    startedAt: null, queuedAt, completedAt: null, durationMs: null,
    exitCode: null, signal: null, outputBytes: 0, truncated: false, errorCode: null,
    workingDirectory: cwd, mode: def.mode, changesWorkspace: def.changesWorkspace,
    ownerConfirmation: options.ownerConfirmation === true,
    normalizedArguments: sanitizeChunk(fullArgv.join(" ")),
    timedOut: false, cancelled: false, stdoutHash: null, stderrHash: null,
    workspaceChangedPaths: null, workspacePolicyViolation: false,
  };
  const state: RunState = {
    record, events: [], listeners: new Set(), child: null, timeoutTimer: null, graceTimer: null,
    killedByRuntime: false, nextSeq: 0, exclusiveLockKey: def.exclusiveLockKey,
    stdoutHasher: createHash("sha256"), stderrHasher: createHash("sha256"),
    workspaceSnapshotBefore: captureWorkspaceSnapshot(cwd),
  };
  runs.set(runId, state);
  emitEvent(state, { type: "run.queued" });

  if (def.exclusiveLockKey) activeLockKeys.add(def.exclusiveLockKey);

  let child: ChildProcess;
  try {
    // detached:true makes the child its own process-group leader, so
    // killProcessGroup() can terminate it AND every real process it spawns
    // (e.g. `npm run build`'s real webpack workers), never just the
    // immediate PID.
    child = spawn(def.executable, fullArgv, {
      cwd, env: buildChildEnv() as NodeJS.ProcessEnv, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
  } catch {
    if (def.exclusiveLockKey) activeLockKeys.delete(def.exclusiveLockKey);
    finalize(state, "failed", null, null, "PROCESS_START_FAILED");
    return record;
  }

  state.child = child;
  record.status = "running";
  record.startedAt = new Date().toISOString();
  emitEvent(state, { type: "run.started" });

  const appendOutput = (stream: "stdout" | "stderr", chunk: Buffer) => {
    if (record.truncated) return; // output cap already hit — drop silently, keep process running until it exits/times out on its own
    const clean = sanitizeChunk(chunk.toString("utf-8"));
    const hasher = stream === "stdout" ? state.stdoutHasher : state.stderrHasher;
    const bytes = Buffer.byteLength(clean, "utf-8");
    if (record.outputBytes + bytes > def.maxOutputBytes) {
      const remaining = Math.max(0, def.maxOutputBytes - record.outputBytes);
      const partial = clean.slice(0, remaining);
      if (partial.length > 0) {
        record.outputBytes += Buffer.byteLength(partial, "utf-8");
        hasher.update(partial);
        emitEvent(state, { type: stream === "stdout" ? "run.stdout" : "run.stderr", stream, text: partial });
      }
      record.truncated = true;
      killGracefully(state, () => finalize(state, "output_limited", state.child?.exitCode ?? null, null, "OUTPUT_LIMIT_REACHED"));
      return;
    }
    record.outputBytes += bytes;
    hasher.update(clean);
    emitEvent(state, { type: stream === "stdout" ? "run.stdout" : "run.stderr", stream, text: clean });
  };

  child.stdout?.on("data", (chunk: Buffer) => appendOutput("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendOutput("stderr", chunk));

  state.timeoutTimer = setTimeout(() => {
    killGracefully(state, () => {});
    // finalize happens in the 'exit' handler below once the process actually dies;
    // mark the intent to report timed_out rather than whatever exit code the kill produces.
    state._timedOut = true;
  }, def.timeoutMs);

  child.on("error", () => {
    finalize(state, "failed", null, null, "PROCESS_START_FAILED");
  });

  child.on("exit", (code, signal) => {
    if (record.truncated && record.status === "running") {
      finalize(state, "output_limited", code, signal, "OUTPUT_LIMIT_REACHED");
      return;
    }
    if (state._timedOut) {
      finalize(state, "timed_out", code, signal, "COMMAND_TIMEOUT");
      return;
    }
    if (state._cancelled) {
      finalize(state, "cancelled", code, signal, "COMMAND_CANCELLED");
      return;
    }
    finalize(state, code === 0 ? "passed" : "failed", code, signal, code === 0 ? null : "EXECUTION_FAILED");
  });

  return record;
}

/**
 * Validated Runner entry point — the only function HTTP routes call to
 * start a run. Resolves commandId through the registry first (the only
 * place that decides executable/argv), then hands off to
 * executeDefinition().
 */
export function startRun(commandId: string, args: Record<string, unknown> | undefined, ownerId: string, options: ExecuteOptions): RunRecord {
  const def = getCommandDefinition(commandId);
  return executeDefinition(def, args, ownerId, options);
}

export function getRun(runId: string, ownerId: string): RunRecord {
  const state = runs.get(runId);
  if (!state) throw new ExecutionError("RUN_NOT_FOUND", "no run with that id");
  if (state.record.ownerId !== ownerId) throw new ExecutionError("RUN_NOT_OWNED", "this run belongs to a different session");
  return state.record;
}

export function listRuns(ownerId: string): RunRecord[] {
  return [...runs.values()]
    .filter((s) => s.record.ownerId === ownerId)
    .map((s) => s.record)
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
}

export function getRunEvents(runId: string, ownerId: string): RunEvent[] {
  const state = runs.get(runId);
  if (!state) throw new ExecutionError("RUN_NOT_FOUND", "no run with that id");
  if (state.record.ownerId !== ownerId) throw new ExecutionError("RUN_NOT_OWNED", "this run belongs to a different session");
  return state.events;
}

export function cancelRun(runId: string, ownerId: string): RunRecord {
  const state = runs.get(runId);
  if (!state) throw new ExecutionError("RUN_NOT_FOUND", "no run with that id");
  if (state.record.ownerId !== ownerId) throw new ExecutionError("RUN_NOT_OWNED", "this run belongs to a different session");
  if (state.record.status !== "queued" && state.record.status !== "running") return state.record; // already terminal, no-op
  state._cancelled = true;
  killGracefully(state, () => {});
  return state.record;
}

/**
 * Subscribes to live events for a run — replays buffered history first,
 * then streams new events as they occur. Returns an unsubscribe function.
 * Used by the SSE route; ownership must be checked by the caller before
 * subscribing (this function itself does not re-check, to keep it a plain
 * event-plumbing primitive).
 */
export function subscribeToRunEvents(runId: string, onEvent: (event: RunEvent) => void): { replay: RunEvent[]; unsubscribe: () => void } | null {
  const state = runs.get(runId);
  if (!state) return null;
  state.listeners.add(onEvent);
  return {
    replay: [...state.events],
    unsubscribe: () => { state.listeners.delete(onEvent); },
  };
}

export function isRunTerminal(status: RunStatus): boolean {
  return status !== "queued" && status !== "running";
}

// ---- Test-only introspection (never imported by any route) ----
export function __debugRunCount(): number {
  return runs.size;
}
export function __debugActiveLockKeys(): string[] {
  return [...activeLockKeys];
}
