/**
 * หน้าที่: the single internal Entry Context Resolver — the ONLY place in
 * this repo allowed to assemble an `ExecutionPolicyContext` from real,
 * already-registered data before `../command-router/`'s
 * `routeOwnerCommand` (via `../owner-command/`'s `submitOwnerCommand`)
 * ever calls `evaluateExecutionPermission`. Resolves Identity, Account,
 * Workspace, Membership, CommandPolicyDescriptor, and ExecutionGrant
 * purely by reading real stores — never fabricates, never defaults a
 * missing lookup to a synthetic value.
 *
 * "Account" and "Workspace" resolution (Owner, 2026-08-16 — closes the
 * gap this file's own header previously flagged as `NOT_YET_BUILT`): this
 * repo now has independent, real Account/Workspace registries
 * (`../../permissions/software-scope/account-registry.ts`,
 * `../../permissions/software-scope/workspace-registry.ts`).
 * `request.account_id` only resolves to a real `account` if `getAccount()`
 * finds it AND its `status === "ACTIVE"`. `request.workspace_id` only
 * resolves to a real `workspace` if `getWorkspace()` finds it AND its
 * `status === "ACTIVE"` AND `workspace.account_id === request.account_id`
 * (cross-account rejection). This resolver never edits
 * `../../permissions/execution-policy/rules.ts` or changes its
 * ALLOW/DENY/OWNER_REVIEW semantics — instead it FILTERS the
 * `memberships` array before handing it to `ExecutionPolicyContext`: any
 * `scope_type: "account"` membership whose `scope_id` doesn't match a
 * validly-resolved `account`, and any `scope_type: "workspace"`
 * membership whose `scope_id` doesn't match a validly-resolved
 * `workspace`, is dropped before `rules.ts` ever sees it (this also
 * naturally covers a dangling membership pointing at an account/workspace
 * id that was never registered at all — same "no valid resolution" code
 * path). `rules.ts`'s existing, untouched `ruleAccountMembershipValid` /
 * `ruleWorkspaceMembershipValid` then naturally see "no membership row"
 * for that scope and DENY via their existing, untouched
 * `MISSING_ACCOUNT_MEMBERSHIP`/`MISSING_WORKSPACE_MEMBERSHIP` reason
 * codes — this is the intended design, not an incidental side effect.
 * `scope_type: "tenant"` memberships are left unfiltered — no Tenant
 * registry exists or was asked for this round, flagged as `NOT_YET_BUILT`
 * below, not silently assumed sufficient forever.
 *
 * INTERNAL ONLY — no external system, network call, database, or
 * cross-repo import anywhere in this file. Every lookup is a real,
 * in-memory, process-local store (`../../permissions/access-control/
 * identity-registry.ts`, `../../permissions/access-control/
 * membership-registry.ts`, `../../permissions/software-scope/
 * account-registry.ts`, `../../permissions/software-scope/
 * workspace-registry.ts`, `../../permissions/execution-policy/grants.ts`,
 * `../../execution/run/policy-descriptor.ts`).
 *
 * Input: `EntryContextRequest` (see ./types.ts) — plain id strings only.
 * Output: `resolveEntryContext` → `EntryContextResolution` (now also
 * exposing the resolved `account`/`workspace` for observability — see
 * ./types.ts's own header).
 * Dependency ที่อนุญาต: ./types.ts,
 * ../../permissions/access-control/identity-registry.ts,
 * ../../permissions/access-control/membership-registry.ts,
 * ../../permissions/software-scope/account-registry.ts,
 * ../../permissions/software-scope/workspace-registry.ts,
 * ../../permissions/execution-policy/contract.ts,
 * ../../execution/run/contract.ts.
 * สิ่งที่ห้ามแตะ: never construct an `Identity`, `Membership`,
 * `ExecutionGrant`, `CommandPolicyDescriptor`, `AccountRecord`, or
 * `WorkspaceRecord` literal here — every one must come from a real
 * store's own real read function. A missing lookup must resolve to
 * `undefined`/an empty array, exactly matching
 * `../../permissions/execution-policy/types.ts`'s own
 * `ExecutionPolicyContext` doc ("undefined = could not be resolved by the
 * caller") — never guessed, never defaulted to something permissive.
 * Never call `evaluateExecutionPermission` or `startExecution` here —
 * this file only ASSEMBLES the context; deciding and executing stay in
 * `../command-router/`. Never modify
 * `../../permissions/execution-policy/rules.ts` or `./policy.ts` in that
 * folder, and never change what counts as ALLOW/DENY/OWNER_REVIEW there —
 * the membership filter in this file is the only sanctioned way to close
 * the Account/Workspace trust gap (see paragraph above).
 *
 * NOT_YET_BUILT: no runtime transport calls this yet — see
 * ./tests/entry-context.test.ts, which drives this module directly by
 * hand. Independent Tenant registry cross-check — `scope_type: "tenant"`
 * memberships stay unfiltered this round (see paragraph above).
 */

import { getIdentityRegistration } from "../../permissions/access-control/identity-registry";
import { listMembershipsForIdentity } from "../../permissions/access-control/membership-registry";
import { listExecutionGrantsForIdentity } from "../../permissions/execution-policy/contract";
import type { ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import { projectCommandPolicyDescriptor, WORKSPACE_ROOT_CWD_SCOPE } from "../../execution/run/contract";
import { getAccount } from "../../permissions/software-scope/account-registry";
import type { AccountRecord } from "../../permissions/software-scope/account-registry";
import { getWorkspace } from "../../permissions/software-scope/workspace-registry";
import type { WorkspaceRecord } from "../../permissions/software-scope/workspace-registry";
import type { EntryContextRequest, EntryContextResolution } from "./types";

export function resolveEntryContext(request: EntryContextRequest): EntryContextResolution {
  const registration = getIdentityRegistration(request.identity_id);
  // Only an "active" registration resolves to a usable Identity — a
  // suspended/revoked one is real data, but must never be handed to the
  // policy layer as if it were current and usable. undefined is the
  // correct, fail-closed answer either way (unregistered vs. inactive).
  const identity = registration && registration.status === "active" ? registration.identity : undefined;

  const accountRecord = getAccount(request.account_id);
  // Real, ACTIVE only. Missing/suspended/retired all resolve to
  // undefined — no synthetic fallback, matching this file's own rule.
  const account: AccountRecord | undefined = accountRecord && accountRecord.status === "ACTIVE" ? accountRecord : undefined;

  const workspaceRecord = getWorkspace(request.workspace_id);
  // Real, ACTIVE, AND belonging to the requested account_id — a
  // cross-account workspace (or a missing/suspended one) resolves to
  // undefined, same fail-closed rule.
  const workspace: WorkspaceRecord | undefined =
    workspaceRecord && workspaceRecord.status === "ACTIVE" && workspaceRecord.account_id === request.account_id ? workspaceRecord : undefined;

  const allMemberships = listMembershipsForIdentity(request.identity_id);
  // Drop any account/workspace-scoped membership whose underlying
  // account/workspace didn't validly resolve above — this is what makes
  // ../../permissions/execution-policy/rules.ts's existing, untouched
  // rules naturally DENY on a missing/suspended/cross-account/dangling
  // account or workspace, without this file ever touching rules.ts
  // itself. tenant-scoped memberships pass through unfiltered (see
  // header — no Tenant registry this round).
  const memberships = allMemberships.filter((m) => {
    if (m.scope_type === "account") return account !== undefined && m.scope_id === account.account_id;
    if (m.scope_type === "workspace") return workspace !== undefined && m.scope_id === workspace.workspace_id;
    return true;
  });

  const grants = listExecutionGrantsForIdentity(request.identity_id);
  const command = projectCommandPolicyDescriptor(request.command_id);

  const context: ExecutionPolicyContext = { identity, memberships, grants, command };

  return {
    context,
    account,
    workspace,
    executionRequestBase: {
      identity_id: request.identity_id,
      account_id: request.account_id,
      workspace_id: request.workspace_id,
      cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
    },
  };
}
