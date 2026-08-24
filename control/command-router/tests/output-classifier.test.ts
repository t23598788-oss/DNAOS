/**
 * หน้าที่: proves the Output Contract split — every CapabilityResult
 * lands in exactly one of SYSTEM_STATE or WORK_ITEM, and the real Task
 * admitCompletedTask()/submitTask() persisted agrees with classifyOutput's
 * own determination for the SAME command. Runs against the real
 * routeOwnerCommand + real agent-gateway task store — no capability call
 * is mocked.
 *
 * How to run: npx tsx control/command-router/tests/output-classifier.test.ts
 */

import { classifyOutput } from "../output-classifier";
import { routeOwnerCommand } from "../router";
import { getTask } from "../../agent-gateway/contract";
import type { CommandEnvelope } from "../../../contracts/command/command-envelope";
import type { CapabilityResult } from "../../../contracts/command/capability-result";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function baseEnvelope(intent: string, commandId: string): CommandEnvelope {
  return {
    command_id: commandId,
    issued_by: { identity_id: "identity-output-contract-test", acting_as_account_id: "account-output-contract-test", acting_as_tenant_id: "tenant-output-contract-test", software_id: "dna-os-infrastructure", kind: "human" },
    intent,
    payload: {},
    issued_at: new Date().toISOString(),
  };
}

async function run(): Promise<void> {
  console.log("=== control/command-router/tests/output-classifier.test.ts ===");

  // 1. A synchronous, non-dispatcher capability (os-login) -> SYSTEM_STATE,
  // both from classifyOutput on the fresh result and from the real persisted Task.
  {
    const envelope = baseEnvelope("ตรวจสถานะ firewall", "cmd-output-contract-system-state");
    const result: CapabilityResult = await routeOwnerCommand(envelope, "ตรวจสถานะ firewall");
    const output = classifyOutput(result);
    assert(output.lane === "SYSTEM_STATE", `expected SYSTEM_STATE for a non-dispatcher capability, got ${output.lane}`);
    assert(output.capability_id === "os-login", `expected capability_id os-login, got ${output.capability_id}`);
    assert(!("dispatcher_task_id" in output), "SYSTEM_STATE output must never carry a dispatcher_task_id field");

    const task = getTask(result.task_id);
    assert(task !== undefined, `expected the real task ${result.task_id} to exist in the canonical task store`);
    assert(task!.output_lane === "SYSTEM_STATE", `expected the persisted Task's own output_lane to be SYSTEM_STATE, got ${task!.output_lane}`);
    console.log(`PASS: os-login command -> SYSTEM_STATE lane, agrees with the persisted Task (task_id=${result.task_id})`);
  }

  // 2. A dispatcher-routed step -> WORK_ITEM, with a real dispatcher_task_id
  // that is itself a DIFFERENT, separately real, findable Task. Uses a
  // unique command_id every run — control/work-coordination/coordination.ts
  // persists real, non-test-isolated state under local-runtime/coordination/
  // keyed by command_id, so a fixed literal here would collide with a
  // locked/stale entry from a previous run of this same test.
  {
    const envelope = baseEnvelope("dispatch a work item", `cmd-output-contract-work-item-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const result: CapabilityResult = await routeOwnerCommand(envelope, "dispatch a work item", {
      steps: [{ capability_id: "dispatcher", intent: "output-contract-test-intent", payload: {} }],
    });
    const output = classifyOutput(result);
    assert(output.lane === "WORK_ITEM", `expected WORK_ITEM for a dispatcher-routed step, got ${output.lane}`);
    assert(output.capability_id === "dispatcher", `expected capability_id dispatcher, got ${output.capability_id}`);
    assert("dispatcher_task_id" in output && typeof (output as { dispatcher_task_id: unknown }).dispatcher_task_id === "string", "expected a real dispatcher_task_id on a WORK_ITEM output");

    const outerTask = getTask(result.task_id);
    assert(outerTask !== undefined, `expected the real outer task ${result.task_id} to exist`);
    assert(outerTask!.output_lane === "WORK_ITEM", `expected the outer router-level Task's own output_lane to be WORK_ITEM (agrees with classifyOutput), got ${outerTask!.output_lane}`);

    const dispatcherTaskId = (output as { dispatcher_task_id: string }).dispatcher_task_id;
    assert(dispatcherTaskId !== result.task_id, "the inner dispatcher task_id must be a genuinely different real task from the outer router-level task_id");
    const innerTask = getTask(dispatcherTaskId);
    assert(innerTask !== undefined, `expected the real inner dispatcher task ${dispatcherTaskId} to also exist`);
    assert(innerTask!.output_lane === "WORK_ITEM", `expected the inner dispatcher Task's own output_lane to be WORK_ITEM, got ${innerTask!.output_lane}`);
    console.log(`PASS: dispatcher command -> WORK_ITEM lane, both the outer task (${result.task_id}) and the real inner dispatcher task (${dispatcherTaskId}) agree and are independently findable`);
  }

  console.log("=== ALL output-classifier.test.ts CASES PASSED ===");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
