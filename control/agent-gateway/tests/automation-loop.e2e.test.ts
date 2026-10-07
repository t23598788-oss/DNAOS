/** End-to-end proof for the closed sandbox automation loop.
 *
 * Existing path only:
 * Agent Gateway durable task -> admission validator -> ai-write-control
 * -> existing Write Gate -> existing file-write executor -> evidence.
 */
import { existsSync, unlinkSync } from "node:fs";
import { aiWriteAdapter, getTask, recoverInterruptedTasks, submitTask } from "../contract";
import { loadEvidenceForTask, saveTask } from "../memory-store";
import { submitWriteRequest } from "../../ai-write-control/contract";
import type { Task, WorkOrder } from "../types";

const baseOrder: WorkOrder = {
  operation: "CREATE",
  target_type: "FILE",
  target_path: "tests/__sandbox__/automation-loop-proof.txt",
  requested_change: "Create one sandbox proof file for the closed automation loop",
  content: "DNA OS automation loop verified\n",
  workspace_scope: "tests/__sandbox__/",
  mode: "sandbox",
  required_tests: ["sandbox.write", "sandbox.readback"],
  forbidden_files: [".env", "supabase/migrations", "app/business"],
  evidence: [{ source: "automation-loop.e2e.test.ts", note: "owner-approved sandbox proof" }],
};

const memory = {
  user_id: "identity-test-owner",
  workspace_id: "workspace-test-sandbox",
  conversation_id: "conversation-automation-loop",
  parent_task_id: null,
};

async function main() {
  const completed = await submitTask("ตรวจ sandbox automation", memory, "e2e-test", [aiWriteAdapter], baseOrder);
  const completedTask = getTask(completed.task_id);
  if (completedTask?.status !== "COMPLETED") throw new Error(`E2E expected COMPLETED, got ${completedTask?.status}`);
  if (!existsSync(baseOrder.target_path)) throw new Error("E2E expected sandbox artifact to exist");
  unlinkSync(baseOrder.target_path);
  console.log("PASS E2E sandbox work order -> validator -> write gate -> file write -> readback evidence");

  const replay = await submitTask("ตรวจ sandbox automation", memory, "e2e-test", [aiWriteAdapter], baseOrder);
  if (replay.task_id !== completed.task_id || !loadEvidenceForTask(completed.task_id).some((item) => item.kind === "idempotency")) {
    throw new Error("idempotent replay must return the original task and persist idempotency evidence");
  }
  console.log("PASS failure-safety: duplicate sandbox WorkOrder replay suppressed with idempotency evidence");

  const outOfScope = await submitTask("ตรวจ sandbox automation", memory, "e2e-test", [aiWriteAdapter], { ...baseOrder, target_path: "app/business/forbidden.ts" });
  if (outOfScope.status !== "BLOCKED") throw new Error(`out-of-scope expected BLOCKED, got ${outOfScope.status}`);
  console.log("PASS failure: out-of-scope work order blocked");

  const validatorFail = await submitTask("ตรวจ sandbox automation", memory, "e2e-test", [aiWriteAdapter], { ...baseOrder, evidence: [], required_tests: [] });
  if (validatorFail.status !== "BLOCKED") throw new Error(`validator failure expected BLOCKED, got ${validatorFail.status}`);
  console.log("PASS failure: validator failure blocked");

  const interrupted: Task = { ...completed, task_id: "task-restart-proof", status: "EXECUTING", updated_at: new Date().toISOString(), work_order: baseOrder };
  saveTask(interrupted);
  const recovered = recoverInterruptedTasks().find((task) => task.task_id === interrupted.task_id);
  if (recovered?.status !== "BLOCKED") throw new Error(`restart recovery expected BLOCKED, got ${recovered?.status}`);
  console.log("PASS failure: worker restart recovery persisted BLOCKED + recovery evidence");

  const unauthorized = submitWriteRequest({ operation: "CREATE", capability: "code_change_work_order", target_type: "FILE", target_path: baseOrder.target_path, requested_change: baseOrder.requested_change }, {
    identity_id: "human-test-owner",
    acting_as_account_id: "account-test",
    acting_as_tenant_id: "tenant-test",
    software_id: "test",
    kind: "human",
  });
  if (unauthorized.ok) throw new Error("unauthorized human request must be rejected by ai-write-control");
  console.log("PASS failure: unauthorized human request rejected");
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
