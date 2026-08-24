/**
 * หน้าที่: the DNA OS Workspace Manager (Owner, "Phase 2 — Agent
 * Workspace Architecture"). The ONE component that decides, for every
 * Agent Host dispatch, what real source the Agent may READ
 * (`allowed_read_paths`, always MASTER_SOURCE itself — read-only by
 * construction, never the Agent's own cwd) and what real directory it
 * may WRITE to (`allowed_write_workspace`, always a fresh, disposable
 * TASK_WORKSPACE, never MASTER_SOURCE). The Agent never chooses its own
 * cwd/source/workspace — this file does, before `control/agent-host/`
 * ever launches anything.
 *
 * Reuses, never duplicates: `control/agent-host/` (the real sandbox
 * launcher — this file only decides ITS input parameters), `Evidence`
 * (`./types.ts`, additive `workspace_lifecycle` kind), the existing
 * `saveEvidence`/`memory-store.ts` durable store. No new persistence
 * layer, no new sandbox, no new executor.
 *
 * Input: `CreateTaskWorkspaceInput`.
 * Output: `TaskWorkspace`, `createTaskWorkspace`, `transitionWorkspace`,
 * `getWorkspace`, `WorkspaceState`.
 * Dependency ที่อนุญาต: ./types.ts, ./memory-store.ts, node:fs, node:path,
 * node:crypto.
 * สิ่งที่ห้ามแตะ: never set `allowed_write_workspace` to a path inside
 * MASTER_SOURCE (the real repository tree) — it must always be a fresh
 * path under the designated TASK_WORKSPACE root. Never let a caller
 * override `allowed_read_paths`/`allowed_write_workspace` after CREATE —
 * only this file computes them.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { saveEvidence } from "./memory-store";
import type { WorkerKind } from "../agent-host/contract";

export type WorkspaceState =
  | "CREATE"
  | "PREPARE_CONTEXT"
  | "ASSIGN_AGENT"
  | "RUNNING"
  | "RESULT_RECEIVED"
  | "VERIFYING"
  | "ACCEPTED"
  | "REJECTED"
  | "CORRECTION_REQUIRED"
  | "CLOSED";

/**
 * The only forward transitions this file will ever perform — matches
 * the Owner's own lifecycle spec exactly. `CORRECTION_REQUIRED` closes
 * this workspace too (a correction gets a NEW TaskWorkspace, the same
 * bounded-depth principle `agent-execution-loop.ts`'s corrective loop
 * already uses elsewhere) — this file never reopens a closed workspace.
 */
const VALID_TRANSITIONS: Readonly<Record<WorkspaceState, readonly WorkspaceState[]>> = {
  CREATE: ["PREPARE_CONTEXT"],
  PREPARE_CONTEXT: ["ASSIGN_AGENT"],
  ASSIGN_AGENT: ["RUNNING"],
  RUNNING: ["RESULT_RECEIVED"],
  RESULT_RECEIVED: ["VERIFYING"],
  VERIFYING: ["ACCEPTED", "REJECTED", "CORRECTION_REQUIRED"],
  ACCEPTED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CORRECTION_REQUIRED: ["CLOSED"],
  CLOSED: [],
};

export interface TaskWorkspace {
  workspace_id: string;
  work_order_id: string;
  command_id: string;
  assigned_agent: WorkerKind | null;
  /** Real, absolute MASTER_SOURCE paths the Agent may READ — never a path this Agent may write to. */
  assigned_source: readonly string[];
  allowed_read_paths: readonly string[];
  /** Real, absolute path of the fresh TASK_WORKSPACE the Agent may READ+WRITE — always disjoint from assigned_source/MASTER_SOURCE. */
  allowed_write_workspace: string;
  dependency_paths: readonly string[];
  created_at: string;
  state: WorkspaceState;
}

export interface CreateTaskWorkspaceInput {
  work_order_id: string;
  command_id: string;
  /** Real, absolute MASTER_SOURCE paths this task is assigned to read (e.g. the repo root) — this file never widens beyond what the caller names. */
  assigned_source: readonly string[];
  dependency_paths?: readonly string[];
  /** Root directory fresh per-workspace dirs are created under — must itself already be outside MASTER_SOURCE's write path (the existing control/agent-host/ convention: control/agent-host/test-workspace/allowed/). */
  workspace_root: string;
}

const registry = new Map<string, TaskWorkspace>();

function recordLifecycleEvidence(workspace: TaskWorkspace, note: string): void {
  saveEvidence({
    evidence_id: `ev-workspace-${randomUUID()}`,
    task_id: workspace.work_order_id,
    kind: "workspace_lifecycle",
    source: "control/agent-gateway/workspace-manager.ts",
    recorded_at: new Date().toISOString(),
    payload: { workspace_id: workspace.workspace_id, work_order_id: workspace.work_order_id, command_id: workspace.command_id, state: workspace.state, note },
  });
}

/**
 * CREATE — allocates a real workspace_id and a real, fresh, empty
 * TASK_WORKSPACE directory (never MASTER_SOURCE). `assigned_source`
 * stays exactly what the caller names — this file materializes no
 * copy of it (the Agent reads MASTER_SOURCE directly, read-only by the
 * existing Agent Host sandbox profile; nothing here needs to duplicate
 * that real, already-enforced mechanism).
 */
export function createTaskWorkspace(input: CreateTaskWorkspaceInput): TaskWorkspace {
  const workspace_id = `ws-${randomUUID()}`;
  const allowed_write_workspace = join(input.workspace_root, workspace_id);
  mkdirSync(allowed_write_workspace, { recursive: true });

  for (const source of input.assigned_source) {
    if (allowed_write_workspace === source || allowed_write_workspace.startsWith(`${source}/`) || source.startsWith(`${allowed_write_workspace}/`)) {
      throw new Error(`MASTER_SOURCE_SEPARATION_VIOLATION: TASK_WORKSPACE "${allowed_write_workspace}" overlaps assigned_source "${source}"`);
    }
  }

  const workspace: TaskWorkspace = {
    workspace_id,
    work_order_id: input.work_order_id,
    command_id: input.command_id,
    assigned_agent: null,
    assigned_source: input.assigned_source,
    allowed_read_paths: input.assigned_source,
    allowed_write_workspace,
    dependency_paths: input.dependency_paths ?? [],
    created_at: new Date().toISOString(),
    state: "CREATE",
  };
  registry.set(workspace_id, workspace);
  recordLifecycleEvidence(workspace, "workspace created — fresh TASK_WORKSPACE directory, disjoint from assigned_source");
  return workspace;
}

export function getWorkspace(workspace_id: string): TaskWorkspace | undefined {
  return registry.get(workspace_id);
}

export type TransitionOutcome = { ok: true; workspace: TaskWorkspace } | { ok: false; reason: string };

/**
 * The ONE function allowed to advance a TaskWorkspace's state. Refuses
 * (never silently clamps) any transition not in `VALID_TRANSITIONS`.
 */
export function transitionWorkspace(workspace_id: string, next_state: WorkspaceState, note: string): TransitionOutcome {
  const workspace = registry.get(workspace_id);
  if (!workspace) return { ok: false, reason: `UNKNOWN_WORKSPACE_ID: "${workspace_id}"` };
  const allowed = VALID_TRANSITIONS[workspace.state];
  if (!allowed.includes(next_state)) {
    return { ok: false, reason: `INVALID_TRANSITION: "${workspace.state}" -> "${next_state}" is not permitted (allowed: ${allowed.join(",") || "none — already terminal"})` };
  }
  const updated: TaskWorkspace = { ...workspace, state: next_state };
  registry.set(workspace_id, updated);
  recordLifecycleEvidence(updated, note);
  return { ok: true, workspace: updated };
}

/** ASSIGN_AGENT is the one transition that also records which real WorkerKind this workspace is bound to. */
export function assignAgent(workspace_id: string, worker_kind: WorkerKind): TransitionOutcome {
  const workspace = registry.get(workspace_id);
  if (!workspace) return { ok: false, reason: `UNKNOWN_WORKSPACE_ID: "${workspace_id}"` };
  const result = transitionWorkspace(workspace_id, "ASSIGN_AGENT", `assigned_agent=${worker_kind}`);
  if (!result.ok) return result;
  const updated: TaskWorkspace = { ...result.workspace, assigned_agent: worker_kind };
  registry.set(workspace_id, updated);
  return { ok: true, workspace: updated };
}
