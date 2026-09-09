/**
 * Scoped workspace binding for local resource work.
 * Git isolation reuses control/source-workspace. Logical attachments live here.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { createWorkspace, latestWorkspaceForWork, pathDisclosureRef } from "../source-workspace/contract";
import { dataPath, nowIso, repoRoot } from "./host-runtime";
import { getRegisteredLocalResource } from "./resource-registry";

export interface ScopedWorkspaceBinding {
  readonly workspace_id: string;
  readonly work_id: string;
  readonly attached_resource_ids: readonly string[];
  readonly reservation_id: string | null;
  readonly workspace_ref: string;
  readonly created_at: string;
}

function bindFile(): string {
  return dataPath("scoped-workspaces.jsonl", "LOCAL_RESOURCE_WORKSPACES_LOG");
}

function persist(row: ScopedWorkspaceBinding): ScopedWorkspaceBinding {
  const p = bindFile();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function listScopedWorkspaces(workId?: string): readonly ScopedWorkspaceBinding[] {
  const p = bindFile();
  if (!existsSync(p)) return [];
  const latest = new Map<string, ScopedWorkspaceBinding>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as ScopedWorkspaceBinding;
      latest.set(row.workspace_id, row);
    } catch {
      /* skip */
    }
  }
  const rows = [...latest.values()];
  return workId ? rows.filter((row) => row.work_id === workId) : rows;
}

export async function createScopedLocalWorkspace(input: {
  readonly work_id: string;
  readonly resource_ids: readonly string[];
}): Promise<{ ok: boolean; reason_code: string; binding: ScopedWorkspaceBinding | null }> {
  const resources = input.resource_ids.map((id) => getRegisteredLocalResource(id));
  if (resources.some((row) => row === null)) {
    return { ok: false, reason_code: "UNKNOWN_RESOURCE", binding: null };
  }
  const git = resources.find((row) => row?.resource_type === "GIT_REPOSITORY");
  let reservation_id: string | null = null;
  let workspace_ref = `scoped-workspace://${input.work_id}`;
  if (git) {
    const created = await createWorkspace({
      work_id: input.work_id,
      repository_id: "repository://local-resource-access/fixture",
      repository_root: repoRoot(),
      base_branch: "HEAD",
      purpose: "ENGINEERING_ISOLATION",
    });
    if (created.status !== "CREATED" || !created.reservation) {
      const existing = latestWorkspaceForWork(input.work_id);
      if (!existing) return { ok: false, reason_code: "WORKSPACE_CREATE_FAILED", binding: null };
      reservation_id = existing.reservation_id;
      workspace_ref = pathDisclosureRef(existing.workspace_id);
    } else {
      reservation_id = created.reservation.reservation_id;
      const registered = latestWorkspaceForWork(input.work_id);
      workspace_ref = registered ? pathDisclosureRef(registered.workspace_id) : `reservation://${reservation_id}`;
    }
  }
  const binding = persist({
    workspace_id: `lsw-${randomUUID()}`,
    work_id: input.work_id,
    attached_resource_ids: input.resource_ids,
    reservation_id,
    workspace_ref,
    created_at: nowIso(),
  });
  return { ok: true, reason_code: "CREATED", binding };
}
