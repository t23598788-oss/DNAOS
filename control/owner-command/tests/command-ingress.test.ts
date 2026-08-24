/**
 * หน้าที่: real, in-process evidence for ../command-ingress.ts — the
 * Owner's named provider-neutral test (2026-08-20): source=api,
 * intent=check_runtime_status, requested_outcome=return_verified_runtime_status,
 * proving a real command_id/decision_id/work_order flow into the
 * UNCHANGED existing Input Gateway/canonical pipe, plus rejection paths
 * (invalid source, unsupported intent) that never reach it.
 *
 * How to run:
 *   npx tsx control/owner-command/tests/command-ingress.test.ts
 */
import { ingestExternalCommand, type ExternalCommand } from "../command-ingress";
import { registerIdentity } from "../../../permissions/access-control/identity-registry";
import { registerAccount } from "../../../permissions/software-scope/account-registry";
import { registerWorkspace } from "../../../permissions/software-scope/workspace-registry";
import { grantMembership } from "../../../permissions/access-control/membership-registry";
import { issueExecutionGrant } from "../../../permissions/execution-policy/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const IDENTITY_ID = "identity-command-ingress-test";
const ACCOUNT_ID = "account-command-ingress-test";
const WORKSPACE_ID = "workspace-command-ingress-test";

function registerTestIdentity(): void {
  registerIdentity({ identity_id: IDENTITY_ID, kind: "service", display_name: "Command Ingress Test" });
  registerAccount({ account_id: ACCOUNT_ID });
  registerWorkspace({ workspace_id: WORKSPACE_ID, account_id: ACCOUNT_ID });
  grantMembership({ identity_id: IDENTITY_ID, scope_type: "account", scope_id: ACCOUNT_ID, role: "member" });
  issueExecutionGrant({ identity_id: IDENTITY_ID, account_id: ACCOUNT_ID, workspace_id: WORKSPACE_ID, capability: "execution.run", command_id: "unknown", action: "run", cwd_scope_prefix: "repo/", effect: "allow" });
}

const IDENTITY = { identity_id: IDENTITY_ID, acting_as_account_id: ACCOUNT_ID, acting_as_tenant_id: "tenant-command-ingress-test", software_id: "dna-os-infrastructure", kind: "service" as const };

async function main(): Promise<void> {
  registerTestIdentity();

  // THE Owner-named provider-neutral test: source=api, intent=check_runtime_status, requested_outcome=return_verified_runtime_status
  await check("provider-neutral input (source=api, intent=check_runtime_status) flows into the existing canonical pipe with real command_id/decision_id/work_order", async () => {
    const command: ExternalCommand = {
      command_id: `cmd-ingress-${Date.now()}`,
      source: "api",
      intent: "check_runtime_status",
      context: { probe: "command-ingress-test" },
      requested_outcome: "return_verified_runtime_status",
      timestamp: new Date().toISOString(),
    };
    const outcome = await ingestExternalCommand(command, IDENTITY, "test-client");
    assert(outcome.status === "admitted", `expected admitted, got ${JSON.stringify(outcome)}`);
    assert(outcome.command_id === command.command_id, "expected the same command_id to be echoed back");
    assert(outcome.task_id !== null && outcome.task_id.length > 0, "expected a real task_id from the existing Controller");
    assert(outcome.decision_id !== null && outcome.decision_id.length > 0, "expected a real decision_id (handoff_id) from DNA OS's own Decision Engine confirmation");
    assert(outcome.work_order !== null && outcome.work_order.workspace_scope === "tests/__sandbox__/", "expected a real, sandboxed WorkOrder");
    console.log(`      command_id=${outcome.command_id} task_id=${outcome.task_id} decision_id=${outcome.decision_id} status=${outcome.reason}`);
  });

  await check("invalid source enum value is REJECTED at Ingress, never reaches the Input Gateway", async () => {
    const command = { command_id: `cmd-bad-source-${Date.now()}`, source: "totally_made_up", intent: "check_runtime_status", context: {}, requested_outcome: "return_verified_runtime_status", timestamp: new Date().toISOString() } as unknown as ExternalCommand;
    const outcome = await ingestExternalCommand(command, IDENTITY, "test-client");
    assert(outcome.status === "rejected" && outcome.reason.includes("SCHEMA_INVALID") && outcome.task_id === null, `expected schema-invalid rejection with no task_id, got ${JSON.stringify(outcome)}`);
  });

  await check("unsupported intent is REJECTED at Ingress (no WorkOrder fabricated), never reaches the Input Gateway", async () => {
    const command: ExternalCommand = { command_id: `cmd-bad-intent-${Date.now()}`, source: "api", intent: "delete_everything", context: {}, requested_outcome: "return_verified_runtime_status", timestamp: new Date().toISOString() };
    const outcome = await ingestExternalCommand(command, IDENTITY, "test-client");
    assert(outcome.status === "rejected" && outcome.reason.includes("UNSUPPORTED_INTENT") && outcome.work_order === null, `expected UNSUPPORTED_INTENT rejection with no work_order, got ${JSON.stringify(outcome)}`);
  });

  await check("all 5 required source enum values are accepted by validation (local_ai, external_ai, owner_ui, api, system)", async () => {
    const sources = ["local_ai", "external_ai", "owner_ui", "api", "system"] as const;
    for (const source of sources) {
      const command: ExternalCommand = { command_id: `cmd-source-${source}-${Date.now()}`, source, intent: "check_runtime_status", context: {}, requested_outcome: "return_verified_runtime_status", timestamp: new Date().toISOString() };
      const outcome = await ingestExternalCommand(command, IDENTITY, "test-client");
      assert(outcome.status === "admitted", `expected source="${source}" to be a valid enum value and reach admission, got ${JSON.stringify(outcome)}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main();
