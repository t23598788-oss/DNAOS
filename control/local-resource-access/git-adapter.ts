/**
 * Git repository adapter — status / diff / search via the existing process gate.
 */

import { requestProcessExecution } from "../../execution/run/contract";
import { repoRoot } from "./host-runtime";
import { classifyLocalFile, logicalRef } from "./path-scope";
import { resourceAbsoluteRoot } from "./resource-registry";
import type { LocalResourceV1 } from "./types";

const CALLER = "control/local-resource-access/git-adapter.ts";

async function gitJob(executable_id: string, argv: readonly string[], work_id: string): Promise<{ ok: boolean; stdout: string; reason: string | null }> {
  const result = await requestProcessExecution({
    request_id: `lra-git-${executable_id}-${Date.now()}`,
    parent_work_order_id: work_id,
    requester_identity: CALLER,
    executable_id,
    argv,
    cwd: repoRoot(),
  });
  if (result.status !== "EXECUTED") return { ok: false, stdout: "", reason: result.reason };
  return { ok: true, stdout: result.stdout, reason: null };
}

export async function gitStatus(resource: LocalResourceV1, work_id: string): Promise<{ ok: boolean; items: readonly Record<string, unknown>[]; reason_code?: string }> {
  if (!resourceAbsoluteRoot(resource)) return { ok: false, items: [], reason_code: "RESOURCE_HAS_NO_ROOT" };
  const actual = await gitJob("local.git.status", ["status", "--porcelain", "--", resource.logical_root], work_id);
  if (!actual.ok) return { ok: false, items: [], reason_code: actual.reason ?? "GIT_STATUS_FAILED" };
  const items = actual.stdout.split("\n").filter(Boolean).map((line) => ({
    logical_ref: logicalRef(resource.resource_id, line.slice(3).trim()),
    status: line.slice(0, 2).trim() || "??",
  }));
  return { ok: true, items };
}

export async function gitDiff(resource: LocalResourceV1, work_id: string): Promise<{ ok: boolean; items: readonly Record<string, unknown>[]; reason_code?: string }> {
  if (!resourceAbsoluteRoot(resource)) return { ok: false, items: [], reason_code: "RESOURCE_HAS_NO_ROOT" };
  const actual = await gitJob("local.git.diff", ["diff", "--name-only", "--", resource.logical_root], work_id);
  if (!actual.ok) return { ok: false, items: [], reason_code: actual.reason ?? "GIT_DIFF_FAILED" };
  const items = actual.stdout.split("\n").filter(Boolean).map((path) => ({ logical_ref: logicalRef(resource.resource_id, path) }));
  return { ok: true, items };
}

export async function gitSearch(resource: LocalResourceV1, work_id: string, query: string): Promise<{ ok: boolean; items: readonly Record<string, unknown>[]; reason_code?: string }> {
  if (!/^[A-Za-z0-9._ -]{1,80}$/.test(query)) return { ok: false, items: [], reason_code: "INVALID_QUERY" };
  if (!resourceAbsoluteRoot(resource)) return { ok: false, items: [], reason_code: "RESOURCE_HAS_NO_ROOT" };
  const actual = await gitJob("local.git.search", ["grep", "-n", "-I", "-F", "--", query, "--", resource.logical_root], work_id);
  if (!actual.ok) return { ok: false, items: [], reason_code: actual.reason ?? "GIT_SEARCH_FAILED" };
  const items = actual.stdout.split("\n").filter(Boolean).flatMap((line) => {
    const [path, lineNo, ...rest] = line.split(":");
    if (!path || classifyLocalFile(path) === "SECRET" || classifyLocalFile(path) === "CREDENTIAL") return [];
    return [{ logical_ref: logicalRef(resource.resource_id, path), line: Number(lineNo), snippet: rest.join(":").slice(0, 160) }];
  });
  return { ok: true, items };
}
