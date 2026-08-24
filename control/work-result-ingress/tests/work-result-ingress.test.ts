/**
 * หน้าที่: proves the canonical Work Result Ingress end to end — real
 * task admission, real classification/splitting, real Registration
 * Pipeline, real Registry writes, real handoff-as-evidence, real next
 * decision. No mocks. Mirrors the Owner's own example: 3 changed files +
 * 1 test result + 1 new capability must become 5 separate registered
 * artifacts, never one resource standing in for the whole handoff.
 *
 * How to run: npx tsx control/work-result-ingress/tests/work-result-ingress.test.ts
 */

import { saveTask } from "../../agent-gateway/memory-store";
import { getTask } from "../../agent-gateway/contract";
import type { Task, WorkOrder } from "../../agent-gateway/types";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { findCapability } from "../../../software/registry-database/lookup";
import { ingestWorkResult } from "../contract";
import type { WorkResultInput } from "../types";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const FIXTURE_WORK_ORDER: WorkOrder = {
  operation: "MODIFY",
  target_type: "FILE",
  target_path: "test-fixtures/work-result-ingress/target.ts",
  requested_change: "test fixture work order for work-result-ingress.test.ts",
  content: "// test fixture\n",
  workspace_scope: "test-fixtures/work-result-ingress/",
  mode: "sandbox",
  required_tests: ["sandbox.write"],
  forbidden_files: [],
  evidence: [{ source: "work-result-ingress.test.ts", note: "test fixture" }],
};

function admittedTask(taskId: string, status: Task["status"] = "EXECUTING"): Task {
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "work-result-ingress test fixture",
    submitted_by_client: "work-result-ingress.test.ts",
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    work_order: FIXTURE_WORK_ORDER,
    output_lane: "WORK_ITEM",
  };
  saveTask(task);
  return task;
}

function main(): void {
  const store = createLocalFileStore();
  // control/agent-gateway/'s task/handoff store is real, persistent disk
  // state shared with the live server — not test-isolated. A unique
  // suffix per run avoids colliding with a stale handoff left by a
  // previous run of this same test using the same literal task_id.
  const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // 1. The Owner's own example: 3 changed files + 1 test result + 1 new capability -> 5 separate registered artifacts.
  check("a work result with 3 files + 1 test + 1 capability splits into 5 separately registered artifacts, never one resource", () => {
    const taskId = `task-wri-split-example-${RUN_ID}`;
    admittedTask(taskId);
    const input: WorkResultInput = {
      task_id: taskId,
      agent_id: "codex",
      role: "test-fixture",
      input_reference: "work-order://test-fixture/split-example",
      files_read: [],
      files_changed: ["test-fixtures/work-result-ingress/a.ts", "test-fixtures/work-result-ingress/b.ts", "test-fixtures/work-result-ingress/c.ts"],
      tests_run: ["npx tsc --noEmit"],
      status: "VERIFIED",
      evidence_refs: ["control/work-result-ingress/tests/work-result-ingress.test.ts"],
      blockers: [],
      next_action: null,
      capabilities_introduced: [{ name: "test-fixture-split-capability", source_location: "test-fixtures/work-result-ingress/capability.ts", purpose: "prove work-result-ingress splits a handoff into real candidates" }],
    };
    const result = ingestWorkResult(input, { store });
    assert(result.blocker === null, `expected no blocker, got ${result.blocker}`);
    assert(result.artifacts.length === 5, `expected 5 artifacts (3 files + 1 test + 1 capability), got ${result.artifacts.length}`);
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}`);
    const sourceRefs = result.artifacts.filter((a) => a.resource_type === "SOURCE_REFERENCE");
    const testResults = result.artifacts.filter((a) => a.resource_type === "TEST_RESULT");
    const capabilities = result.artifacts.filter((a) => a.resource_type === "CAPABILITY");
    assert(sourceRefs.length === 3, `expected 3 SOURCE_REFERENCE artifacts, got ${sourceRefs.length}`);
    assert(testResults.length === 1, `expected 1 TEST_RESULT artifact, got ${testResults.length}`);
    assert(capabilities.length === 1, `expected 1 CAPABILITY artifact, got ${capabilities.length}`);
    for (const artifact of result.artifacts) {
      assert(artifact.decision === "REGISTERED", `expected every artifact REGISTERED, got ${artifact.candidate_id}=${artifact.decision}`);
      assert(artifact.resource_id !== null, `expected a real resource_id for ${artifact.candidate_id}`);
    }
    assert(result.handoff_id !== null && result.handoff_id.startsWith("handoff_"), "expected a real handoff_id");
    assert(result.next_decision !== null, "expected a real next_decision computed from persisted evidence");
  });

  // 2. Registered artifacts are individually findable in the real registry — never the whole handoff as one resource.
  check("each split artifact is independently findable via findCapability(), not collapsed into one resource", () => {
    const taskId = `task-wri-lookup-example-${RUN_ID}`;
    admittedTask(taskId);
    const input: WorkResultInput = {
      task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/lookup-example",
      files_read: [], files_changed: [], tests_run: [],
      status: "IN_PROGRESS", evidence_refs: ["control/work-result-ingress/tests/work-result-ingress.test.ts"], blockers: [], next_action: null,
      capabilities_introduced: [{ name: "test-fixture-lookup-capability", source_location: "test-fixtures/work-result-ingress/lookup.ts", purpose: "prove per-artifact lookup" }],
    };
    const result = ingestWorkResult(input, { store });
    assert(result.blocker === null, `expected no blocker, got ${result.blocker}`);
    assert(result.artifacts.length === 1, `expected exactly 1 artifact, got ${result.artifacts.length}`);
    const looked_up = findCapability({ capability_id: result.artifacts[0]!.capability_id! }, store);
    assert(looked_up !== null && looked_up.status === "REGISTERED", "expected the split capability artifact to be independently findable");
  });

  // 3. A handoff with zero declared artifacts (pure status report) is still REGISTERED, just with zero artifacts — never rejected for having nothing to split.
  check("a work result with zero artifacts still registers as a pure status report", () => {
    const taskId = `task-wri-zero-artifacts-${RUN_ID}`;
    admittedTask(taskId);
    const input: WorkResultInput = {
      task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/zero-artifacts",
      files_read: [], files_changed: [], tests_run: [], status: "IN_PROGRESS",
      evidence_refs: [], blockers: [], next_action: null,
    };
    const result = ingestWorkResult(input, { store });
    assert(result.blocker === null, `expected no blocker, got ${result.blocker}`);
    assert(result.artifacts.length === 0, "expected zero artifacts");
    assert(result.status === "REGISTERED", `expected REGISTERED for a pure status report, got ${result.status}`);
    assert(result.handoff_id !== null, "expected the handoff itself to still be recorded as evidence");
  });

  // 4. Task/worker/session admission still enforced — unadmitted task is rejected before any classification.
  check("an unknown task_id is rejected before any classification happens", () => {
    const input: WorkResultInput = {
      task_id: "task-does-not-exist", agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/unknown-task",
      files_read: [], files_changed: ["should-never-be-registered.ts"], tests_run: [], status: "IN_PROGRESS",
      evidence_refs: ["control/work-result-ingress/tests/work-result-ingress.test.ts"], blockers: [], next_action: null,
    };
    const countsBefore = store.debugCounts();
    const result = ingestWorkResult(input, { store });
    assert(result.blocker === "WORK_ORDER_NOT_ADMITTED", `expected WORK_ORDER_NOT_ADMITTED, got ${result.blocker}`);
    assert(result.artifacts.length === 0, "expected zero artifacts for a rejected admission");
    const countsAfter = store.debugCounts();
    assert(countsAfter.resources === countsBefore.resources, "expected zero rows written for an unadmitted task");
  });

  // 5. A task not in EXECUTING/VERIFYING is rejected before classification.
  check("a task not in EXECUTING/VERIFYING is rejected before any classification happens", () => {
    const taskId = `task-wri-wrong-status-${RUN_ID}`;
    admittedTask(taskId, "COMPLETED");
    const input: WorkResultInput = {
      task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/wrong-status",
      files_read: [], files_changed: ["should-never-be-registered-either.ts"], tests_run: [], status: "IN_PROGRESS",
      evidence_refs: ["control/work-result-ingress/tests/work-result-ingress.test.ts"], blockers: [], next_action: null,
    };
    const result = ingestWorkResult(input, { store });
    assert(result.blocker === "WORK_ORDER_NOT_ACTIVE:COMPLETED", `expected WORK_ORDER_NOT_ACTIVE:COMPLETED, got ${result.blocker}`);
  });

  // 6. Duplicate active submission is still rejected before classification.
  check("a duplicate active submission for the same task is rejected", () => {
    const taskId = `task-wri-duplicate-${RUN_ID}`;
    admittedTask(taskId);
    const input: WorkResultInput = {
      task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/duplicate-1",
      files_read: [], files_changed: [], tests_run: [], status: "IN_PROGRESS",
      evidence_refs: ["control/work-result-ingress/tests/work-result-ingress.test.ts"], blockers: [], next_action: null,
    };
    const first = ingestWorkResult(input, { store });
    assert(first.blocker === null, `expected the first submission to succeed, got ${first.blocker}`);
    const second = ingestWorkResult({ ...input, input_reference: "work-order://test-fixture/duplicate-2" }, { store });
    assert(second.blocker !== null && second.blocker.startsWith("DUPLICATE_ACTIVE_SUBMISSION"), `expected DUPLICATE_ACTIVE_SUBMISSION, got ${second.blocker}`);
  });

  // 7. No evidence_refs -> every split candidate is honestly rejected by the same Registration Gate, never silently skipped.
  check("a work result with no evidence_refs has every artifact rejected by the real Registration Gate", () => {
    const taskId = `task-wri-no-evidence-${RUN_ID}`;
    admittedTask(taskId);
    const input: WorkResultInput = {
      task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/no-evidence",
      files_read: [], files_changed: ["test-fixtures/work-result-ingress/no-evidence.ts"], tests_run: [],
      status: "IN_PROGRESS", evidence_refs: [], blockers: [], next_action: null,
    };
    const result = ingestWorkResult(input, { store });
    assert(result.blocker === null, `expected admission to pass (evidence is only required for VERIFIED), got ${result.blocker}`);
    assert(result.artifacts.length === 1, "expected 1 artifact attempted");
    assert(result.artifacts[0]!.decision === "REJECTED", `expected REJECTED (Validation stage — EVIDENCE_REQUIRED), got ${result.artifacts[0]!.decision}`);
    assert(result.status === "REJECTED", `expected overall REJECTED since the only artifact failed, got ${result.status}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
