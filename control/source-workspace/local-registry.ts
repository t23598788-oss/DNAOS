/**
 * Local Workspace Registry — DNA OS owns every engineering/execution folder
 * it creates. Agents never invent unmanaged working directories.
 *
 * Input: reservation / derived worktree metadata.
 * Output: registered workspace rows and managed-path checks.
 * Dependency ที่อนุญาต: node:fs/path/crypto, ./types.ts, ./host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never register an Owner-chosen absolute path.
 * never expose credentials. never treat an unregistered folder as disposable.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirnameOf, joinPath, nowIso, resolvePath } from "./host-runtime";
import type { WorkspaceReservation } from "./types";

export const LOCAL_WORKSPACE_STATES = [
  "CREATED",
  "RESERVED",
  "ACTIVE",
  "VERIFYING",
  "PUBLISHED",
  "CLEANUP_PENDING",
  "CLEANED",
  "PRESERVED",
  "BLOCKED",
] as const;

export type LocalWorkspaceState = typeof LOCAL_WORKSPACE_STATES[number];
export type WorkspacePurpose = "ENGINEERING_ISOLATION" | "PUBLICATION_PROOF" | "RECOVERY_CHECKOUT";
export type CleanupPolicy = "DISPOSABLE" | "PRESERVE";
export type PersistencePolicy = "EPHEMERAL" | "RECOVERY_REQUIRED";

export interface LocalWorkspaceRecord {
  readonly workspace_id: string;
  readonly work_id: string;
  readonly machine_id: string;
  readonly path_reference: string;
  readonly path_kind: "DNA_OS_AGENT_WORKTREE" | "DNA_OS_PUBLICATION_CHECKOUT";
  readonly purpose: WorkspacePurpose;
  readonly owner_capability: "control/source-workspace";
  readonly created_at: string;
  readonly current_state: LocalWorkspaceState;
  readonly reservation_id: string;
  readonly cleanup_policy: CleanupPolicy;
  readonly persistence_policy: PersistencePolicy;
  readonly evidence_refs: readonly string[];
  readonly repository_id: string;
  readonly repository_root: string;
  readonly updated_at: string;
}

function registryFile(): string {
  return process.env.LOCAL_WORKSPACE_REGISTRY_LOG
    ?? joinPath(dirnameOf(dirnameOf(resolvePath(__dirname))), "control/source-workspace/data/local-workspaces.jsonl");
}

function persist(row: LocalWorkspaceRecord): LocalWorkspaceRecord {
  const p = registryFile();
  mkdirSync(dirnameOf(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listLocalWorkspaces(): readonly LocalWorkspaceRecord[] {
  const p = registryFile();
  if (!existsSync(p)) return [];
  const latest = new Map<string, LocalWorkspaceRecord>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as LocalWorkspaceRecord;
      latest.set(row.workspace_id, row);
    } catch {
      /* skip corrupt */
    }
  }
  return [...latest.values()];
}

export function latestWorkspaceForWork(workId: string): LocalWorkspaceRecord | null {
  const rows = listLocalWorkspaces().filter((row) => row.work_id === workId);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export function workspacesForWork(workId: string): readonly LocalWorkspaceRecord[] {
  return listLocalWorkspaces().filter((row) => row.work_id === workId);
}

export function classifyDisposablePath(absolutePath: string): LocalWorkspaceRecord["path_kind"] | null {
  const n = resolvePath(absolutePath).replaceAll("\\", "/");
  if (n.includes("/.dna-os-agent-worktrees/")) return "DNA_OS_AGENT_WORKTREE";
  if (n.includes("/.dna-os-publication-checkouts/")) return "DNA_OS_PUBLICATION_CHECKOUT";
  return null;
}

export function isRegisteredManagedWorktree(absolutePath: string): boolean {
  const n = resolvePath(absolutePath);
  return listLocalWorkspaces().some((row) => {
    if (row.current_state === "CLEANED") return false;
    return resolvePath(row.path_reference) === n;
  });
}

export function pathDisclosureRef(workspaceId: string): string {
  return `workspace://${workspaceId}`;
}

function machineId(): string {
  return process.env.DNA_OS_MACHINE_ID?.trim() || "machine:uninitialized";
}

export function registerReservationWorkspace(input: {
  readonly reservation: WorkspaceReservation;
  readonly repository_root: string;
  readonly purpose?: WorkspacePurpose;
}): LocalWorkspaceRecord {
  const existing = listLocalWorkspaces().find((row) => row.reservation_id === input.reservation.reservation_id);
  if (existing) return existing;
  const kind = classifyDisposablePath(input.reservation.worktree_path) ?? "DNA_OS_AGENT_WORKTREE";
  const workspace_id = `lws-${randomUUID()}`;
  const created_at = nowIso();
  return persist({
    workspace_id,
    work_id: input.reservation.work_id,
    machine_id: machineId(),
    path_reference: resolvePath(input.reservation.worktree_path),
    path_kind: kind,
    purpose: input.purpose ?? "ENGINEERING_ISOLATION",
    owner_capability: "control/source-workspace",
    created_at,
    current_state: "ACTIVE",
    reservation_id: input.reservation.reservation_id,
    cleanup_policy: "DISPOSABLE",
    persistence_policy: "EPHEMERAL",
    evidence_refs: [`reservation:${input.reservation.reservation_id}`],
    repository_id: input.reservation.repository_id,
    repository_root: resolvePath(input.repository_root),
    updated_at: created_at,
  });
}

export function registerPublicationCheckoutWorkspace(input: {
  readonly work_id: string;
  readonly reservation_id: string;
  readonly repository_id: string;
  readonly repository_root: string;
  readonly proof_root: string;
}): LocalWorkspaceRecord {
  const kind = classifyDisposablePath(input.proof_root);
  if (!kind) {
    throw new Error("publication proof_root is not a DNA OS disposable isolation directory");
  }
  const workspace_id = `lws-${randomUUID()}`;
  const created_at = nowIso();
  return persist({
    workspace_id,
    work_id: input.work_id,
    machine_id: machineId(),
    path_reference: resolvePath(input.proof_root),
    path_kind: kind,
    purpose: "PUBLICATION_PROOF",
    owner_capability: "control/source-workspace",
    created_at,
    current_state: "ACTIVE",
    reservation_id: input.reservation_id,
    cleanup_policy: "DISPOSABLE",
    persistence_policy: "EPHEMERAL",
    evidence_refs: [`publication_checkout:${input.reservation_id}`],
    repository_id: input.repository_id,
    repository_root: resolvePath(input.repository_root),
    updated_at: created_at,
  });
}

export function transitionLocalWorkspace(
  workspaceId: string,
  next: LocalWorkspaceState,
  evidenceRef?: string,
): LocalWorkspaceRecord | null {
  const current = listLocalWorkspaces().find((row) => row.workspace_id === workspaceId);
  if (!current) return null;
  const updated_at = nowIso();
  return persist({
    ...current,
    current_state: next,
    evidence_refs: evidenceRef ? [...current.evidence_refs, evidenceRef] : current.evidence_refs,
    updated_at,
  });
}
