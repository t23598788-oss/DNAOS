/**
 * หน้าที่: the real, in-memory Workspace STORE — registration, suspend,
 * and query. Built 2026-08-16 alongside `./account-registry.ts`
 * specifically so `control/entry-context/` can resolve a real,
 * independently-registered Workspace, and cross-check it against a real
 * Account, never trust a bare `workspace_id` string or a Membership row
 * alone (see `../../control/entry-context/resolver.ts`'s header for the
 * gap this closes). No prior Workspace type existed anywhere in this
 * folder before this file — unlike Account, there is no older
 * `./workspace.ts` to reconcile with.
 *
 * DESIGN DECISION — `registerWorkspace` does NOT call into
 * `./account-registry.ts` to verify `account_id` really exists:
 * `account_id` is enforced here only as a required, non-empty STRING (a
 * structural check), matching this repo's already-established convention
 * that a child record's registration function does not cross-check its
 * parent's real existence — see `../access-control/membership-registry.ts`'s
 * `grantMembership`, which likewise never verifies the `identity_id` it is
 * given actually exists in `../access-control/identity-registry.ts`. The
 * real-existence check — "does this `account_id` resolve to a real,
 * ACTIVE Account, and does this Workspace really belong to it" — is the
 * resolver's job (`../../control/entry-context/resolver.ts`), consistently
 * applied across this whole layer, not this file's. This is a deliberate
 * design choice matching an existing precedent, not an oversight.
 *
 * REAL, IN-MEMORY, NOT A MOCK: every function does real work against a
 * real `Map`. Durable cross-process persistence is `NOT_YET_BUILT` — the
 * same honest gap every sibling registry in this repo already documents.
 *
 * Input: `RegisterWorkspaceInput` (register), a `workspace_id`
 * (get/suspend), an `account_id` (list).
 * Output: `WorkspaceRecord`, `WorkspaceStatus`, `RegisterWorkspaceInput`,
 * `registerWorkspace`, `getWorkspace`, `listWorkspacesForAccount`,
 * `suspendWorkspace`, `WorkspaceRegistrationError`.
 * Dependency ที่อนุญาต: none (see design decision above — deliberately NOT
 * `./account-registry.ts`).
 * สิ่งที่ห้ามแตะ: never let `getWorkspace` return a record for a
 * `workspace_id` that was never registered — absence must be `undefined`,
 * never synthesized. Never delete a record on suspend —
 * `suspendWorkspace` mutates `status` in place on the same record,
 * matching this repo's append-and-link discipline. Never add a
 * reactivate/un-suspend/retire operation here speculatively — same
 * rationale as `./account-registry.ts`'s header; for the same reason,
 * `registerWorkspace` throws (never silently re-provisions/reactivates)
 * when called twice for the same `workspace_id`. Never make this file
 * reach into `./account-registry.ts` — see design decision above.
 *
 * NOT_YET_BUILT: no durable storage backend. No reactivate/un-suspend/
 * retire operation. No cross-check against `./account-registry.ts` inside
 * this file itself (see design decision above — intentional, not a gap;
 * the real cross-check lives in `../../control/entry-context/resolver.ts`).
 */

export type WorkspaceStatus = "ACTIVE" | "SUSPENDED" | "RETIRED";

export interface WorkspaceRecord {
  workspace_id: string;
  account_id: string;
  status: WorkspaceStatus;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterWorkspaceInput {
  workspace_id: string;
  account_id: string;
  metadata?: Record<string, unknown>;
}

export class WorkspaceRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRegistrationError";
  }
}

const workspaces = new Map<string, WorkspaceRecord>();

function nowIsoDefault(): string {
  return new Date().toISOString();
}

/** A fresh registration is always born "ACTIVE". Registering the same workspace_id twice throws — see this file's header for why that is deliberate, not a missing feature. account_id is a required non-empty string only — never cross-checked against ./account-registry.ts here, see header. */
export function registerWorkspace(input: RegisterWorkspaceInput, createdAt: string = nowIsoDefault()): WorkspaceRecord {
  if (!input.workspace_id || input.workspace_id.length === 0) {
    throw new WorkspaceRegistrationError("workspace_id must be a non-empty string");
  }
  if (!input.account_id || input.account_id.length === 0) {
    throw new WorkspaceRegistrationError("account_id must be a non-empty string");
  }
  if (workspaces.has(input.workspace_id)) {
    throw new WorkspaceRegistrationError(`workspace "${input.workspace_id}" is already registered`);
  }
  const record: WorkspaceRecord = { workspace_id: input.workspace_id, account_id: input.account_id, status: "ACTIVE", created_at: createdAt, metadata: input.metadata };
  workspaces.set(input.workspace_id, record);
  return record;
}

export function getWorkspace(workspaceId: string): WorkspaceRecord | undefined {
  return workspaces.get(workspaceId);
}

/** Every workspace on record for this account — filtering by status happens at the call site (see ../../control/entry-context/resolver.ts), not here, so the caller always sees the complete real picture, matching ../access-control/membership-registry.ts's listMembershipsForIdentity convention. */
export function listWorkspacesForAccount(accountId: string): readonly WorkspaceRecord[] {
  return [...workspaces.values()].filter((w) => w.account_id === accountId);
}

export function suspendWorkspace(workspaceId: string): WorkspaceRecord {
  const existing = workspaces.get(workspaceId);
  if (!existing) {
    throw new WorkspaceRegistrationError(`no workspace registered with id "${workspaceId}"`);
  }
  const updated: WorkspaceRecord = { ...existing, status: "SUSPENDED" };
  workspaces.set(workspaceId, updated);
  return updated;
}

/** Test-only introspection — never imported by any future route. */
export function __debugWorkspaceCount(): number {
  return workspaces.size;
}
