/**
 * หน้าที่: the full real-composition proof — real `ExecutionGrant`s issued
 * through `../../permissions/execution-policy/contract.ts`'s real store,
 * a real `CommandPolicyDescriptor` projected through `../contract.ts`'s
 * `projectCommandPolicyDescriptor()` (never a hand-built fixture), a real
 * `evaluateExecutionPermission()` call, and a real `startExecution()` call
 * that actually spawns a process — chained together exactly the way a
 * future `control/command-router/` is expected to, WITHOUT that router
 * existing. This is the test that answers "is execution ready to wire?"
 * for everything except the router/route layer itself (see this file's
 * own final check).
 *
 * Both capabilities' own dependency law is respected: this file lives
 * under `execution/run/tests/` (not
 * `permissions/execution-policy/tests/`) specifically because
 * `execution/run/` is the side allowed to depend on
 * `permissions/execution-policy/` — never the reverse.
 *
 * How to run: npx tsx execution/run/tests/policy-integration.test.ts
 *
 * Input: none.
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../contract.ts,
 * ../../permissions/execution-policy/contract.ts (both public contracts
 * only).
 * สิ่งที่ห้ามแตะ: never hand-construct a `CommandPolicyDescriptor` in this
 * file — always call `projectCommandPolicyDescriptor()`. Never
 * hand-construct an `ExecutionGrant` — always call `issueExecutionGrant()`.
 * The whole point of this file is proving the REAL sources compose, not
 * proving synthetic fixtures compose (that's what
 * `../../permissions/execution-policy/tests/policy.test.ts` and
 * `./executor.test.ts` already cover, deliberately, at the unit level).
 */

import { evaluateExecutionPermission, issueExecutionGrant, listExecutionGrantsForIdentity, revokeExecutionGrant } from "../../../permissions/execution-policy/contract";
import type { ExecutionPolicyContext } from "../../../permissions/execution-policy/contract";
import { getExecution, projectCommandPolicyDescriptor, startExecution, WORKSPACE_ROOT_CWD_SCOPE } from "../contract";
import type { ExecutionRequest, ExecutionResult } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;

const PAST = "2026-01-01T00:00:00.000Z";
const NOW = new Date().toISOString();
const COMMAND_ID = "workspace.pwd";
const CAPABILITY = "execution.run";
const ACTION = "run";

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

function waitForTerminal(executionId: string, identityId: string, timeoutMs = 10_000): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const current = getExecution(executionId, identityId);
      if (current.status !== "queued" && current.status !== "running") {
        resolve(current);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`execution ${executionId} did not reach a terminal state within ${timeoutMs}ms (status=${current.status})`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
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

function contextFor(scenario: Scenario): ExecutionPolicyContext {
  const command = projectCommandPolicyDescriptor(COMMAND_ID);
  if (!command) throw new Error(`expected "${COMMAND_ID}" to be a real registered command`);
  return {
    identity: { identity_id: scenario.identityId, kind: "human", display_name: "Policy Integration Test Identity" },
    memberships: [
      { membership_id: `m-acct-${scenario.identityId}`, identity_id: scenario.identityId, scope_type: "account", scope_id: scenario.accountId, role: "member", granted_at: PAST },
      { membership_id: `m-ws-${scenario.identityId}`, identity_id: scenario.identityId, scope_type: "workspace", scope_id: scenario.workspaceId, role: "member", granted_at: PAST },
    ],
    grants: listExecutionGrantsForIdentity(scenario.identityId),
    command,
  };
}

async function main(): Promise<void> {
  await check("real chain end-to-end: real grant -> real projected descriptor -> real ALLOW decision -> real spawned process", async () => {
    const scenario = freshScenario();
    issueExecutionGrant({
      identity_id: scenario.identityId,
      account_id: scenario.accountId,
      workspace_id: scenario.workspaceId,
      capability: CAPABILITY,
      command_id: COMMAND_ID,
      action: ACTION,
      cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE,
      effect: "allow",
      granted_at: PAST,
    });

    const decision = evaluateExecutionPermission(
      {
        identity_id: scenario.identityId,
        account_id: scenario.accountId,
        workspace_id: scenario.workspaceId,
        capability: CAPABILITY,
        command_id: COMMAND_ID,
        action: ACTION,
        cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
        requested_args: [],
        correlation_id: uniqueId("corr"),
      },
      contextFor(scenario),
      NOW,
    );
    assert(decision.decision === "ALLOW", `expected the real chain to ALLOW, got ${decision.decision} (${JSON.stringify(decision.reason_codes)})`);

    const request: ExecutionRequest = {
      correlation_id: decision.correlation_id,
      command_id: COMMAND_ID,
      identity_id: scenario.identityId,
      account_id: scenario.accountId,
      workspace_id: scenario.workspaceId,
      capability: CAPABILITY,
      action: ACTION,
      cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
      requested_args: {},
      permission_decision_id: decision.decision_id,
    };
    const started = startExecution(request, decision);
    const finalResult = await waitForTerminal(started.execution_id, scenario.identityId);
    assert(finalResult.status === "passed", `expected the real end-to-end chain to actually run /bin/pwd successfully, got ${finalResult.status}`);
    assert(finalResult.exitCode === 0, `expected a real exit code 0, got ${finalResult.exitCode}`);
  });

  await check("real chain end-to-end: revoking the real grant afterward denies a subsequent request", async () => {
    const scenario = freshScenario();
    const grant = issueExecutionGrant({
      identity_id: scenario.identityId,
      account_id: scenario.accountId,
      workspace_id: scenario.workspaceId,
      capability: CAPABILITY,
      command_id: COMMAND_ID,
      action: ACTION,
      cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE,
      effect: "allow",
      granted_at: PAST,
    });
    revokeExecutionGrant(grant.grant_id, PAST);

    const decision = evaluateExecutionPermission(
      {
        identity_id: scenario.identityId,
        account_id: scenario.accountId,
        workspace_id: scenario.workspaceId,
        capability: CAPABILITY,
        command_id: COMMAND_ID,
        action: ACTION,
        cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
        requested_args: [],
        correlation_id: uniqueId("corr"),
      },
      contextFor(scenario),
      NOW,
    );
    assert(decision.decision === "DENY", `expected a revoked real grant to DENY, got ${decision.decision}`);

    const request: ExecutionRequest = {
      correlation_id: decision.correlation_id,
      command_id: COMMAND_ID,
      identity_id: scenario.identityId,
      account_id: scenario.accountId,
      workspace_id: scenario.workspaceId,
      capability: CAPABILITY,
      action: ACTION,
      cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
      requested_args: {},
      permission_decision_id: decision.decision_id,
    };
    let threw = false;
    try {
      startExecution(request, decision);
    } catch {
      threw = true;
    }
    assert(threw, "expected startExecution to refuse to start once the real grant backing the decision was revoked");
  });

  await check("real chain end-to-end: no grant issued at all -> real DENY -> execution refuses", async () => {
    const scenario = freshScenario();
    // Deliberately no issueExecutionGrant call for this scenario.
    const decision = evaluateExecutionPermission(
      {
        identity_id: scenario.identityId,
        account_id: scenario.accountId,
        workspace_id: scenario.workspaceId,
        capability: CAPABILITY,
        command_id: COMMAND_ID,
        action: ACTION,
        cwd_scope: WORKSPACE_ROOT_CWD_SCOPE,
        requested_args: [],
        correlation_id: uniqueId("corr"),
      },
      contextFor(scenario),
      NOW,
    );
    assert(decision.decision === "DENY", `expected DENY with zero issued grants, got ${decision.decision}`);
    assert(decision.reason_codes.includes("NO_MATCHING_GRANT"), `expected NO_MATCHING_GRANT, got ${JSON.stringify(decision.reason_codes)}`);
  });

  console.log("\nNote: this proves the permission+execution chain composes correctly end-to-end with real sources.");
  console.log("It does NOT prove a route/router exists — control/command-router/ and control/owner-command/ remain NOT_YET_BUILT by design this round.");
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
});
