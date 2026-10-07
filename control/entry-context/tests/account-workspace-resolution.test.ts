/**
 * หน้าที่: the real test for the Account/Workspace resolution gap closed
 * in `../resolver.ts` (Owner, 2026-08-16) — proves `resolveEntryContext()`
 * now requires a real, independently-registered, ACTIVE Account and
 * Workspace (via `../../../permissions/software-scope/account-registry.ts`
 * / `../../../permissions/software-scope/workspace-registry.ts`) before
 * any account/workspace-scoped Membership is treated as real, and that
 * this is achieved purely by FILTERING `context.memberships` before it
 * reaches `../../../permissions/execution-policy/rules.ts` — never by
 * editing that file. Sibling to `./entry-context.test.ts` (which already
 * covers Identity/grant/command resolution and one full-path proof); this
 * file is scoped specifically to the new Account/Workspace behavior.
 *
 * How to run: npx tsx control/entry-context/tests/account-workspace-resolution.test.ts
 *
 * Input: none (all fixtures constructed in this file, always via real
 * source functions — never a hand-built literal).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../contract.ts,
 * ../../../permissions/access-control/identity-registry.ts,
 * ../../../permissions/access-control/membership-registry.ts,
 * ../../../permissions/software-scope/account-registry.ts,
 * ../../../permissions/software-scope/workspace-registry.ts,
 * ../../../permissions/execution-policy/contract.ts,
 * ../../../execution/run/contract.ts, ../../owner-command/contract.ts,
 * ../../../contracts/identity/envelope-identity.ts (public contracts
 * only).
 * สิ่งที่ห้ามแตะ: never hand-build an `Identity`/`AccountRecord`/
 * `WorkspaceRecord`/`Membership`/`ExecutionGrant`/`CommandPolicyDescriptor`
 * literal in this file — always go through the real registration/
 * issuance/projection functions. Never assert on
 * `../../../permissions/execution-policy/rules.ts` internals directly —
 * only on `resolveEntryContext()`'s output and
 * `evaluateExecutionPermission()`'s real decision.
 */

import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import { grantMembership } from "../../../permissions/access-control/membership-registry";
import { evaluateExecutionPermission, issueExecutionGrant } from "../../../permissions/execution-policy/contract";
import { WORKSPACE_ROOT_CWD_SCOPE } from "../../../execution/run/contract";
import { registerAccount, suspendAccount } from "../../../permissions/software-scope/account-registry";
import { registerWorkspace, suspendWorkspace } from "../../../permissions/software-scope/workspace-registry";
import { resolveEntryContext } from "../contract";
import { submitOwnerCommand } from "../../owner-command/contract";
import type { RouteOptions } from "../../command-router/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const CAPABILITY = "execution.run";
const REGISTERED_COMMAND_ID = "workspace.pwd";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

function uniqueId(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2)}`;
}

interface Scenario {
  identityId: string;
  accountId: string;
  workspaceId: string;
}

function freshScenario(): Scenario {
  const suffix = Math.random().toString(36).slice(2);
  return { identityId: `identity-${suffix}`, accountId: `account-${suffix}`, workspaceId: `workspace-${suffix}` };
}

async function main(): Promise<void> {
  await check("valid Account (registered + ACTIVE) resolves correctly, and its account-scope membership survives the filter", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    registerAccount({ account_id: scenario.accountId });
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.account !== undefined && resolution.account.account_id === scenario.accountId, "expected the real registered, ACTIVE Account to resolve");
    assert(resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the account-scope membership to survive the filter");
  });

  await check("suspended Account -> resolves undefined, its account-scope membership is filtered out", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    registerAccount({ account_id: scenario.accountId });
    suspendAccount(scenario.accountId);
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.account === undefined, "expected a SUSPENDED account to resolve as undefined, never usable");
    assert(!resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the account-scope membership for a suspended account to be filtered out");
  });

  await check("unknown Account (never registered) -> resolves undefined, its account-scope membership is filtered out", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    // Deliberately no registerAccount() call.
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.account === undefined, "expected an unregistered account_id to resolve as undefined");
    assert(!resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the account-scope membership for an unregistered account to be filtered out");
  });

  await check("valid Workspace (registered + ACTIVE + correct account_id) resolves correctly, and its workspace-scope membership survives the filter", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    registerAccount({ account_id: scenario.accountId });
    registerWorkspace({ workspace_id: scenario.workspaceId, account_id: scenario.accountId });
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.workspace !== undefined && resolution.workspace.workspace_id === scenario.workspaceId, "expected the real registered, ACTIVE, correctly-owned Workspace to resolve");
    assert(resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the workspace-scope membership to survive the filter");
  });

  await check("suspended Workspace -> resolves undefined, its workspace-scope membership is filtered out", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    registerAccount({ account_id: scenario.accountId });
    registerWorkspace({ workspace_id: scenario.workspaceId, account_id: scenario.accountId });
    suspendWorkspace(scenario.workspaceId);
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.workspace === undefined, "expected a SUSPENDED workspace to resolve as undefined, never usable");
    assert(!resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the workspace-scope membership for a suspended workspace to be filtered out");
  });

  await check("unknown Workspace (never registered) -> resolves undefined, its workspace-scope membership is filtered out", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    registerAccount({ account_id: scenario.accountId });
    // Deliberately no registerWorkspace() call.
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.workspace === undefined, "expected an unregistered workspace_id to resolve as undefined");
    assert(!resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the workspace-scope membership for an unregistered workspace to be filtered out");
  });

  await check("cross-account Workspace rejection: workspace registered under account X, requested with account_id Y -> resolves undefined, filtered", () => {
    const scenario = freshScenario();
    const otherAccountId = uniqueId("other-account");
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    registerAccount({ account_id: scenario.accountId });
    registerAccount({ account_id: otherAccountId });
    // Workspace really belongs to otherAccountId, not scenario.accountId.
    registerWorkspace({ workspace_id: scenario.workspaceId, account_id: otherAccountId });
    const membership = grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.workspace === undefined, "expected a workspace owned by a different account to resolve as undefined for this request");
    assert(!resolution.context.memberships.some((m) => m.membership_id === membership.membership_id), "expected the cross-account workspace membership to be filtered out");
  });

  await check("dangling Membership rejection: a Membership row points at an account_id that was never registered anywhere -> filtered out, does not make that scope real", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
    // No registerAccount() at all for scenario.accountId anywhere in the process — this membership is inherently dangling.
    const danglingMembership = grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.account === undefined, "expected a dangling account membership to never make the account resolve as real");
    assert(!resolution.context.memberships.some((m) => m.membership_id === danglingMembership.membership_id), "expected the dangling membership row to be filtered out before reaching execution-policy");

    const decision = evaluateExecutionPermission(
      {
        identity_id: scenario.identityId,
        account_id: scenario.accountId,
        workspace_id: scenario.workspaceId,
        capability: CAPABILITY,
        command_id: REGISTERED_COMMAND_ID,
        action: "run",
        cwd_scope: resolution.executionRequestBase.cwd_scope,
        requested_args: [],
        correlation_id: uniqueId("corr"),
      },
      resolution.context,
    );
    assert(decision.decision === "DENY", `expected the dangling membership to still DENY through the real, unmodified rules.ts, got ${decision.decision}`);
    assert(decision.reason_codes.includes("MISSING_ACCOUNT_MEMBERSHIP"), `expected reason_codes to include MISSING_ACCOUNT_MEMBERSHIP (rules.ts's own existing code, untouched), got ${JSON.stringify(decision.reason_codes)}`);
  });

  await check(
    "full real internal path: Identity -> Account -> Workspace -> Membership -> entry-context -> router -> evaluateExecutionPermission -> ALLOW -> execution/run",
    async () => {
      const scenario = freshScenario();
      registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Account/Workspace Resolution Test" });
      registerAccount({ account_id: scenario.accountId });
      registerWorkspace({ workspace_id: scenario.workspaceId, account_id: scenario.accountId });
      grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });
      grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });
      issueExecutionGrant({
        identity_id: scenario.identityId,
        account_id: scenario.accountId,
        workspace_id: scenario.workspaceId,
        capability: CAPABILITY,
        command_id: REGISTERED_COMMAND_ID,
        action: "run",
        cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE,
        effect: "allow",
      });

      const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
      assert(resolution.account?.account_id === scenario.accountId, "expected the real Account to resolve on the full path");
      assert(resolution.workspace?.workspace_id === scenario.workspaceId, "expected the real Workspace to resolve on the full path");

      // Direct real policy call, proving the resolved context alone (with the real, unmodified rules.ts) reaches ALLOW.
      const directDecision = evaluateExecutionPermission(
        {
          identity_id: scenario.identityId,
          account_id: scenario.accountId,
          workspace_id: scenario.workspaceId,
          capability: CAPABILITY,
          command_id: REGISTERED_COMMAND_ID,
          action: "run",
          cwd_scope: resolution.executionRequestBase.cwd_scope,
          requested_args: [],
          correlation_id: uniqueId("corr"),
        },
        resolution.context,
      );
      assert(directDecision.decision === "ALLOW", `expected the full real chain to reach ALLOW via evaluateExecutionPermission, got ${directDecision.decision} (${JSON.stringify(directDecision.reason_codes)})`);

      // Full path through the real router/owner-command/execution surfaces.
      const ownerIdentity: EnvelopeIdentity = { identity_id: scenario.identityId, acting_as_account_id: scenario.accountId, acting_as_tenant_id: uniqueId("tenant"), software_id: uniqueId("software"), kind: "human" };
      const options: RouteOptions = {
        steps: [{ capability_id: "execution", intent: "execution.run", payload: { command_id: REGISTERED_COMMAND_ID } }],
        executionPolicyContext: resolution.context,
        executionRequestBase: resolution.executionRequestBase,
      };
      const outcome = await submitOwnerCommand("รันคำสั่งที่อนุญาตแล้ว (account/workspace resolution)", ownerIdentity, options);
      assert(
        outcome.result.status === "COMPLETED" || outcome.result.status === "RUNNING",
        `expected the full real internal path (Identity->Account->Workspace->Membership->entry-context->router->permission->execution) to reach COMPLETED/RUNNING, got ${outcome.result.status} (${outcome.result.summary})`,
      );
      assert(outcome.result.evidence.some((e) => e.source === "execution"), "expected real execution evidence — proves the chain actually reached execution/run");
    },
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
