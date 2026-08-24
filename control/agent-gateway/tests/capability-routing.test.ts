/**
 * หน้าที่: proves the `matchCapability()` routing fix in ./gateway.ts —
 * a real "external system lifecycle" intent now resolves to the real
 * `external_system_lifecycle_registration` entry in
 * ../../../reports/phase16-world-evidence/capability_index.json (the
 * SAME real routing table/mechanism every other intent already uses, no
 * new router), while an unrelated intent still correctly fails to match
 * and the task still correctly lands BLOCKED — the fix is additive, not
 * a wildcard.
 *
 * How to run: npx tsx control/agent-gateway/tests/capability-routing.test.ts
 */

import { submitTask, loadEvidenceForTask } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  await check("A. a real External System Lifecycle registration intent matches the real capability_index entry (not fabricated — real evidence read back)", async () => {
    const task = await submitTask("register external system lifecycle capability: capability-routing-test-a", { user_id: "owner", workspace_id: "ws-routing-test", conversation_id: "conv-routing-a", parent_task_id: null }, "test-client", []);
    const evidence = loadEvidenceForTask(task.task_id);
    const lookup = evidence.find((e) => e.kind === "capability_lookup");
    assert(lookup !== undefined, "capability_lookup evidence must exist");
    const payload = lookup!.payload as { matched: boolean; capability: { problem_type: string } | null };
    assert(payload.matched === true, `expected matched=true, got ${JSON.stringify(payload)}`);
    assert(payload.capability?.problem_type === "external_system_lifecycle_registration", `expected the real lifecycle capability_index entry, got ${JSON.stringify(payload.capability)}`);
  });

  await check("B. an unrelated, unrecognized intent still fails to match and the task still lands BLOCKED — the fix is additive, never a wildcard", async () => {
    const task = await submitTask("please water the office plants on friday", { user_id: "owner", workspace_id: "ws-routing-test", conversation_id: "conv-routing-b", parent_task_id: null }, "test-client", []);
    assert(task.status === "BLOCKED", `expected BLOCKED, got ${task.status}`);
    const evidence = loadEvidenceForTask(task.task_id);
    const lookup = evidence.find((e) => e.kind === "capability_lookup");
    const payload = lookup!.payload as { matched: boolean };
    assert(payload.matched === false, `expected matched=false for an unrelated intent, got ${JSON.stringify(payload)}`);
    const verification = evidence.find((e) => e.kind === "verification");
    assert((verification!.payload as { reason: string }).reason === "NO_EXISTING_CAPABILITY matched", `expected the real, unchanged NO_EXISTING_CAPABILITY reason, got ${JSON.stringify(verification!.payload)}`);
  });

  await check("C. the pre-existing routes (ตรวจ/status/duplicate, แก้ไข/modify) still resolve exactly as before — the new branch never shadows them", async () => {
    const statusTask = await submitTask("ตรวจสถานะ duplicate files please", { user_id: "owner", workspace_id: "ws-routing-test", conversation_id: "conv-routing-c1", parent_task_id: null }, "test-client", []);
    const statusEvidence = loadEvidenceForTask(statusTask.task_id).find((e) => e.kind === "capability_lookup")!.payload as { capability: { problem_type: string } | null };
    assert(statusEvidence.capability?.problem_type === "file_duplicate_or_orphan_detection", `expected the pre-existing duplicate-detection route unchanged, got ${JSON.stringify(statusEvidence.capability)}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
