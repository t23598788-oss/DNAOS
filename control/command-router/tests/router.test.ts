/**
 * หน้าที่: the real test for `control/command-router/`. Drives
 * `../contract.ts` directly by hand, the same way
 * `../../../execution/run/tests/executor.test.ts` and
 * `../../../permissions/execution-policy/tests/policy.test.ts` drive
 * theirs — `../../owner-command/` calls this same contract, so this
 * proves the router composes with real `permissions/execution-policy/`,
 * real `execution/run/`, and the real `connections/github/` adapter
 * entry point, not hand-faked stand-ins.
 *
 * REVISED 2026-08-16 (Owner instruction — "no duplicated command
 * descriptors, no fabricated membership/grants"): every
 * `CommandPolicyDescriptor`/`ExecutionGrant`/`Identity`/`Membership` used
 * below is now obtained from the real authoritative sources
 * (`../../entry-context/contract.ts`'s `resolveEntryContext`, which
 * itself only reads `execution/run/contract.ts`'s
 * `projectCommandPolicyDescriptor`, `permissions/execution-policy/
 * contract.ts`'s `issueExecutionGrant`/`listExecutionGrantsForIdentity`,
 * and `permissions/access-control/`'s real identity/membership
 * registries) — never a hand-written literal. `WORKSPACE_CWD_SCOPE` was
 * also replaced with the real `WORKSPACE_ROOT_CWD_SCOPE` constant, which
 * this file's own previous "repo/" placeholder had silently diverged
 * from.
 *
 * No network call is made: the one github-routed case in this file uses
 * a connection with `credential_ref.kind: "not_yet_built"`, which
 * `connections/github/credential-resolution.ts` deterministically rejects
 * before any fetch — proving the router really reached the adapter
 * without depending on a live token in this environment.
 *
 * How to run (no test framework/package.json in this repo; plain program
 * with its own assertions, matching ../../../execution/run/tests/'s
 * convention):
 *   npx tsx control/command-router/tests/router.test.ts
 *
 * Input: none (all fixtures constructed in this file, but only via real
 * source functions — never a hand-built literal).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../contract.ts, ../../entry-context/contract.ts,
 * ../../../permissions/access-control/identity-registry.ts,
 * ../../../permissions/access-control/membership-registry.ts,
 * ../../../permissions/software-scope/account-registry.ts,
 * ../../../permissions/software-scope/workspace-registry.ts,
 * ../../../permissions/execution-policy/contract.ts,
 * ../../../execution/run/contract.ts,
 * ../../../contracts/command/command-envelope.ts (public contracts only).
 * สิ่งที่ห้ามแตะ: never assert on a specific task_id/command_id/decision_id
 * value (all random) — assert on status/shape only. Never reintroduce a
 * hand-built `CommandPolicyDescriptor`/`ExecutionGrant`/membership literal
 * in this file — always go through the real sources above.
 */

import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import { grantMembership } from "../../../permissions/access-control/membership-registry";
import { registerAccount } from "../../../permissions/software-scope/account-registry";
import { registerWorkspace } from "../../../permissions/software-scope/workspace-registry";
import { issueExecutionGrant } from "../../../permissions/execution-policy/contract";
import type { ExecutionPolicyContext } from "../../../permissions/execution-policy/contract";
import { getExecution, WORKSPACE_ROOT_CWD_SCOPE } from "../../../execution/run/contract";
import { resolveEntryContext } from "../../entry-context/contract";
import { classifyCommand, routeOwnerCommand } from "../contract";
import type { RouteOptions } from "../contract";
import { randomUUID } from "node:crypto";

declare const setTimeout: (fn: () => void, ms: number) => unknown;

function waitForTerminal(executionId: string, identityId: string, timeoutMs = 10_000): Promise<ReturnType<typeof getExecution>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const current = getExecution(executionId, identityId);
      if (current.status !== "queued" && current.status !== "running") {
        resolve(current);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("timed out waiting for execution to reach a terminal state"));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const IDENTITY_ID = "identity-router-test";
const ACCOUNT_ID = "account-router-test";
const WORKSPACE_ID = "workspace-router-test";
const CAPABILITY = "execution.run";
const REGISTERED_COMMAND_ID = "workspace.pwd";

// Real registration, once, via the real stores — never a hand-built
// Identity/Account/Workspace/Membership literal. resolveEntryContext
// (below) reads these same real registrations back. Account/Workspace
// registration added 2026-08-16 alongside the entry-context resolver's new
// fail-closed Account/Workspace cross-check — without a real, ACTIVE
// Account/Workspace on record, resolveEntryContext now filters these
// memberships out before they ever reach execution-policy.
registerIdentity({ identity_id: IDENTITY_ID, kind: "human", display_name: "Router Test Identity" });
registerAccount({ account_id: ACCOUNT_ID });
registerWorkspace({ workspace_id: WORKSPACE_ID, account_id: ACCOUNT_ID });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "member" });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "member" });

/** DENY case: resolves the real context WITHOUT issuing a grant first — real NO_MATCHING_GRANT, never a hand-built `grants: []` literal. */
function denyContextFor(commandId: string): ExecutionPolicyContext {
  return resolveEntryContext({ identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, command_id: commandId }).context;
}

/** ALLOW case: issues a real grant through `issueExecutionGrant()` first, then resolves the real context — the grant is real store state, not a fixture object. */
function allowContextFor(commandId: string): ExecutionPolicyContext {
  issueExecutionGrant({
    identity_id: IDENTITY_ID,
    account_id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    capability: CAPABILITY,
    command_id: commandId,
    action: "run",
    cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE,
    effect: "allow",
  });
  return resolveEntryContext({ identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, command_id: commandId }).context;
}

const executionRequestBase = { identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, cwd_scope: WORKSPACE_ROOT_CWD_SCOPE };

function baseEnvelope(intent: string, payload: unknown = {}): CommandEnvelope {
  return {
    command_id: `cmd_${randomUUID()}`,
    issued_by: { identity_id: IDENTITY_ID, acting_as_account_id: ACCOUNT_ID, acting_as_tenant_id: "tenant-router-test", software_id: "software-router-test", kind: "human" },
    intent,
    payload,
    issued_at: new Date().toISOString(),
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

async function main(): Promise<void> {
  await check("classifyCommand: single match routes to exactly one capability", () => {
    const outcome = classifyCommand("อ่าน GitHub repo");
    assert(outcome.status === "MATCHED", `expected MATCHED, got ${outcome.status}`);
    if (outcome.status === "MATCHED") assert(outcome.capability.capability_id === "github", `expected github, got ${outcome.capability.capability_id}`);
  });

  await check("classifyCommand: ambiguous text -> OWNER_REVIEW, never guesses", () => {
    // Deliberately crosses two registered keyword sets (execution's "execute" and file-intelligence's "audit repo").
    const outcome = classifyCommand("execute an audit repo scan");
    assert(outcome.status === "OWNER_REVIEW", `expected OWNER_REVIEW, got ${outcome.status}`);
    if (outcome.status === "OWNER_REVIEW") assert(outcome.candidates.length >= 2, "expected 2+ candidates");
  });

  await check("classifyCommand: no match -> UNSUPPORTED_COMMAND", () => {
    const outcome = classifyCommand("play some music please");
    assert(outcome.status === "UNSUPPORTED_COMMAND", `expected UNSUPPORTED_COMMAND, got ${outcome.status}`);
  });

  await check("routeOwnerCommand: OWNER_REVIEW result on ambiguous command, capability never invoked", async () => {
    const envelope = baseEnvelope("execute an audit repo scan");
    const result = await routeOwnerCommand(envelope, "execute an audit repo scan");
    assert(result.status === "OWNER_REVIEW", `expected OWNER_REVIEW, got ${result.status}`);
    assert(result.capability_id === "router", `expected capability_id "router", got ${result.capability_id}`);
  });

  await check("routeOwnerCommand: UNSUPPORTED_COMMAND maps to FAILED with next_action UNSUPPORTED_COMMAND", async () => {
    const envelope = baseEnvelope("play some music please");
    const result = await routeOwnerCommand(envelope, "play some music please");
    assert(result.status === "FAILED", `expected FAILED, got ${result.status}`);
    assert(result.next_action === "UNSUPPORTED_COMMAND", `expected next_action UNSUPPORTED_COMMAND, got ${result.next_action}`);
  });

  await check("routeOwnerCommand: NOT_CONNECTED capability (file-intelligence) is BLOCKED, never faked", async () => {
    const envelope = baseEnvelope("ตรวจ 7 repo");
    const result = await routeOwnerCommand(envelope, "ตรวจ 7 repo");
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(result.capability_id === "file-intelligence", `expected file-intelligence, got ${result.capability_id}`);
    assert(result.warnings.some((w) => w.includes("not connected")), "expected a not-connected warning");
  });

  await check("routeOwnerCommand: github step reaches the real adapter (deterministic credential rejection, no network)", async () => {
    const connection = { connection_id: "conn-router-test", account_id: ACCOUNT_ID, software_id: "software-router-test", adapter: "github", credential_ref: { kind: "not_yet_built" as const }, status: "connected" as const };
    const payload = { connection, target: { owner: "octocat", repo: "hello-world" } };
    const envelope = baseEnvelope("connector.github.check_access", payload);
    const options: RouteOptions = { steps: [{ capability_id: "github", intent: "connector.github.check_access", payload }] };
    const result = await routeOwnerCommand(envelope, "n/a", options);
    assert(result.status === "FAILED", `expected FAILED (no real credential in this environment), got ${result.status}`);
    assert(result.capability_id === "github", `expected github, got ${result.capability_id}`);
    assert(result.evidence.some((e) => e.source === "github"), "expected github evidence entry — proves the real adapter ran");
  });

  await check("permission boundary: execution step is BLOCKED (never spawned) when execution-policy denies", async () => {
    const envelope = baseEnvelope("execute", { command_id: REGISTERED_COMMAND_ID });
    const options: RouteOptions = {
      steps: [{ capability_id: "execution", intent: "execution.run", payload: { command_id: REGISTERED_COMMAND_ID } }],
      executionPolicyContext: denyContextFor(REGISTERED_COMMAND_ID),
      executionRequestBase,
    };
    const result = await routeOwnerCommand(envelope, "n/a", options);
    assert(result.status === "BLOCKED", `expected BLOCKED, got ${result.status}`);
    assert(
      result.evidence.some((e) => e.source === "permission-reasoner"),
      "expected a permission-reasoner evidence entry, proving the router consulted the permission boundary before execution"
    );
    assert(
      !result.evidence.some((e) => e.source === "execution"),
      "execution must never be invoked when the permission decision was not ALLOW"
    );
  });

  await check("permission boundary + multi-worker: permission-reasoner then execution, ALLOW lets execution run, ONE combined result", async () => {
    const envelope = baseEnvelope("run allowed command", { command_id: REGISTERED_COMMAND_ID });
    const options: RouteOptions = {
      steps: [
        { capability_id: "permission-reasoner", intent: "permission-reasoner.evaluate", payload: { command_id: REGISTERED_COMMAND_ID } },
        { capability_id: "execution", intent: "execution.run", payload: { command_id: REGISTERED_COMMAND_ID } },
      ],
      executionPolicyContext: allowContextFor(REGISTERED_COMMAND_ID),
      executionRequestBase,
    };
    const result = await routeOwnerCommand(envelope, "n/a", options);
    // The router returns whatever startExecution's synchronous return already reflects (queued/running included) — it
    // never blocks waiting for a spawned process, matching execution/run's own async model. RUNNING here still proves
    // the permission gate passed and execution/run was really invoked; poll to terminal below to prove it truly ran.
    assert(result.status === "COMPLETED" || result.status === "RUNNING", `expected COMPLETED or RUNNING, got ${result.status} (${result.summary})`);
    assert(result.capability_id === "execution", `expected the LAST step's capability_id "execution", got ${result.capability_id}`);
    assert(result.summary.startsWith("2-step command"), `expected a combined multi-step summary, got: ${result.summary}`);
    assert(result.evidence.some((e) => e.source === "permission-reasoner"), "expected permission-reasoner evidence from step 1");
    assert(result.evidence.some((e) => e.source === "execution"), "expected execution evidence from step 2");
    const executionArtifact = result.artifacts.find((a) => a.kind === "execution_id");
    assert(executionArtifact !== undefined, "expected an execution_id artifact");
    if (executionArtifact) {
      const terminal = await waitForTerminal(executionArtifact.ref, IDENTITY_ID);
      assert(terminal.status === "passed", `expected the real spawned process to reach "passed", got "${terminal.status}"`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
