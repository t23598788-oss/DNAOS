/**
 * Bind physical-scope to existing DNA OS stores without a second registry.
 */

import { existsSync } from "node:fs";
import { listLocalWorkspaces, listReservations, latestWorkspaceForWork } from "../source-workspace/contract";
import { getRepository } from "../../software/repository-registry/contract";
import { AGENT_EXECUTION_ID_ENV, AGENT_TASK_ID_ENV } from "./types";
import type { PhysicalScopeRegistry, ReservationView } from "./types";
import { defaultProtectedRuntimes, isProtectedRuntimeId } from "./process-port";
import { recordDeniedMutation } from "./audit";
import { realExistingPath } from "./host-runtime";

const INACTIVE_WORKSPACE_STATES = new Set(["CLEANED", "BLOCKED"]);

function toView(row: {
  readonly reservation_id: string;
  readonly work_id: string;
  readonly repository_id: string;
  readonly worktree_path: string;
  readonly base_commit_sha: string;
  readonly purpose?: ReservationView["purpose"];
}): ReservationView | null {
  const local = latestWorkspaceForWork(row.work_id)
    ?? listLocalWorkspaces().find((w) => w.reservation_id === row.reservation_id)
    ?? null;
  if (local && INACTIVE_WORKSPACE_STATES.has(local.current_state)) return null;
  if (!existsSync(row.worktree_path)) return null;
  return {
    reservation_id: row.reservation_id,
    work_id: row.work_id,
    repository_id: row.repository_id,
    worktree_path: row.worktree_path,
    base_commit_sha: row.base_commit_sha,
    purpose: local?.purpose ?? row.purpose,
  };
}

function sameWorktree(a: string, b: string): boolean {
  return (realExistingPath(a) ?? a) === (realExistingPath(b) ?? b);
}

export function liveRegistryFromExistingStores(): PhysicalScopeRegistry {
  return {
    findReservationByWorkId(task_id) {
      const rows = listReservations().filter((row) => row.work_id === task_id);
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const view = toView(rows[i]!);
        if (view) return view;
      }
      return null;
    },
    findReservationByWorktreePath(worktree_path) {
      const rows = listReservations().filter((row) => sameWorktree(row.worktree_path, worktree_path));
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const view = toView(rows[i]!);
        if (view) return view;
      }
      return null;
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
        .filter((path) => !sameWorktree(path, except_path));
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
