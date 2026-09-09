/**
 * LOCAL_PROCESS_GATE_V1 — closed jobs only. Rejects shell, sudo, cwd escape, env injection.
 */

import { requestProcessExecution } from "../../execution/run/contract";
import { repoRoot } from "./host-runtime";
import type { LocalProcessJobV1, LocalResourceV1 } from "./types";

const CALLER = "control/local-resource-access/process-adapter.ts";
const ENV_ALLOWLIST = ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const;

export const LOCAL_PROCESS_JOBS: Readonly<Record<string, LocalProcessJobV1>> = {
  "local.compute.true": {
    schema: "LOCAL_PROCESS_GATE_V1",
    job_id: "local.compute.true",
    executable_id: "local.compute.true",
    argv: [],
    cwd_policy: "REPO_ROOT",
    environment_allowlist: ENV_ALLOWLIST,
    network_policy: "none",
    timeout_ms: 5_000,
    resource_limits: { max_runtime_ms: 5_000 },
    side_effect_class: "NONE",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  },
  "local.os.ps-list": {
    schema: "LOCAL_PROCESS_GATE_V1",
    job_id: "local.os.ps-list",
    executable_id: "local.os.ps-list",
    argv: ["-axo", "pid=,ppid=,pcpu=,pmem=,state=,comm="],
    cwd_policy: "REPO_ROOT",
    environment_allowlist: ENV_ALLOWLIST,
    network_policy: "none",
    timeout_ms: 8_000,
    resource_limits: { max_runtime_ms: 8_000 },
    side_effect_class: "READ_OS",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  },
  "local.os.ps-inspect": {
    schema: "LOCAL_PROCESS_GATE_V1",
    job_id: "local.os.ps-inspect",
    executable_id: "local.os.ps-inspect",
    argv: ["-p", "0", "-o", "pid=,ppid=,pcpu=,pmem=,state=,comm="],
    cwd_policy: "REPO_ROOT",
    environment_allowlist: ENV_ALLOWLIST,
    network_policy: "none",
    timeout_ms: 8_000,
    resource_limits: { max_runtime_ms: 8_000 },
    side_effect_class: "READ_OS",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  },
  "local.os.lsof-listen": {
    schema: "LOCAL_PROCESS_GATE_V1",
    job_id: "local.os.lsof-listen",
    executable_id: "local.os.lsof-listen",
    argv: ["-nP", "-iTCP", "-sTCP:LISTEN"],
    cwd_policy: "REPO_ROOT",
    environment_allowlist: ENV_ALLOWLIST,
    network_policy: "none",
    timeout_ms: 8_000,
    resource_limits: { max_runtime_ms: 8_000 },
    side_effect_class: "READ_OS",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  },
  "local.os.df": {
    schema: "LOCAL_PROCESS_GATE_V1",
    job_id: "local.os.df",
    executable_id: "local.os.df",
    argv: ["-k", "-P"],
    cwd_policy: "REPO_ROOT",
    environment_allowlist: ENV_ALLOWLIST,
    network_policy: "none",
    timeout_ms: 8_000,
    resource_limits: { max_runtime_ms: 8_000 },
    side_effect_class: "READ_OS",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  },
  "local.os.mount": {
    schema: "LOCAL_PROCESS_GATE_V1",
    job_id: "local.os.mount",
    executable_id: "local.os.mount",
    argv: [],
    cwd_policy: "REPO_ROOT",
    environment_allowlist: ENV_ALLOWLIST,
    network_policy: "none",
    timeout_ms: 8_000,
    resource_limits: { max_runtime_ms: 8_000 },
    side_effect_class: "READ_OS",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
  },
};

export const REGISTERED_LOCAL_JOBS = Object.keys(LOCAL_PROCESS_JOBS);

const SHELL_META = /[|&;`$<>\n]|sudo|\bsudo\b|\/bin\/sh|\/bin\/bash|-c\b/;

export function evaluateProcessJobRequest(input: {
  readonly job_id: string;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly argv?: readonly string[];
  readonly network?: string;
  readonly pid?: string;
}): { ok: true; job: LocalProcessJobV1; argv: readonly string[]; cwd: string } | { ok: false; reason_code: string } {
  if (SHELL_META.test(input.job_id) || (input.argv ?? []).some((token) => SHELL_META.test(token))) {
    return { ok: false, reason_code: "ARBITRARY_SHELL_REJECTED" };
  }
  const job = LOCAL_PROCESS_JOBS[input.job_id];
  if (!job) return { ok: false, reason_code: "JOB_NOT_REGISTERED" };
  if (input.env && Object.keys(input.env).length > 0) {
    const extra = Object.keys(input.env).filter((key) => !job.environment_allowlist.includes(key));
    if (extra.length > 0) return { ok: false, reason_code: "ENVIRONMENT_INJECTION_REJECTED" };
  }
  const cwd = input.cwd ?? repoRoot();
  if (cwd !== repoRoot() && !cwd.startsWith(`${repoRoot()}/`)) return { ok: false, reason_code: "CWD_ESCAPE_REJECTED" };
  if (input.network && input.network !== job.network_policy) return { ok: false, reason_code: "NETWORK_POLICY_DENIED" };
  let argv = job.argv;
  if (input.job_id === "local.os.ps-inspect") {
    if (!input.pid || !/^\d{1,10}$/.test(input.pid)) return { ok: false, reason_code: "PID_NOT_ALLOWED" };
    argv = ["-p", input.pid, "-o", "pid=,ppid=,pcpu=,pmem=,state=,comm="];
  } else if (input.argv && input.argv.length > 0) {
    return { ok: false, reason_code: "ARGV_OVERRIDE_REJECTED" };
  }
  return { ok: true, job, argv, cwd: repoRoot() };
}

export async function runRegisteredJob(
  resource: LocalResourceV1,
  job_id: string,
  work_id: string,
  extras: { readonly cwd?: string; readonly env?: Record<string, string>; readonly argv?: readonly string[]; readonly network?: string; readonly pid?: string } = {},
): Promise<{ ok: boolean; exit_code: number | null; reason_code: string; stdout: string }> {
  const evaluated = evaluateProcessJobRequest({ job_id, ...extras });
  if (!evaluated.ok) return { ok: false, exit_code: null, reason_code: evaluated.reason_code, stdout: "" };
  if (resource.execute_scope.length > 0 && !resource.execute_scope.includes(job_id)) {
    return { ok: false, exit_code: null, reason_code: "JOB_NOT_ON_RESOURCE", stdout: "" };
  }
  const result = await requestProcessExecution({
    request_id: `lra-job-${job_id}-${Date.now()}`,
    parent_work_order_id: work_id,
    requester_identity: CALLER,
    executable_id: evaluated.job.executable_id,
    argv: evaluated.argv,
    cwd: evaluated.cwd,
  });
  if (result.status !== "EXECUTED") {
    return { ok: false, exit_code: result.exit_code, reason_code: result.reason ?? result.status, stdout: "" };
  }
  return { ok: true, exit_code: result.exit_code, reason_code: "EXECUTED", stdout: result.stdout };
}

export function listRegisteredJobs(): readonly string[] {
  return REGISTERED_LOCAL_JOBS;
}

export function getLocalProcessJob(job_id: string): LocalProcessJobV1 | null {
  return LOCAL_PROCESS_JOBS[job_id] ?? null;
}
