/**
 * Safe disposable-workspace cleanup. Force deletion is not the normal path.
 * Unknown Owner files and unregistered folders are never targets.
 *
 * Input: registered workspace + caller-supplied publication/evidence facts.
 * Output: CLEANED | BLOCKED | PRESERVED with evidence.
 * Dependency ที่อนุญาต: node:fs, ./host-runtime.ts, ./local-registry.ts, ./resolver.ts.
 * สิ่งที่ห้ามแตะ: never delete repository_root. never rm -rf unregistered paths.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirnameOf, joinPath, nowIso, resolvePath, runGit } from "./host-runtime";
import {
  classifyDisposablePath,
  listLocalWorkspaces,
  transitionLocalWorkspace,
  type LocalWorkspaceRecord,
} from "./local-registry";
import { loadReservation } from "./resolver";

export type CleanupStatus = "CLEANED" | "BLOCKED" | "PRESERVED" | "CLEANUP_PENDING";

export interface CleanupFacts {
  readonly remote_commit_verified: boolean;
  readonly ci_verified_when_required: boolean;
  readonly registry_write_verified: boolean;
  readonly final_result_recorded: boolean;
  readonly published_sha?: string;
}

export interface CleanupOutcome {
  readonly status: CleanupStatus;
  readonly reason_code: string;
  readonly detail: string;
  readonly workspace_id: string;
  readonly work_id: string;
  readonly evidence_id: string;
  readonly unmanaged_files_deleted: false;
  readonly persistent_control_runtime_preserved: true;
}

function evidenceFile(): string {
  return process.env.LOCAL_WORKSPACE_CLEANUP_EVIDENCE_LOG
    ?? joinPath(dirnameOf(dirnameOf(resolvePath(__dirname))), "control/source-workspace/data/workspace-cleanup.jsonl");
}

function recordEvidence(row: Record<string, unknown>): string {
  const evidence_id = typeof row.evidence_id === "string" ? row.evidence_id : `ev-ws-clean-${Date.now()}`;
  const p = evidenceFile();
  mkdirSync(dirnameOf(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({ ...row, evidence_id, recorded_at: nowIso() })}\n`, "utf8");
  return evidence_id;
}

export function listWorkspaceCleanupEvidence(): readonly Record<string, unknown>[] {
  const p = evidenceFile();
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function protectedAgainstDeletion(abs: string, repositoryRoot: string): boolean | string {
  const n = resolvePath(abs);
  const root = resolvePath(repositoryRoot);
  if (n === root) return "never delete canonical repository_root";
  if (n.includes("/credentials/") || n.endsWith("/credentials")) return "never delete credentials";
  if (!classifyDisposablePath(n)) return "path is not a registered disposable isolation directory";
  if (root.startsWith(`${n}/`)) return "refusing to delete a parent of the control runtime";
  return false;
}

async function porcelain(worktreePath: string): Promise<readonly string[]> {
  if (!existsSync(worktreePath)) return [];
  const status = await runGit(["status", "--porcelain"], worktreePath);
  if (!status.ok) return ["?? UNKNOWN"];
  return status.stdout.split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0);
}

async function hasUncommittedTracked(worktreePath: string): Promise<boolean> {
  const lines = await porcelain(worktreePath);
  return lines.some((line) => !line.startsWith("??"));
}

async function removeUntrackedArtifacts(worktreePath: string): Promise<void> {
  await runGit(["clean", "-fd"], worktreePath);
}

async function removeWorktreeSafely(repositoryRoot: string, worktreePath: string, branchRef: string | null): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (existsSync(worktreePath)) {
    const removed = await runGit(["worktree", "remove", worktreePath], repositoryRoot);
    if (!removed.ok) {
      return { ok: false, detail: `git worktree remove (no --force) failed: ${removed.reason}` };
    }
  }
  await runGit(["worktree", "prune"], repositoryRoot);
  if (branchRef) await runGit(["branch", "-D", branchRef], repositoryRoot);
  return { ok: true };
}

export async function evaluateDisposableCleanup(input: {
  readonly workspace: LocalWorkspaceRecord;
  readonly facts: CleanupFacts;
}): Promise<CleanupOutcome> {
  const ws = input.workspace;
  const fail = (reason_code: string, detail: string, state: "BLOCKED" | "PRESERVED" | "CLEANUP_PENDING"): CleanupOutcome => {
    const evidence_id = recordEvidence({
      note: "WORKSPACE_CLEANUP_BLOCKED",
      workspace_id: ws.workspace_id,
      work_id: ws.work_id,
      reason_code,
      detail,
      status: state,
    });
    transitionLocalWorkspace(ws.workspace_id, state === "CLEANUP_PENDING" ? "CLEANUP_PENDING" : state, evidence_id);
    return {
      status: state,
      reason_code,
      detail,
      workspace_id: ws.workspace_id,
      work_id: ws.work_id,
      evidence_id,
      unmanaged_files_deleted: false,
      persistent_control_runtime_preserved: true,
    };
  };

  if (ws.cleanup_policy !== "DISPOSABLE") {
    return fail("PRESERVE_POLICY", "workspace is not disposable", "PRESERVED");
  }
  if (ws.current_state === "CLEANED") {
    const evidence_id = recordEvidence({ note: "WORKSPACE_ALREADY_CLEANED", workspace_id: ws.workspace_id, work_id: ws.work_id });
    return {
      status: "CLEANED",
      reason_code: "ALREADY_CLEANED",
      detail: "workspace already CLEANED",
      workspace_id: ws.workspace_id,
      work_id: ws.work_id,
      evidence_id,
      unmanaged_files_deleted: false,
      persistent_control_runtime_preserved: true,
    };
  }

  if (!input.facts.remote_commit_verified || !input.facts.ci_verified_when_required || !input.facts.registry_write_verified || !input.facts.final_result_recorded) {
    return fail("UNVERIFIED_WORK", "unverified or unpublished required source is never cleaned", "PRESERVED");
  }

  const protectedReason = protectedAgainstDeletion(ws.path_reference, ws.repository_root);
  if (protectedReason) return fail("PROTECTED_PATH", String(protectedReason), "BLOCKED");

  if (
    input.facts.published_sha
    && /^[0-9a-f]{40}$/i.test(input.facts.published_sha)
    && input.facts.remote_commit_verified
    && existsSync(ws.path_reference)
  ) {
    const present = await runGit(["cat-file", "-e", `${input.facts.published_sha}^{commit}`], ws.path_reference);
    if (present.ok) {
      await runGit(["reset", "--hard", input.facts.published_sha], ws.path_reference);
      await runGit(["clean", "-fd"], ws.path_reference);
    }
  }
  if (await hasUncommittedTracked(ws.path_reference)) {
    return fail("UNCOMMITTED_REQUIRED_SOURCE", "uncommitted required source blocks cleanup", "BLOCKED");
  }
  if ((await porcelain(ws.path_reference)).some((line) => line.startsWith("??"))) {
    await removeUntrackedArtifacts(ws.path_reference);
    if (await hasUncommittedTracked(ws.path_reference) || (await porcelain(ws.path_reference)).length > 0) {
      return fail("UNCOMMITTED_REQUIRED_SOURCE", "untracked artifacts could not be removed safely", "BLOCKED");
    }
  }

  const pending = transitionLocalWorkspace(ws.workspace_id, "CLEANUP_PENDING", "cleanup_evaluation_passed");
  if (!pending) return fail("UNKNOWN_WORKSPACE", "workspace disappeared before cleanup", "BLOCKED");

  if (!existsSync(ws.path_reference) || !existsSync(ws.repository_root)) {
    if (existsSync(ws.path_reference) && classifyDisposablePath(ws.path_reference)) {
      rmSync(ws.path_reference, { recursive: true, force: false });
    }
    if (existsSync(ws.repository_root)) {
      await runGit(["worktree", "prune"], ws.repository_root);
    }
    const evidence_id = recordEvidence({
      note: "WORKSPACE_CLEANED",
      workspace_id: ws.workspace_id,
      work_id: ws.work_id,
      reservation_id: ws.reservation_id,
      path_kind: ws.path_kind,
      force_used: false,
      git_parent_absent: !existsSync(ws.repository_root),
    });
    transitionLocalWorkspace(ws.workspace_id, "CLEANED", evidence_id);
    return {
      status: "CLEANED",
      reason_code: "WORKSPACE_CLEANED",
      detail: "disposable isolation removed after git parent/worktree absence was proven",
      workspace_id: ws.workspace_id,
      work_id: ws.work_id,
      evidence_id,
      unmanaged_files_deleted: false,
      persistent_control_runtime_preserved: true,
    };
  }

  const reservation = loadReservation(ws.reservation_id);
  const branchRef = reservation?.branch_ref ?? null;
  const removed = await removeWorktreeSafely(ws.repository_root, ws.path_reference, branchRef);
  if (!removed.ok) {
    return fail("SAFE_REMOVE_FAILED", removed.detail, "BLOCKED");
  }

  const evidence_id = recordEvidence({
    note: "WORKSPACE_CLEANED",
    workspace_id: ws.workspace_id,
    work_id: ws.work_id,
    reservation_id: ws.reservation_id,
    path_kind: ws.path_kind,
    force_used: false,
  });
  transitionLocalWorkspace(ws.workspace_id, "CLEANED", evidence_id);
  return {
    status: "CLEANED",
    reason_code: "WORKSPACE_CLEANED",
    detail: "disposable isolation worktree removed without --force",
    workspace_id: ws.workspace_id,
    work_id: ws.work_id,
    evidence_id,
    unmanaged_files_deleted: false,
    persistent_control_runtime_preserved: true,
  };
}

export async function cleanupWorkspacesForWork(workId: string, facts: CleanupFacts): Promise<readonly CleanupOutcome[]> {
  const rows = listLocalWorkspaces().filter((row) => row.work_id === workId && row.current_state !== "CLEANED");
  const out: CleanupOutcome[] = [];
  for (const workspace of rows) {
    out.push(await evaluateDisposableCleanup({ workspace, facts }));
  }
  return out;
}

export async function resumeCleanupPending(workId: string, facts: CleanupFacts): Promise<readonly CleanupOutcome[]> {
  const rows = listLocalWorkspaces().filter((row) => row.work_id === workId && (row.current_state === "CLEANUP_PENDING" || row.current_state === "ACTIVE" || row.current_state === "PUBLISHED"));
  const out: CleanupOutcome[] = [];
  for (const workspace of rows) {
    out.push(await evaluateDisposableCleanup({ workspace, facts }));
  }
  return out;
}
