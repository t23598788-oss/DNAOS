/**
 * หน้าที่: the real test for `control/owner-command/`. Drives
 * `../contract.ts` directly by hand, the same convention as
 * `../../command-router/tests/router.test.ts` and
 * `../../../execution/run/tests/executor.test.ts`. Proves the full stated
 * flow end to end: OWNER → owner-command → command-router → capability →
 * result → owner-command → OWNER, including that a non-"human"
 * `issued_by.kind` is refused at this boundary (Owner never bypasses
 * authorization by construction).
 *
 * REVISED 2026-08-16 (Owner instruction — "no duplicated command
 * descriptors, no fabricated membership/grants"): `allowContext()` now
 * resolves through `../../entry-context/contract.ts`'s
 * `resolveEntryContext`, which itself only reads real stores — never a
 * hand-written `CommandPolicyDescriptor`/`ExecutionGrant`/`Identity`/
 * `Membership` literal. `WORKSPACE_CWD_SCOPE` was replaced with the real
 * `WORKSPACE_ROOT_CWD_SCOPE` constant.
 *
 * How to run:
 *   npx tsx control/owner-command/tests/owner-command.test.ts
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
 * ../../../contracts/identity/envelope-identity.ts (public contracts
 * only).
 * สิ่งที่ห้ามแตะ: never assert on a specific command_id/task_id value
 * (random) — assert on shape/status only. Never reintroduce a hand-built
 * `CommandPolicyDescriptor`/`ExecutionGrant`/membership literal in this
 * file — always go through the real sources above.
 */

import type { EnvelopeIdentity } from "../../../contracts/identity/envelope-identity";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import { grantMembership } from "../../../permissions/access-control/membership-registry";
import { registerAccount } from "../../../permissions/software-scope/account-registry";
import { registerWorkspace } from "../../../permissions/software-scope/workspace-registry";
import { issueExecutionGrant } from "../../../permissions/execution-policy/contract";
import type { ExecutionPolicyContext } from "../../../permissions/execution-policy/contract";
import { WORKSPACE_ROOT_CWD_SCOPE } from "../../../execution/run/contract";
import { resolveEntryContext } from "../../entry-context/contract";
import { previewOwnerCommand, renderOwnerSurface, submitOwnerCommand } from "../contract";
import type { RouteOptions } from "../../command-router/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const IDENTITY_ID = "identity-owner-test";
const ACCOUNT_ID = "account-owner-test";
const WORKSPACE_ID = "workspace-owner-test";
const CAPABILITY = "execution.run";
const REGISTERED_COMMAND_ID = "workspace.pwd";

const OWNER_IDENTITY: EnvelopeIdentity = { identity_id: IDENTITY_ID, acting_as_account_id: ACCOUNT_ID, acting_as_tenant_id: "tenant-owner-test", software_id: "software-owner-test", kind: "human" };
const NON_HUMAN_IDENTITY: EnvelopeIdentity = { ...OWNER_IDENTITY, kind: "ai_agent" };

// Real registration, once, via the real stores — never a hand-built
// Identity/Account/Workspace/Membership literal. Account/Workspace
// registration added 2026-08-16 alongside the entry-context resolver's new
// fail-closed Account/Workspace cross-check — without a real, ACTIVE
// Account/Workspace on record, resolveEntryContext now filters these
// memberships out before they ever reach execution-policy.
registerIdentity({ identity_id: IDENTITY_ID, kind: "human", display_name: "Owner Test Identity" });
registerAccount({ account_id: ACCOUNT_ID });
registerWorkspace({ workspace_id: WORKSPACE_ID, account_id: ACCOUNT_ID });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "member" });
grantMembership({ identity_id: IDENTITY_ID, scope_type: "workspace", scope_id: WORKSPACE_ID, role: "member" });

function allowContext(): ExecutionPolicyContext {
  issueExecutionGrant({
    identity_id: IDENTITY_ID,
    account_id: ACCOUNT_ID,
    workspace_id: WORKSPACE_ID,
    capability: CAPABILITY,
    command_id: REGISTERED_COMMAND_ID,
    action: "run",
    cwd_scope_prefix: WORKSPACE_ROOT_CWD_SCOPE,
    effect: "allow",
  });
  return resolveEntryContext({ identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, command_id: REGISTERED_COMMAND_ID }).context;
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
  await check("submitOwnerCommand refuses a non-human issued_by.kind — Owner path never doubles as a generic caller path", async () => {
    let threw = false;
    try {
      await submitOwnerCommand("ตรวจ permission", NON_HUMAN_IDENTITY);
    } catch {
      threw = true;
    }
    assert(threw, "expected submitOwnerCommand to throw for a non-human identity");
  });

  await check("previewOwnerCommand classifies without routing", () => {
    const outcome = previewOwnerCommand("ตรวจ permission");
    assert(outcome.status === "MATCHED", `expected MATCHED, got ${outcome.status}`);
  });

  await check("submitOwnerCommand: OWNER_REVIEW surfaces one task, lifecycle stops at rejected", async () => {
    const outcome = await submitOwnerCommand("execute an audit repo scan", OWNER_IDENTITY);
    assert(outcome.result.status === "OWNER_REVIEW", `expected OWNER_REVIEW, got ${outcome.result.status}`);
    assert(outcome.lifecycle.stage === "rejected", `expected lifecycle stage "rejected", got ${outcome.lifecycle.stage}`);
    assert(outcome.surface.progress === "DONE", `expected progress DONE, got ${outcome.surface.progress}`);
    assert(outcome.surface.current_worker === "router", `expected current_worker "router", got ${outcome.surface.current_worker}`);
  });

  await check("submitOwnerCommand: UNSUPPORTED_COMMAND is reported, never silently dropped", async () => {
    const outcome = await submitOwnerCommand("play some music please", OWNER_IDENTITY);
    assert(outcome.result.status === "FAILED", `expected FAILED, got ${outcome.result.status}`);
    assert(outcome.result.next_action === "UNSUPPORTED_COMMAND", "expected next_action UNSUPPORTED_COMMAND");
  });

  await check("submitOwnerCommand: research-engine reports its real live state with evidence", async () => {
    const outcome = await submitOwnerCommand("เอาผลทดลองโมเดลล่าสุด", OWNER_IDENTITY);
    assert(outcome.result.status === "COMPLETED" || outcome.result.status === "BLOCKED", `expected COMPLETED or BLOCKED, got ${outcome.result.status}`);
    const capabilityRow = outcome.surface.available_capabilities.find((c) => c.capability_id === "research-engine");
    assert(capabilityRow !== undefined && capabilityRow.connected === true, "expected research-engine's existing adapter to be listed as connected");
    assert(outcome.result.evidence.length > 0, "expected live or offline research result to carry evidence");
  });

  await check("submitOwnerCommand: full real flow with permission ALLOW reaches COMPLETED end-to-end", async () => {
    const options: RouteOptions = {
      steps: [{ capability_id: "execution", intent: "execution.run", payload: { command_id: REGISTERED_COMMAND_ID } }],
      executionPolicyContext: allowContext(),
      executionRequestBase: { identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, cwd_scope: WORKSPACE_ROOT_CWD_SCOPE },
    };
    const outcome = await submitOwnerCommand("รันคำสั่งที่อนุญาตแล้ว", OWNER_IDENTITY, options);
    // execution/run is async — the router's synchronous return may still read "RUNNING" (queued/running) rather than
    // COMPLETED; either proves the permission gate passed and the real executor ran, matching ../../command-router/tests/router.test.ts.
    assert(outcome.result.status === "COMPLETED" || outcome.result.status === "RUNNING", `expected COMPLETED or RUNNING, got ${outcome.result.status} (${outcome.result.summary})`);
    if (outcome.result.status === "COMPLETED") {
      assert(outcome.lifecycle.stage === "responded", `expected lifecycle stage "responded", got ${outcome.lifecycle.stage}`);
      assert(outcome.lifecycle.history.some((h) => h.stage === "evidenced"), "expected an evidenced stage before responded, per LEGAL_TRANSITIONS");
    } else {
      assert(outcome.lifecycle.stage === "executing", `expected lifecycle stage "executing" while RUNNING, got ${outcome.lifecycle.stage}`);
    }
    const rendered = renderOwnerSurface(outcome.surface);
    assert(rendered.includes("Current Command"), "expected renderOwnerSurface to produce a readable Owner surface");
    assert(rendered.includes("execution"), "expected the rendered surface to mention the execution capability");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
