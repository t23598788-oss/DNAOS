/**
 * หน้าที่: `createWorkspace()`/`removeWorkspace()` — real, LOCAL git
 * worktree isolation. Each call creates a genuinely separate working
 * directory + a genuinely separate local branch off the same real
 * repository, via real `git worktree add`, so two Agents writing files
 * concurrently on the SAME repository never touch the same checkout.
 * `branch_ref`/`worktree_path` are always derived deterministically from
 * `work_id` here — an Agent never chooses either.
 *
 * Input: `CreateWorkspaceInput` / a real `WorkspaceReservation`.
 * Output: `createWorkspace` -> `CreateWorkspaceResult`, `removeWorkspace`
 * -> `RemoveWorkspaceResult`.
 * Dependency ที่อนุญาต: ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let a caller supply `branch_ref`/`worktree_path`
 * directly — always derived here. Never call GitHub's remote API from
 * this file — local `git` only, matching the real, unblocked precedent
 * `connections/connection-registry/git-discovery.ts` already established.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirnameOf, joinPath, nowIso, resolvePath, runGit } from "./host-runtime";
import type { CreateWorkspaceInput, CreateWorkspaceResult, RemoveWorkspaceResult, WorkspaceReservation } from "./types";

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

function deriveBranchRef(workId: string): string {
  return `agent-work/${sanitize(workId)}`;
}

function deriveWorktreePath(repositoryRoot: string, repositoryId: string, workId: string): string {
  return joinPath(dirnameOf(repositoryRoot), ".dna-os-agent-worktrees", sanitize(repositoryId), sanitize(workId));
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  // Absolute, always — a relative worktree_path argument would otherwise be
  // resolved by git's own subprocess relative to its cwd (repository_root),
  // not the caller's, silently landing the real worktree somewhere other
  // than the path this function returns (found and fixed via this folder's
  // own real test, see ./tests/source-workspace.test.ts test C).
  const repositoryRoot = resolvePath(input.repository_root);
  const branchRef = deriveBranchRef(input.work_id);
  const worktreePath = resolvePath(deriveWorktreePath(repositoryRoot, input.repository_id, input.work_id));

  // Capture the real base commit SHA atomically relative to branch creation — real, live-read, never guessed.
  const baseShaResult = await runGit(["rev-parse", input.base_branch], repositoryRoot);
  if (!baseShaResult.ok) {
    return { status: "FAILED", reason: `could not resolve real base_branch="${input.base_branch}": ${baseShaResult.reason}`, reservation: null };
  }
  const baseCommitSha = baseShaResult.stdout.trim();

  const createResult = await runGit(["worktree", "add", "-b", branchRef, worktreePath, baseCommitSha], repositoryRoot);
  if (!createResult.ok) {
    return { status: "FAILED", reason: `git worktree add failed: ${createResult.reason}`, reservation: null };
  }

  const reservation: WorkspaceReservation = {
    reservation_id: `wsr-${randomUUID()}`,
    work_id: input.work_id,
    repository_id: input.repository_id,
    branch_ref: branchRef,
    worktree_path: worktreePath,
    base_commit_sha: baseCommitSha,
    created_at: nowIso(),
  };
  persistReservation(reservation);
  return { status: "CREATED", reason: "real git worktree created via git worktree add", reservation };
}

/**
 * DECISION 3 — การจองต้องมีตัวตนที่ค้นกลับได้หลัง restart
 *
 * เดิม `WorkspaceReservation` ถูกคืนกลับให้ผู้เรียกแล้วจบ ไม่มีใครเก็บ ทำให้
 * `reservation_id` อ้างกลับไม่ได้เมื่อโปรเซสอื่น (หรือโปรเซสเดียวกันหลัง restart)
 * ต้องตัดสินใจเรื่อง cleanup — และการเดา worktree จาก path คือสิ่งที่ห้ามทำ
 *
 * append-only ตามแบบแผนเดียวกับสโตร์อื่นในระบบ ไม่ใช่ capability ใหม่ แค่ทำให้
 * ของที่ capability นี้สร้างอยู่แล้วค้นกลับได้
 */
function reservationFile(): string {
  return process.env.SOURCE_WORKSPACE_RESERVATION_LOG
    ?? joinPath(dirnameOf(dirnameOf(resolvePath(__dirname))), "control/source-workspace/data/reservations.jsonl");
}

function persistReservation(reservation: WorkspaceReservation): void {
  const p = reservationFile();
  mkdirSync(dirnameOf(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(reservation)}\n`, "utf-8");
}

export function listReservations(): readonly WorkspaceReservation[] {
  const p = reservationFile();
  if (!existsSync(p)) return [];
  const rows: WorkspaceReservation[] = [];
  for (const line of readFileSync(p, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line) as WorkspaceReservation); } catch { /* แถวเสียข้ามไป ไม่ลบ */ }
  }
  return rows;
}

/** ค้นด้วย reservation_id เท่านั้น — ไม่ค้นด้วย path และไม่เดา */
export function loadReservation(reservationId: string): WorkspaceReservation | null {
  return listReservations().filter((r) => r.reservation_id === reservationId).at(-1) ?? null;
}

export async function removeWorkspace(reservation: Pick<WorkspaceReservation, "repository_id" | "worktree_path" | "branch_ref">, repositoryRoot: string): Promise<RemoveWorkspaceResult> {
  const absoluteRoot = resolvePath(repositoryRoot);
  const removeResult = await runGit(["worktree", "remove", reservation.worktree_path, "--force"], absoluteRoot);
  if (!removeResult.ok) {
    return { status: "FAILED", reason: `git worktree remove failed: ${removeResult.reason}` };
  }
  // Best-effort branch cleanup — the worktree removal above is the real isolation boundary; a leftover local branch ref is not itself a collision risk (branch_ref is always derived from a work_id no future real work_id will collide with).
  await runGit(["branch", "-D", reservation.branch_ref], absoluteRoot);
  return { status: "REMOVED", reason: "real git worktree removed via git worktree remove" };
}
