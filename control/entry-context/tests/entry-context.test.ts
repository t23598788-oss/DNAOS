/**
 * หน้าที่: the real test for `control/entry-context/`. Drives
 * `../contract.ts` directly by hand, the same convention as every other
 * suite in this repo. Proves `resolveEntryContext()` never fabricates —
 * every field of the `ExecutionPolicyContext` it produces is traced back
 * to a real store call in this file, plus one full end-to-end proof that
 * its output flows correctly into `../../owner-command/`'s
 * `submitOwnerCommand`, closing the real internal path:
 *
 *   Owner Command → entry-context (resolve) → command-router
 *   → evaluateExecutionPermission → ALLOW only → execution/run
 *
 * How to run: npx tsx control/entry-context/tests/entry-context.test.ts
 *
 * Input: none (all fixtures constructed in this file, but only via real
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
 * สิ่งที่ห้ามแตะ: never hand-build an `Identity`/`Membership`/
 * `ExecutionGrant`/`CommandPolicyDescriptor` literal in this file —
 * always go through the real registration/issuance/projection functions.
 */

import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { registerIdentity, setIdentityStatus } from "../../../permissions/access-control/identity-registry";
import { grantMembership, revokeMembership } from "../../../permissions/access-control/membership-registry";
import { evaluateExecutionPermission, issueExecutionGrant } from "../../../permissions/execution-policy/contract";
import { WORKSPACE_ROOT_CWD_SCOPE } from "../../../execution/run/contract";
import { registerAccount } from "../../../permissions/software-scope/account-registry";
import { registerWorkspace } from "../../../permissions/software-scope/workspace-registry";
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
  await check("unregistered identity resolves to undefined identity — never fabricated", () => {
    const scenario = freshScenario();
    // Deliberately no registerIdentity() call.
    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.context.identity === undefined, "expected identity to be undefined for an unregistered identity_id");
    assert(resolution.context.memberships.length === 0, "expected no memberships for an identity with none granted");
    assert(resolution.context.grants.length === 0, "expected no grants for an identity with none issued");
  });

  await check("registered, active identity resolves to the real Identity object", () => {
    const scenario = freshScenario();
    const registration = registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.context.identity !== undefined, "expected a resolved identity");
    assert(resolution.context.identity!.identity_id === registration.identity.identity_id, "expected the resolved identity to match the real registration");
  });

  await check("suspended identity resolves to undefined — inactive is never treated as usable", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    setIdentityStatus(scenario.identityId, "suspended");
    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.context.identity === undefined, "expected a suspended identity to resolve as undefined, never usable");
  });

  await check("real memberships (account + workspace) are resolved, including a revoked one still present but marked — requires a real, ACTIVE Account and Workspace to survive the resolver's filter", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    registerAccount({ account_id: scenario.accountId });
    registerWorkspace({ workspace_id: scenario.workspaceId, account_id: scenario.accountId });
    const accountMembership = grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });
    grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });
    revokeMembership(accountMembership.membership_id);

    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.context.memberships.length === 2, `expected both memberships (including the revoked one) to be present, got ${resolution.context.memberships.length}`);
    const revoked = resolution.context.memberships.find((m) => m.membership_id === accountMembership.membership_id);
    assert(revoked?.revoked_at !== undefined, "expected the revoked membership's revoked_at to be visible in the resolved context");
    assert(resolution.account?.account_id === scenario.accountId, "expected the real registered Account to be exposed on the resolution");
    assert(resolution.workspace?.workspace_id === scenario.workspaceId, "expected the real registered Workspace to be exposed on the resolution");
  });

  await check("real grants are resolved via the real store, never duplicated locally", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    const grant = issueExecutionGrant({
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
    assert(resolution.context.grants.some((g) => g.grant_id === grant.grant_id), "expected the real issued grant to appear in the resolved context");
  });

  await check("command descriptor is the real projection, never a duplicate — unknown command resolves to undefined", () => {
    const scenario = freshScenario();
    const known = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(known.context.command !== undefined && known.context.command!.command_id === REGISTERED_COMMAND_ID, "expected the real projected descriptor for a known command");
    const unknown = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: "command.not.real" });
    assert(unknown.context.command === undefined, "expected undefined command descriptor for an unregistered command_id");
  });

  await check("executionRequestBase carries the real WORKSPACE_ROOT_CWD_SCOPE, never a guessed value", () => {
    const scenario = freshScenario();
    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.executionRequestBase.cwd_scope === WORKSPACE_ROOT_CWD_SCOPE, `expected cwd_scope "${WORKSPACE_ROOT_CWD_SCOPE}", got "${resolution.executionRequestBase.cwd_scope}"`);
    assert(resolution.executionRequestBase.identity_id === scenario.identityId, "expected executionRequestBase.identity_id to match the request");
    assert(resolution.executionRequestBase.account_id === scenario.accountId, "expected executionRequestBase.account_id to match the request");
    assert(resolution.executionRequestBase.workspace_id === scenario.workspaceId, "expected executionRequestBase.workspace_id to match the request");
  });

  await check("real chain: resolved context with no grant issued -> real DENY through evaluateExecutionPermission", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    registerAccount({ account_id: scenario.accountId });
    registerWorkspace({ workspace_id: scenario.workspaceId, account_id: scenario.accountId });
    grantMembership({ identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member" });
    grantMembership({ identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member" });
    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
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
    assert(decision.decision === "DENY", `expected DENY (no grant issued), got ${decision.decision}`);
  });

  await check("dangling membership is rejected — a membership pointing at an account_id that was never registered is filtered out, real DENY follows", () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    // Deliberately no registerAccount()/registerWorkspace() call — the account_id/workspace_id below are dangling.
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
    assert(resolution.account === undefined, "expected no real Account to resolve for a never-registered account_id");
    assert(resolution.workspace === undefined, "expected no real Workspace to resolve for a never-registered workspace_id");
    assert(
      resolution.context.memberships.filter((m) => m.scope_type === "account" || m.scope_type === "workspace").length === 0,
      "expected the dangling account/workspace memberships to be filtered out of the resolved context entirely",
    );

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
    assert(decision.decision === "DENY", `expected a dangling membership (no real Account/Workspace behind it) to DENY even with a real issued grant, got ${decision.decision}`);
    assert(
      decision.reason_codes.includes("MISSING_ACCOUNT_MEMBERSHIP"),
      `expected reason_codes to include MISSING_ACCOUNT_MEMBERSHIP once the dangling membership was filtered out, got ${JSON.stringify(decision.reason_codes)}`,
    );
  });

  await check("cross-account workspace is rejected — a real Workspace registered under a DIFFERENT account is filtered out, real DENY follows", () => {
    const scenario = freshScenario();
    const otherAccountId = uniqueId("account-other-owner");
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
    registerAccount({ account_id: scenario.accountId });
    registerAccount({ account_id: otherAccountId });
    // The workspace is real and ACTIVE, but really belongs to otherAccountId, not scenario.accountId.
    registerWorkspace({ workspace_id: scenario.workspaceId, account_id: otherAccountId });
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

    // Requesting with scenario.accountId (the real, correct account this identity belongs to) but a workspace_id that
    // really belongs to otherAccountId — the cross-account mismatch must be rejected, even though both the account
    // and the workspace are independently real and ACTIVE.
    const resolution = resolveEntryContext({ identity_id: scenario.identityId, account_id: scenario.accountId, workspace_id: scenario.workspaceId, command_id: REGISTERED_COMMAND_ID });
    assert(resolution.account?.account_id === scenario.accountId, "expected the real requested Account to still resolve on its own");
    assert(resolution.workspace === undefined, "expected the cross-account Workspace to resolve as undefined, never as if it belonged to the requested account");
    assert(
      resolution.context.memberships.some((m) => m.scope_type === "workspace") === false,
      "expected the cross-account workspace membership to be filtered out of the resolved context",
    );

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
    assert(decision.decision === "DENY", `expected a cross-account workspace to DENY even with a real issued grant, got ${decision.decision}`);
    assert(
      decision.reason_codes.includes("MISSING_WORKSPACE_MEMBERSHIP"),
      `expected reason_codes to include MISSING_WORKSPACE_MEMBERSHIP once the cross-account workspace was filtered out, got ${JSON.stringify(decision.reason_codes)}`,
    );
  });

  await check("full real internal path: Owner Command -> entry-context -> router -> evaluateExecutionPermission -> ALLOW -> execution/run", async () => {
    const scenario = freshScenario();
    registerIdentity({ identity_id: scenario.identityId, kind: "human", display_name: "Entry Context Test" });
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

    const ownerIdentity: EnvelopeIdentity = { identity_id: scenario.identityId, acting_as_account_id: scenario.accountId, acting_as_tenant_id: uniqueId("tenant"), software_id: uniqueId("software"), kind: "human" };
    const options: RouteOptions = {
      steps: [{ capability_id: "execution", intent: "execution.run", payload: { command_id: REGISTERED_COMMAND_ID } }],
      executionPolicyContext: resolution.context,
      executionRequestBase: resolution.executionRequestBase,
    };
    const outcome = await submitOwnerCommand("รันคำสั่งที่อนุญาตแล้ว (entry-context)", ownerIdentity, options);
    assert(
      outcome.result.status === "COMPLETED" || outcome.result.status === "RUNNING",
      `expected the full real internal path to reach COMPLETED/RUNNING, got ${outcome.result.status} (${outcome.result.summary})`,
    );
    assert(outcome.result.evidence.some((e) => e.source === "execution"), "expected real execution evidence — proves the chain actually reached execution/run");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
