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

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname as dirnameOf, join, join as joinPath } from "node:path";
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
  /**
   * ADDITIVE (Owner, DECISION 3). งานที่เป็นเจ้าของ workspace นี้ เมื่อรู้
   * `null` = ยังไม่ผูก ไม่ใช่ "ไม่มี" — ห้ามเดาจาก work_order_id
   */
  task_id?: string | null;
  /**
   * ADDITIVE (Owner, DECISION 3). `WorkspaceReservation.reservation_id` ของ
   * source worktree ที่งานนี้จอง — คนละวัตถุกับ workspace นี้โดยสิ้นเชิง
   *
   * TaskWorkspace = พื้นที่ทำงานเชิงตรรกะของ task/agent
   * WorkspaceReservation = การจอง worktree ของ repository ที่ source-workspace เป็นเจ้าของ
   * ทั้งสองไม่ใช่สิ่งเดียวกัน และ `workspace_id` ต้องไม่ถูกใช้แทนกัน
   */
  source_reservation_id?: string | null;
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

/**
 * DECISION 3 — ตัวตนของ workspace ต้องอยู่รอดหลัง restart
 *
 * เดิมทะเบียนนี้เป็น Map ในหน่วยความจำล้วน แปลว่าหลังโปรเซสตาย ไม่มีทางรู้ว่า
 * workspace ไหนเป็นของงานไหน หรือผูกกับการจอง worktree ใด — ทำให้ตัดสินใจเรื่อง
 * cleanup อย่างปลอดภัยไม่ได้เลย
 *
 * Map ยังอยู่ในฐานะแคชของโปรเซส แต่ **ดิสก์คือความจริง** — เขียนลงดิสก์ก่อนเสมอ
 * และการอ่านที่ไม่เจอในแคชจะไปอ่านดิสก์ (แถวหลังสุดของ workspace_id ชนะ ตาม
 * แบบแผน latest-per-key เดียวกับ tasks.jsonl)
 */
const registry = new Map<string, TaskWorkspace>();

function workspaceFile(): string {
  const override = process.env.AGENT_GATEWAY_DATA_DIR;
  const dir = override && override.length > 0 ? override : joinPath(__dirname, "..", "..", "control/agent-gateway/data");
  return joinPath(dir, "task-workspaces.jsonl");
}

function persist(workspace: TaskWorkspace): void {
  const p = workspaceFile();
  mkdirSync(dirnameOf(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(workspace)}\n`, "utf-8");
  registry.set(workspace.workspace_id, workspace);
}

/** อ่านแถวหลังสุดของ workspace_id นั้นจากดิสก์ — ไม่พึ่งแคช ใช้ได้หลัง restart */
export function loadWorkspaceFromDisk(workspace_id: string): TaskWorkspace | undefined {
  const p = workspaceFile();
  if (!existsSync(p)) return undefined;
  let found: TaskWorkspace | undefined;
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as TaskWorkspace;
      if (row.workspace_id === workspace_id) found = row;
    } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return found;
}

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
  persist(workspace);
  recordLifecycleEvidence(workspace, "workspace created — fresh TASK_WORKSPACE directory, disjoint from assigned_source");
  return workspace;
}

export function getWorkspace(workspace_id: string): TaskWorkspace | undefined {
  // แคชก่อน แล้วค่อยดิสก์ — หลัง restart แคชว่าง แต่ความจริงยังอยู่บนดิสก์
  return registry.get(workspace_id) ?? loadWorkspaceFromDisk(workspace_id);
}

/** Read every latest workspace row from the same append-only file used by getWorkspace. */
export function listWorkspacesFromDisk(): readonly TaskWorkspace[] {
  const p = workspaceFile();
  if (!existsSync(p)) return [];
  const latest = new Map<string, TaskWorkspace>();
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as TaskWorkspace;
      latest.set(row.workspace_id, row);
    } catch { /* malformed historical row is not current state */ }
  }
  return [...latest.values()];
}

/**
 * ผูก workspace เข้ากับการจอง worktree (และงาน เมื่อรู้) — ความสัมพันธ์ที่มีชนิด
 * และถูกบันทึก ไม่ใช่การอนุมานจากสตริง path
 */
export function linkSourceReservation(workspace_id: string, source_reservation_id: string, task_id?: string): TransitionOutcome {
  const current = getWorkspace(workspace_id);
  if (!current) return { ok: false, reason: `UNKNOWN_WORKSPACE: ${workspace_id}` };
  const next: TaskWorkspace = { ...current, source_reservation_id, task_id: task_id ?? current.task_id ?? null };
  persist(next);
  recordLifecycleEvidence(next, `linked to source reservation ${source_reservation_id}${task_id ? ` for task ${task_id}` : ""}`);
  return { ok: true, workspace: next };
}

export type TransitionOutcome = { ok: true; workspace: TaskWorkspace } | { ok: false; reason: string };

/**
 * The ONE function allowed to advance a TaskWorkspace's state. Refuses
 * (never silently clamps) any transition not in `VALID_TRANSITIONS`.
 */
export function transitionWorkspace(workspace_id: string, next_state: WorkspaceState, note: string): TransitionOutcome {
  const workspace = getWorkspace(workspace_id);
  if (!workspace) return { ok: false, reason: `UNKNOWN_WORKSPACE_ID: "${workspace_id}"` };
  const allowed = VALID_TRANSITIONS[workspace.state];
  if (!allowed.includes(next_state)) {
    return { ok: false, reason: `INVALID_TRANSITION: "${workspace.state}" -> "${next_state}" is not permitted (allowed: ${allowed.join(",") || "none — already terminal"})` };
  }
  const updated: TaskWorkspace = { ...workspace, state: next_state };
  persist(updated);
  recordLifecycleEvidence(updated, note);
  return { ok: true, workspace: updated };
}

/** ASSIGN_AGENT is the one transition that also records which real WorkerKind this workspace is bound to. */
export function assignAgent(workspace_id: string, worker_kind: WorkerKind): TransitionOutcome {
  const workspace = getWorkspace(workspace_id);
  if (!workspace) return { ok: false, reason: `UNKNOWN_WORKSPACE_ID: "${workspace_id}"` };
  const result = transitionWorkspace(workspace_id, "ASSIGN_AGENT", `assigned_agent=${worker_kind}`);
  if (!result.ok) return result;
  const updated: TaskWorkspace = { ...result.workspace, assigned_agent: worker_kind };
  persist(updated);
  return { ok: true, workspace: updated };
}
