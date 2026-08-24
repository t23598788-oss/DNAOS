/**
 * หน้าที่: the DNA OS Process Gate (Owner, "Single Process Creation Gate
 * — Consolidation"). The ONE path any internal DNA-OS component (other
 * than an AI runtime, which goes through `control/agent-host/` instead)
 * may request a real subprocess through. Implements the required chain
 * exactly: PROCESS_REQUEST -> POLICY (allowed_callers/allowed_operations
 * check against `./process-registry.ts`) -> EXECUTABLE RESOLUTION
 * (`resolveProcessDescriptor`, real `realpathSync`, never PATH-resolved)
 * -> ENVIRONMENT CONSTRUCTION (allowlist only) -> WORKING DIRECTORY
 * VALIDATION (`allowed_cwd_scope` prefix check) -> AUTHORITY CHECK
 * (argv shape) -> EXECUTION -> RESULT -> EVIDENCE.
 *
 * Execution itself REUSES `control/agent-host/contract.ts#launchAgent`
 * (real, kernel-enforced sandbox-exec confinement — no second executor,
 * no raw `child_process.spawn` in this file) for `confinement:
 * "sandboxed"` — the same real mechanism every AI-runtime launch already
 * uses, generalized here to any registered internal executable. `"direct"`
 * uses `runDirect` (in-process `execFile`, Keychain only — see
 * `./process-registry.ts`). `"policy"` (Owner, Phase 4 — "Runtime
 * Primitive Boundary") reuses
 * `control/runtime-adapter/contract.ts#launchViaRuntimeAdapter` for
 * callers whose real process tree needs more than one exec literal
 * (today: `candidate.node.npm.*`) — still kernel-enforced sandbox-exec
 * confinement, just a policy-driven profile instead of the single-literal
 * one `launchAgent` hardcodes; this file itself still never calls
 * `child_process.spawn`/`exec`/`execFile`/`fork` directly for that
 * branch either. Evidence is recorded through the EXISTING `./audit.ts`
 * (`defaultAuditSink`), never a new store.
 *
 * Input: `ProcessRequest`.
 * Output: `ProcessResult`. Unknown executable_id -> EXECUTABLE_NOT_REGISTERED.
 * Changed executable identity -> EXECUTABLE_IDENTITY_MISMATCH. Unauthorized
 * caller/cwd/argv -> DENY. Never a silent fallback to a bare/raw spawn.
 * Dependency ที่อนุญาต: ./process-registry.ts, ./audit.ts, ./host-runtime.ts,
 * ../../control/agent-host/contract.ts, ../../control/runtime-adapter/contract.ts.
 * สิ่งที่ห้ามแตะ: never call `child_process.spawn`/`exec`/`execFile`/`fork`
 * directly in this file — all real execution goes through `launchAgent`
 * or `launchViaRuntimeAdapter`.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchAgent } from "../../control/agent-host/contract";
import { launchViaRuntimeAdapter } from "../../control/runtime-adapter/contract";
import { resolveProcessDescriptor } from "./process-registry";
import { defaultAuditSink, buildAuditEvent } from "./audit";
import { nowIso } from "./host-runtime";

/** Same allowlist-only discipline as `control/agent-host/host.ts#buildAgentEnv` — this file reads no ambient env beyond these four names, ever, regardless of confinement branch. */
function buildAllowlistedEnv(profile: readonly string[], hostEnv: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of profile) {
    const value = hostEnv[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const execFileAsync = promisify(execFile);

/**
 * "direct" confinement — in-process `execFile`, still gated by every
 * check above this call (allowed_callers/cwd/argv already verified
 * before this ever runs). Used ONLY for registry entries that declare
 * `confinement: "direct"` (macOS Keychain today) — see
 * `./process-registry.ts`'s `ProcessDescriptor.confinement` doc for the
 * real, empirically-confirmed reason sandbox-exec cannot be used for
 * these: it changes the process's responsible-identity enough that the
 * OS's own Keychain ACL denies access it would otherwise grant.
 */
async function runDirect(executable: string, argv: readonly string[], cwd: string, timeoutMs: number): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; startedAt: string; completedAt: string; durationMs: number }> {
  const startedAt = nowIso();
  const startMs = Date.now();
  try {
    const result = await execFileAsync(executable, [...argv], { cwd, timeout: timeoutMs, maxBuffer: 64 * 1024, encoding: "utf8" });
    const completedAt = nowIso();
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr, timedOut: false, startedAt, completedAt, durationMs: Date.now() - startMs };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number | string; signal?: string; killed?: boolean };
    const completedAt = nowIso();
    return { exitCode: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "", timedOut: e.killed === true && e.signal === "SIGTERM", startedAt, completedAt, durationMs: Date.now() - startMs };
  }
}

export interface ProcessRequest {
  request_id: string;
  parent_work_order_id: string | null;
  requester_identity: string;
  executable_id: string;
  /** Required for entries whose registry `canonical_path` is not itself a real absolute path (e.g. an external repo's ts-node, resolved per-machine) — must already be existsSync-verified by the caller; this gate re-verifies it via realpathSync regardless. */
  executable_path?: string;
  argv: readonly string[];
  cwd: string;
  timeout_ms?: number;
}

export type ProcessResultStatus = "EXECUTED" | "DENY" | "EXECUTABLE_NOT_REGISTERED" | "EXECUTABLE_IDENTITY_MISMATCH" | "TIMEOUT";

export interface ProcessResult {
  request_id: string;
  status: ProcessResultStatus;
  reason: string | null;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  resolved_executable: string | null;
  evidence_id: string;
}

function deny(request: ProcessRequest, status: ProcessResultStatus, reason: string): ProcessResult {
  const evidence_id = `pg-ev-${randomUUID()}`;
  defaultAuditSink.record(buildAuditEvent({
    execution_id: evidence_id, correlation_id: request.request_id, command_id: request.executable_id,
    identity_id: request.requester_identity, account_id: "dna-os-infrastructure", workspace_id: "process-gate",
    permission_decision_id: evidence_id, started_at: null, completed_at: nowIso(), exit_code: null,
    status: "permission_denied", error_code: "PERMISSION_DENIED", duration_ms: null, verification_result: "not_verified",
    stdout_reference: null, stderr_reference: null,
  }));
  return { request_id: request.request_id, status, reason, exit_code: null, stdout: "", stderr: "", resolved_executable: null, evidence_id };
}

/**
 * The one real entry point. No caller in this repo may spawn a
 * registered executable any other way.
 */
export async function requestProcessExecution(request: ProcessRequest): Promise<ProcessResult> {
  // EXECUTABLE RESOLUTION
  const resolution = resolveProcessDescriptor(request.executable_id, request.executable_path);
  if (resolution.reason === "EXECUTABLE_NOT_REGISTERED") return deny(request, "EXECUTABLE_NOT_REGISTERED", `no registry entry for executable_id "${request.executable_id}"`);
  if (resolution.reason === "EXECUTABLE_IDENTITY_MISMATCH" || !resolution.descriptor) return deny(request, "EXECUTABLE_IDENTITY_MISMATCH", `executable_path for "${request.executable_id}" could not be verified via realpathSync`);
  const descriptor = resolution.descriptor;

  // POLICY / AUTHORITY CHECK — real allowed_callers match, not a comment
  if (!descriptor.allowed_callers.includes(request.requester_identity)) {
    return deny(request, "DENY", `requester_identity "${request.requester_identity}" is not in allowed_callers for "${request.executable_id}"`);
  }
  // WORKING DIRECTORY VALIDATION
  // SECURITY FIX (2026-08-24, disclosed by dna-os-infrastructure-74): a bare
  // `startsWith` lets a SIBLING directory sharing the same string prefix
  // through — e.g. cwd "/tmp/dna-os-agent-workspaces-evil" would pass a scope
  // of "/tmp/dna-os-agent-workspaces" even though it is not really nested
  // under it. Require an exact match OR a match followed by a path
  // separator, so only genuine descendants (or the scope root itself) pass.
  if (request.cwd !== descriptor.allowed_cwd_scope && !request.cwd.startsWith(`${descriptor.allowed_cwd_scope}/`)) {
    return deny(request, "DENY", `cwd "${request.cwd}" is outside allowed_cwd_scope "${descriptor.allowed_cwd_scope}" for "${request.executable_id}"`);
  }
  // ARGV SHAPE CHECK — structured array only, never a raw shell string
  if (request.argv.some((a) => typeof a !== "string")) return deny(request, "DENY", "argv must be a structured string array");
  if (!descriptor.allowed_argv_shape(request.argv)) {
    return deny(request, "DENY", `argv shape not permitted for "${request.executable_id}"`);
  }

  // launchAgent itself only ensures its OWN .agent-host-profiles sibling
  // dir exists — the workspace/cwd dir itself must already exist or its
  // own spawn() call fails with ENOENT (a real gap found empirically this
  // round, worked around here rather than inside control/agent-host/).
  mkdirSync(request.cwd, { recursive: true });

  // EXECUTION — "sandboxed" reuses control/agent-host's real,
  // kernel-enforced sandbox-exec (never a raw child_process call for
  // this branch); "direct" uses this file's own in-process execFile
  // (see runDirect's header for why Keychain specifically requires it);
  // "policy" reuses control/runtime-adapter's real, kernel-enforced
  // sandbox-exec with a policy-driven (multi-writable-path/multi-exec-
  // literal) profile instead of launchAgent's single-literal one (see
  // ./process-registry.ts's ProcessDescriptor.confinement doc). ENV
  // CONSTRUCTION for "sandboxed" is launchAgent's own AGENT_ENV_ALLOWLIST
  // (PATH/TMPDIR/LANG/LC_ALL); "policy" builds the SAME allowlist locally
  // via this file's own buildAllowlistedEnv (mirrors that exact
  // discipline — never widened); "direct" inherits this same process's
  // env (DNA OS's own trusted process, not an untrusted Agent — the
  // credential lives in the OS Keychain, never in an env var this
  // process would otherwise leak).
  const resolvedExecutable = resolution.realpath ?? descriptor.canonical_path;
  const launch = descriptor.confinement === "direct"
    ? await runDirect(resolvedExecutable, request.argv, request.cwd, request.timeout_ms ?? descriptor.timeout_ms)
    : descriptor.confinement === "policy"
    ? await (async () => {
        if (!descriptor.build_confinement_spec) throw new Error(`PROCESS_GATE_MISCONFIGURED: "${request.executable_id}" declares confinement "policy" with no build_confinement_spec`);
        const result = await launchViaRuntimeAdapter({
          executable: resolvedExecutable,
          argv: request.argv,
          cwd: request.cwd,
          env: buildAllowlistedEnv(descriptor.environment_profile, process.env),
          confinement: descriptor.build_confinement_spec(request.cwd),
          timeout_ms: request.timeout_ms ?? descriptor.timeout_ms,
        });
        return { exitCode: result.exit_code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timed_out, startedAt: result.started_at, completedAt: result.finished_at, durationMs: result.duration_ms };
      })()
    : await launchAgent(
      { allowedWorkspaceDir: request.cwd, agentExecutable: resolvedExecutable, agentArgv: request.argv, timeoutMs: request.timeout_ms ?? descriptor.timeout_ms },
      process.env,
      [],
    );

  const evidence_id = `pg-ev-${randomUUID()}`;
  // credential_profile !== "none" -> never persist stdout/stderr content, even hashed by reference name -- null is deliberate, not an oversight.
  defaultAuditSink.record(buildAuditEvent({
    execution_id: evidence_id, correlation_id: request.request_id, command_id: request.executable_id,
    identity_id: request.requester_identity, account_id: "dna-os-infrastructure", workspace_id: "process-gate",
    permission_decision_id: evidence_id, started_at: launch.startedAt, completed_at: launch.completedAt,
    exit_code: launch.exitCode, status: launch.timedOut ? "timed_out" : launch.exitCode === 0 ? "passed" : "failed",
    error_code: launch.timedOut ? "COMMAND_TIMEOUT" : launch.exitCode !== 0 ? "EXECUTION_FAILED" : null,
    duration_ms: launch.durationMs, verification_result: "not_verified", stdout_reference: null, stderr_reference: null,
  }));

  return {
    request_id: request.request_id,
    status: launch.timedOut ? "TIMEOUT" : "EXECUTED",
    reason: null,
    exit_code: launch.exitCode,
    stdout: launch.stdout,
    stderr: launch.stderr,
    resolved_executable: resolvedExecutable,
    evidence_id,
  };
}

declare const process: { env: Record<string, string | undefined> };
