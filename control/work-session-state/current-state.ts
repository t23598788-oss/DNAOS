import { loadAllHandoffs, loadAllTasks, listWorkspacesFromDisk } from "../agent-gateway/contract";
import { listOwnerSessions } from "../owner-authentication/contract";
import { listLeases } from "../computer-use-authority/contract";
import type { HandoffRecord, Task } from "../agent-gateway/types";
import type { OwnerSession } from "../owner-authentication/types";
import type { ComputerUseAuthorityLease } from "../computer-use-authority/types";
import type { TaskWorkspace } from "../agent-gateway/workspace-manager";

export interface CurrentStateProjection {
  readonly generated_at: string;
  readonly rule: "latest-record-per-stable-id";
  readonly tasks: readonly Task[];
  readonly handoffs: readonly HandoffRecord[];
  readonly workspaces: readonly TaskWorkspace[];
  readonly owner_sessions: readonly OwnerSession[];
  readonly authority_leases: readonly ComputerUseAuthorityLease[];
}

function latestBy<T>(rows: readonly T[], key: (row: T) => string): readonly T[] {
  const latest = new Map<string, T>();
  for (const row of rows) latest.set(key(row), row);
  return [...latest.values()];
}

/** Rebuilds current state from append-only stores; history remains untouched and is not returned as current state. */
export function currentStateProjection(): CurrentStateProjection {
  return {
    generated_at: new Date().toISOString(),
    rule: "latest-record-per-stable-id",
    tasks: latestBy(loadAllTasks(), (row) => row.task_id),
    handoffs: latestBy(loadAllHandoffs(), (row) => row.handoff_id),
    workspaces: listWorkspacesFromDisk(),
    owner_sessions: listOwnerSessions(),
    authority_leases: listLeases(),
  };
}