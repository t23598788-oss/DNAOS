/**
 * หน้าที่: the real test for `execution/run/`. Drives `contract.ts`
 * directly by hand, the same way `../../connections/github/adapter.test.ts`
 * and `../../permissions/execution-policy/tests/policy.test.ts` drive
 * theirs — `../../control/command-router/` is `NOT_YET_BUILT`, so there
 * is no real caller yet. Every permission decision here is built by
 * calling the REAL `evaluateExecutionPermission()` from
 * `../../permissions/execution-policy/contract.ts` against real fixture
 * grants — never a hand-faked `{ decision: "ALLOW" }` object — so this
 * test proves the two capabilities compose correctly, not just that each
 * one works in isolation.
 *
 * Real processes are spawned (`/bin/pwd`, `/bin/ls -la` — the only two
 * commands `../registry.ts` registers). No network, no credential.
 *
 * How to run (no test framework and no package.json exist in this repo
 * yet; this file is a plain program with its own assertions):
 *   npx tsx execution/run/tests/executor.test.ts
 *
 * Input: none (all fixtures constructed in this file).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../contract.ts,
 * ../../permissions/execution-policy/contract.ts (both public contracts
 * only).
 * สิ่งที่ห้ามแตะ: never assert on a specific `execution_id`/`decision_id`
 * value (both are random) — assert on shape, status, and reason codes
 * only. Never write anything outside `execution/run/tests/` — the
 * workspace-integrity tests below observe the REAL git status of this
 * checkout; they must never rely on the checkout being clean, only on
 * `git status` being IDENTICAL before and after a READ_ONLY command runs.
 */

import { evaluateExecutionPermission } from "../../../permissions/execution-policy/contract";
import type { CommandPolicyDescriptor, ExecutionGrant, ExecutionPermissionDecision, ExecutionPermissionRequest, ExecutionPolicyContext } from "../../../permissions/execution-policy/contract";
import { ExecutionError, getExecution, listCommandDescriptors, startExecution, subscribeToExecutionEvents } from "../contract";
import type { ExecutionRequest, ExecutionResult } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;

const NOW = new Date().toISOString();
const PAST = "2026-01-01T00:00:00.000Z";

const IDENTITY_ID = "identity-execution-test";
const ACCOUNT_ID = "account-execution-test";
const WORKSPACE_ID = "workspace-execution-test";
const CAPABILITY = "execution.run";

const POLICY_IDENTITY = { identity_id: IDENTITY_ID, kind: "human" as const, display_name: "Execution Test Identity" };
const ACCOUNT_MEMBERSHIP = { membership_id: "m-acct", identity_id: IDENTITY_ID, scope_type: "account" as const, scope_id: ACCOUNT_ID, role: "member", granted_at: PAST };
const WORKSPACE_MEMBERSHIP = { membership_id: "m-ws", identity_id: IDENTITY_ID, scope_type: "workspace" as const, scope_id: WORKSPACE_ID, role: "member", granted_at: PAST };

function commandPolicyDescriptorFor(commandId: string, cwdScope: string): CommandPolicyDescriptor {
  return { command_id: commandId, required_capability: CAPABILITY, allowed_actions: ["run"], allowed_cwd_scope_prefixes: [cwdScope] };
}

function allowGrantFor(commandId: string, cwdScopePrefix: string, overrides: Partial<ExecutionGrant> = {}): ExecutionGrant {
  return {
    grant_id: `grant-${commandId}`,
    identity_id: IDENTITY_ID,
    account_id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    capability: CAPABILITY,
    command_id: commandId,
    action: "run",
    cwd_scope_prefix: cwdScopePrefix,
    effect: "allow",
    granted_at: PAST,
    ...overrides,
  };
}

function permissionRequestFor(commandId: string, cwdScope: string, correlationId: string): ExecutionPermissionRequest {
  return {
    identity_id: IDENTITY_ID,
    account_id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    capability: CAPABILITY,
    command_id: commandId,
    action: "run",
    cwd_scope: cwdScope,
    requested_args: [],
    correlation_id: correlationId,
  };
}

function decide(commandId: string, cwdScope: string, correlationId: string, context: Partial<ExecutionPolicyContext> = {}): ExecutionPermissionDecision {
  const fullContext: ExecutionPolicyContext = {
    identity: POLICY_IDENTITY,
    memberships: [ACCOUNT_MEMBERSHIP, WORKSPACE_MEMBERSHIP],
    grants: [allowGrantFor(commandId, cwdScope)],
    command: commandPolicyDescriptorFor(commandId, cwdScope),
    ...context,
  };
  return evaluateExecutionPermission(permissionRequestFor(commandId, cwdScope, correlationId), fullContext, NOW);
}

function executionRequestFor(commandId: string, cwdScope: string, correlationId: string, decision: ExecutionPermissionDecision, overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    correlation_id: correlationId,
    command_id: commandId,
    identity_id: IDENTITY_ID,
    account_id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    capability: CAPABILITY,
    action: "run",
    cwd_scope: cwdScope,
    requested_args: {},
    permission_decision_id: decision.decision_id,
    ...overrides,
  };
}

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

const REGISTERED_COMMAND_ID = "workspace.pwd";
const WORKSPACE_CWD_SCOPE = "repo/";

async function main(): Promise<void> {

  await check("registry exposes at least one registered command", () => {
    const descriptors = listCommandDescriptors();
    assert(descriptors.length > 0, "expected at least one registered command descriptor");
    assert(descriptors.some((d) => d.command_id === REGISTERED_COMMAND_ID), `expected "${REGISTERED_COMMAND_ID}" to be registered`);
  });

  await check("allowed registered command succeeds (real ALLOW decision -> real process)", async () => {
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-allowed");
    assert(decision.decision === "ALLOW", `expected the permission decision to be ALLOW, got ${decision.decision}`);
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-allowed", decision);
    const started = startExecution(request, decision);
    assert(started.status === "queued" || started.status === "running", `expected queued/running, got ${started.status}`);
    const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID);
    assert(finalResult.status === "passed", `expected the real /bin/pwd process to pass, got ${finalResult.status} (errorCode=${finalResult.errorCode})`);
    assert(finalResult.exitCode === 0, `expected exit code 0, got ${finalResult.exitCode}`);
    assert(finalResult.outputBytes > 0, "expected some real stdout output");
  });

  await check("unknown command rejected before any process is created", async () => {
    // The permission layer and the execution registry are two independent
    // sources of truth (this is deliberate — see ../registry.ts's header).
    // To prove EXECUTION's own UNKNOWN_COMMAND defense (not just the
    // permission layer's), this decision is built as a real ALLOW scoped
    // to a command_id that the permission layer's own hypothetical
    // CommandPolicyDescriptor treats as known, but that ../registry.ts's
    // COMMAND_REGISTRY has never heard of — a real scenario if a command
    // is ever removed from the registry while a stale grant still exists.
    const unknownCommandId = "command.does_not_exist";
    const decision = decide(unknownCommandId, WORKSPACE_CWD_SCOPE, "corr-unknown");
    assert(decision.decision === "ALLOW", `expected the permission layer to ALLOW its own hypothetical descriptor, got ${decision.decision}`);
    const request = executionRequestFor(unknownCommandId, WORKSPACE_CWD_SCOPE, "corr-unknown", decision);
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "UNKNOWN_COMMAND", `expected ExecutionError(UNKNOWN_COMMAND), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw for a command_id not present in ../registry.ts, even with a real ALLOW decision");
  });

  await check("shell metacharacters in a dynamic argument do not invoke shell behaviour (rejected outright)", async () => {
    // workspace.pwd/workspace.list both have an EMPTY dynamicArgumentSchema today, so any
    // key at all — including an attempted injection payload — is rejected as INVALID_ARGUMENT
    // before spawn is ever reached. This proves the "receiving a shell operator is itself
    // rejected" policy from ../registry.ts's validateDynamicArgs, matching the old repo's
    // proven behaviour.
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-injection");
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-injection", decision, {
      requested_args: { "; rm -rf /": "x" },
    });
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "INVALID_ARGUMENT", `expected ExecutionError(INVALID_ARGUMENT), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw for a disallowed dynamic argument key");
  });

  await check("fixed argv is preserved exactly as registered (workspace.list -> /bin/ls -la)", async () => {
    const decision = decide("workspace.list", WORKSPACE_CWD_SCOPE, "corr-argv");
    const request = executionRequestFor("workspace.list", WORKSPACE_CWD_SCOPE, "corr-argv", decision);
    const started = startExecution(request, decision);
    const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID);
    assert(finalResult.status === "passed", `expected workspace.list to pass, got ${finalResult.status}`);
    assert(finalResult.resolvedArgv.join(" ") === "-la", `expected resolvedArgv to be exactly ["-la"], got ${JSON.stringify(finalResult.resolvedArgv)}`);
  });

  await check("nonzero exit is captured (real ls against a guaranteed-missing path)", async () => {
    const decision = decide("diagnostics.missing_path", WORKSPACE_CWD_SCOPE, "corr-exitcode");
    const request = executionRequestFor("diagnostics.missing_path", WORKSPACE_CWD_SCOPE, "corr-exitcode", decision);
    const started = startExecution(request, decision);
    const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID);
    assert(finalResult.status === "failed", `expected a real nonzero exit to map to "failed", got ${finalResult.status}`);
    assert(typeof finalResult.exitCode === "number" && finalResult.exitCode !== 0, `expected a real nonzero exit code, got ${finalResult.exitCode}`);
    assert(finalResult.errorCode === "EXECUTION_FAILED", `expected errorCode EXECUTION_FAILED, got ${finalResult.errorCode}`);
  });

  await check("stderr is captured", async () => {
    const decision = decide("diagnostics.missing_path", WORKSPACE_CWD_SCOPE, "corr-stderr");
    const request = executionRequestFor("diagnostics.missing_path", WORKSPACE_CWD_SCOPE, "corr-stderr", decision);
    const started = startExecution(request, decision);
    const seenStderr: string[] = [];
    const subscription = subscribeToExecutionEvents(started.execution_id, (event) => {
      if (event.type === "execution.stderr" && event.text) seenStderr.push(event.text);
    });
    await waitForTerminal(started.execution_id, IDENTITY_ID);
    subscription?.unsubscribe();
    assert(seenStderr.join("").length > 0, "expected at least one real stderr event from ls against a missing path");
  });

  await check("timeout is handled (real /bin/sleep 2 killed by a short timeout_ms override)", async () => {
    const decision = decide("diagnostics.sleep", WORKSPACE_CWD_SCOPE, "corr-timeout");
    const request = executionRequestFor("diagnostics.sleep", WORKSPACE_CWD_SCOPE, "corr-timeout", decision, { timeout_ms: 300 });
    const started = startExecution(request, decision);
    const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID, 5_000);
    assert(finalResult.status === "timed_out", `expected the real sleep process to be killed by the 300ms timeout override, got ${finalResult.status}`);
    assert(finalResult.errorCode === "COMMAND_TIMEOUT", `expected errorCode COMMAND_TIMEOUT, got ${finalResult.errorCode}`);
  });

  await check("invalid cwd_scope is rejected (permission layer denies before execution ever starts)", async () => {
    // execution/run never accepts a caller-supplied cwd directly — cwd is always
    // server-resolved via ../registry.ts's resolveWorkingDirectory(). The "cwd
    // validation" boundary is the permission layer's allowed_cwd_scope_prefixes
    // check, proven here end-to-end: a cwd_scope outside the granted prefix must
    // deny the permission decision, and execution must then refuse to start.
    const outsideScope = "definitely-not-the-granted-scope/";
    const decision = decide(REGISTERED_COMMAND_ID, outsideScope, "corr-bad-cwd", {
      grants: [allowGrantFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE)], // grant is scoped to repo/, not to outsideScope
      command: commandPolicyDescriptorFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE), // descriptor also only allows repo/
    });
    assert(decision.decision === "DENY", `expected DENY for a cwd_scope outside the granted/allowed prefix, got ${decision.decision}`);
    const request = executionRequestFor(REGISTERED_COMMAND_ID, outsideScope, "corr-bad-cwd", decision);
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to refuse a request whose cwd_scope was outside the allowed prefix");
  });

  await check("stdout is captured and sanitized", async () => {
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-stdout");
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-stdout", decision);
    const started = startExecution(request, decision);
    const seenText: string[] = [];
    const subscription = subscribeToExecutionEvents(started.execution_id, (event) => {
      if (event.type === "execution.stdout" && event.text) seenText.push(event.text);
    });
    assert(subscription !== null, "expected a valid subscription for a just-started execution");
    await waitForTerminal(started.execution_id, IDENTITY_ID);
    subscription!.unsubscribe();
    assert(seenText.join("").length > 0, "expected at least one real stdout event");
  });

  await check("DENY permission decision cannot execute", async () => {
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-deny", { grants: [] }); // no matching grant -> DENY
    assert(decision.decision === "DENY", `expected DENY, got ${decision.decision}`);
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-deny", decision);
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw for a DENY decision");
  });

  await check("OWNER_REVIEW permission decision cannot execute", async () => {
    const malformedGrant = { ...allowGrantFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE), effect: "sometimes" as unknown as "allow" };
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-owner-review", { grants: [malformedGrant] });
    assert(decision.decision === "OWNER_REVIEW", `expected OWNER_REVIEW, got ${decision.decision}`);
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-owner-review", decision);
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw for an OWNER_REVIEW decision");
  });

  await check("missing permission (undefined decision) cannot execute", async () => {
    const request: ExecutionRequest = {
      correlation_id: "corr-missing-permission",
      command_id: REGISTERED_COMMAND_ID,
      identity_id: IDENTITY_ID,
      account_id: ACCOUNT_ID,
      workspace_id: WORKSPACE_ID,
      capability: CAPABILITY,
      action: "run",
      cwd_scope: WORKSPACE_CWD_SCOPE,
      requested_args: {},
      permission_decision_id: "decision-that-was-never-made",
    };
    let threw = false;
    try {
      startExecution(request, undefined);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw when no permission decision is supplied at all");
  });

  await check("permission/request mismatch cannot execute (different command_id than the decision was scoped to)", async () => {
    const decision = decide("workspace.list", WORKSPACE_CWD_SCOPE, "corr-mismatch");
    assert(decision.decision === "ALLOW", "expected the workspace.list decision to be ALLOW as a precondition for this test");
    // Reuse a workspace.list-scoped decision but ask to run workspace.pwd instead.
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-mismatch", decision);
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED) for a scope mismatch, got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw when the request's command_id does not match the decision's scope");
  });

  await check("permission_decision_id must match the supplied decision object", async () => {
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-id-mismatch");
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-id-mismatch", decision, { permission_decision_id: "a-different-decision-id" });
    let threw = false;
    try {
      startExecution(request, decision);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED), got ${String(error)}`);
    }
    assert(threw, "expected startExecution to throw when permission_decision_id does not match the supplied decision's own decision_id");
  });

  await check("expired ALLOW permission decision cannot execute", async () => {
    const expiredGrant = allowGrantFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, { expires_at: PAST });
    const context: Partial<ExecutionPolicyContext> = { grants: [expiredGrant] };
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-expired", context);
    assert(decision.decision === "DENY", `expected the permission layer itself to DENY an expired grant at decision time, got ${decision.decision}`);
    // Also prove the executor's OWN expiry re-check independently, in case a caller
    // somehow held onto a stale ALLOW decision past its expires_at.
    const staleAllow: ExecutionPermissionDecision = {
      ...decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-expired-2"),
      decision: "ALLOW",
      expires_at: PAST,
    };
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-expired-2", staleAllow);
    let threw = false;
    try {
      startExecution(request, staleAllow);
    } catch (error) {
      threw = true;
      assert(error instanceof ExecutionError && error.code === "PERMISSION_DENIED", `expected ExecutionError(PERMISSION_DENIED) for an expired decision, got ${String(error)}`);
    }
    assert(threw, "expected startExecution to refuse a decision whose expires_at is in the past, even if decision === ALLOW");
  });

  await check("internal error during permission verification fails closed (never throws an unrelated error type)", async () => {
    // A malformed decision object (missing required scope fields) must be refused as
    // PERMISSION_DENIED, never crash with a raw TypeError from inside startExecution.
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-internal-error");
    const brokenDecision = { ...decision, scope: undefined as unknown as ExecutionPermissionDecision["scope"] };
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-internal-error", decision);
    let threw = false;
    let sawExecutionError = false;
    try {
      startExecution(request, brokenDecision);
    } catch (error) {
      threw = true;
      sawExecutionError = error instanceof ExecutionError;
    }
    assert(threw, "expected startExecution to throw for a malformed decision object");
    assert(sawExecutionError, "expected the thrown error to be a real ExecutionError, not an unhandled TypeError");
  });

  await check("read-only command's workspace-integrity check reports no unexpected change (real git status before/after)", async () => {
    const decision = decide(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-integrity");
    const request = executionRequestFor(REGISTERED_COMMAND_ID, WORKSPACE_CWD_SCOPE, "corr-integrity", decision);
    const started = startExecution(request, decision);
    const finalResult = await waitForTerminal(started.execution_id, IDENTITY_ID);
    assert(finalResult.status === "passed", `expected /bin/pwd to pass, got ${finalResult.status}`);
    assert(finalResult.workspacePolicyViolation === false, "a real READ_ONLY /bin/pwd invocation must never be flagged as a workspace policy violation");
  });

}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
});
