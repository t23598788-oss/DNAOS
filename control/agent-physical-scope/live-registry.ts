/**
 * Bind physical-scope to existing DNA OS stores without a second registry.
 */

import { listReservations } from "../source-workspace/contract";
import { getRepository } from "../../software/repository-registry/contract";
import { AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV } from "./types";
import type { PhysicalScopeRegistry } from "./types";
import { defaultProtectedRuntimes, isProtectedRuntimeId } from "./process-port";
import { recordDeniedMutation } from "./audit";

export function liveRegistryFromExistingStores(): PhysicalScopeRegistry {
  return {
    findReservationByWorkId(task_id) {
      const rows = listReservations().filter((row) => row.work_id === task_id);
      return rows.length > 0 ? rows[rows.length - 1]! : null;
    },
    getRepository(repository_id) {
      const row = getRepository(repository_id);
      if (!row) return null;
      return {
        repository_id: row.repository_id,
        source_authority: row.source_authority,
        repository_root: row.repository_root,
        status: row.status,
      };
    },
    siblingWorktreePaths(except_path) {
      return listReservations()
        .map((row) => row.worktree_path)
        .filter((path) => path !== except_path);
    },
    protectedRuntimes: defaultProtectedRuntimes,
    now: () => new Date(),
  };
}

export function agentContextActive(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const value = env[AGENT_EXECUTION_ID_ENV];
  return typeof value === "string" && value.trim() !== "";
}

export function denyProtectedRuntimeIfAgent(input: {
  readonly service_id: string;
  readonly action: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): { readonly ok: true } | { readonly ok: false; readonly reason: "RUNTIME_SCOPE_DENIED"; readonly detail: string } {
  if (input.action === "health" || input.action === "status") return { ok: true };
  if (!agentContextActive(input.env)) return { ok: true };
  if (!isProtectedRuntimeId(input.service_id)) return { ok: true };
  recordDeniedMutation({
    task_id: input.env?.[AGENT_TASK_ID_ENV] ?? null,
    agent_execution_id: input.env?.[AGENT_EXECUTION_ID_ENV] ?? null,
    requested_action: "RUNTIME_MUTATION",
    resolved_repository: null,
    requested_resource: `${input.action}:${input.service_id}`,
    denial_reason: "RUNTIME_SCOPE_DENIED",
    timestamp: new Date().toISOString(),
  });
  return {
    ok: false,
    reason: "RUNTIME_SCOPE_DENIED",
    detail: `coding agent cannot mutate protected runtime ${input.service_id}`,
  };
}
