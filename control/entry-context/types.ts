/**
 * หน้าที่: the type contracts for `control/entry-context/` — what a
 * caller must supply to resolve an `ExecutionPolicyContext`, and what
 * comes back.
 *
 * Input: none (pure type definitions).
 * Output: `EntryContextRequest`, `EntryContextResolution`.
 * Dependency ที่อนุญาต: ../../permissions/execution-policy/contract.ts
 * (type only), ../../execution/run/contract.ts (type only, for
 * `WORKSPACE_ROOT_CWD_SCOPE`'s type via `Pick<ExecutionPermissionRequest,...>`),
 * ../../permissions/software-scope/account-registry.ts (type only, for
 * `AccountRecord`), ../../permissions/software-scope/workspace-registry.ts
 * (type only, for `WorkspaceRecord`).
 * สิ่งที่ห้ามแตะ: never add a field here that lets a caller ASSERT an
 * Identity/Account/Workspace/Membership/Grant directly — this folder only
 * ever resolves them from ../../permissions/access-control/'s,
 * ../../permissions/software-scope/'s, and
 * ../../permissions/execution-policy/'s real stores, keyed by the plain
 * id strings in `EntryContextRequest`. `account`/`workspace` on
 * `EntryContextResolution` are read-only diagnostic exposure of what
 * `./resolver.ts` already resolved internally — never a second, separate
 * resolution path, and never themselves consulted by any decision logic
 * (decisions flow only through `context.memberships`, already filtered,
 * into `../../permissions/execution-policy/rules.ts`, unmodified).
 *
 * NOT_YET_BUILT: no runtime caller yet — see ./resolver.ts's header.
 */

import type { ExecutionPermissionRequest, ExecutionPolicyContext } from "../../permissions/execution-policy/contract";
import type { AccountRecord } from "../../permissions/software-scope/account-registry";
import type { WorkspaceRecord } from "../../permissions/software-scope/workspace-registry";

export interface EntryContextRequest {
  identity_id: string;
  account_id: string;
  workspace_id: string;
  command_id: string;
}

export interface EntryContextResolution {
  context: ExecutionPolicyContext;
  /** The real, independently-resolved Account behind this request's `account_id` — `undefined` if it was never registered or is not `"ACTIVE"`. Diagnostic/observability only — see this file's own header. */
  account: AccountRecord | undefined;
  /** The real, independently-resolved Workspace behind this request's `workspace_id` — `undefined` if it was never registered, is not `"ACTIVE"`, or its `account_id` does not match this request's `account_id` (cross-account rejection). Diagnostic/observability only — see this file's own header. */
  workspace: WorkspaceRecord | undefined;
  /** Ready to spread into `RouteOptions.executionRequestBase` (`../command-router/contract.ts`) unchanged. */
  executionRequestBase: Pick<ExecutionPermissionRequest, "identity_id" | "account_id" | "workspace_id" | "cwd_scope">;
}
