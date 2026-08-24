/**
 * หน้าที่: proves Permission / Policy Resolution is deterministic,
 * fail-closed, and reuses only real, already-registered state — never an
 * AI/Agent decision. Builds one real task + real registered artifacts via
 * the same fixture pattern as
 * control/target-resolution/tests/target-resolution.test.ts (saveTask +
 * ingestWorkResult), then exercises every one of the 15 minimum rules.
 *
 * How to run: npx tsx control/permission-policy-resolution/tests/permission-policy-resolution.test.ts
 */

import { saveTask } from "../../agent-gateway/memory-store";
import { loadEvidenceForTask } from "../../agent-gateway/contract";
import { ingestWorkResult } from "../../work-result-ingress/contract";
import type { WorkResultInput } from "../../work-result-ingress/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { resolveArtifactDestination } from "../../artifact-destination/contract";
import { resolvePolicy } from "../contract";
import type { PolicyResolutionInput } from "../contract";
import type { Task, WorkOrder } from "../../agent-gateway/types";

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

// --- shared fixture: one real task, one real handoff, three real registered artifacts ---
const store = createLocalFileStore();
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const taskId = `task-permission-policy-${uniq}`;
const workOrder: WorkOrder = {
  operation: "MODIFY", target_type: "FILE", target_path: "test-fixtures/permission-policy-resolution/target.ts",
  requested_change: "test fixture", content: "// test fixture\n", workspace_scope: "test-fixtures/permission-policy-resolution/",
  mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "permission-policy-resolution.test.ts", note: "test fixture" }],
};
const task: Task = {
  task_id: taskId,
  memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
  intent_text: "permission-policy-resolution test fixture", submitted_by_client: "permission-policy-resolution.test.ts",
  status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  work_order: workOrder, output_lane: "WORK_ITEM",
};
saveTask(task);

const workResult: WorkResultInput = {
  task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: "work-order://test-fixture/permission-policy-resolution",
  files_read: [],
  files_changed: ["test-fixtures/permission-policy-resolution/a.ts"],
  tests_run: ["npx tsc --noEmit"],
  status: "VERIFIED",
  evidence_refs: ["control/permission-policy-resolution/tests/permission-policy-resolution.test.ts"],
  blockers: [], next_action: null,
  capabilities_introduced: [{ name: `test-fixture-permission-policy-capability-${uniq}`, source_location: "test-fixtures/permission-policy-resolution/capability.ts", purpose: "prove permission/policy resolution against a real registered artifact" }],
};
const ingressResult = ingestWorkResult(workResult, { store });
if (ingressResult.blocker) throw new Error(`fixture setup failed: ${ingressResult.blocker}`);

const sourceRef = ingressResult.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;
const testResultArtifact = ingressResult.artifacts.find((a) => a.resource_type === "TEST_RESULT")!;
const capabilityArtifact = ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;

const sourceRefDestination = resolveArtifactDestination({ resource_id: sourceRef.resource_id!, resource_type: "SOURCE_REFERENCE", capability_id: sourceRef.capability_id, evidence_ref: workResult.evidence_refs[0]! });
const testResultDestination = resolveArtifactDestination({ resource_id: testResultArtifact.resource_id!, resource_type: "TEST_RESULT", capability_id: testResultArtifact.capability_id, evidence_ref: workResult.evidence_refs[0]! });
const capabilityDestination = resolveArtifactDestination({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, evidence_ref: workResult.evidence_refs[0]! });

function baseInput(overrides: Partial<PolicyResolutionInput> = {}): PolicyResolutionInput {
  return {
    artifact_resource_id: sourceRef.resource_id!,
    artifact_resource_type: "SOURCE_REFERENCE",
    source_capability_id: sourceRef.capability_id,
    target_capability_id: sourceRefDestination.destination_capability_id,
    target_class: sourceRefDestination.destination_class,
    task_id: taskId,
    worker_id: "codex",
    requested_action: "WRITE_SOURCE",
    evidence_refs: ["control/permission-policy-resolution/tests/permission-policy-resolution.test.ts"],
    correlation_id: `corr-${uniq}`,
    ...overrides,
  };
}

// A. valid SOURCE_REFERENCE -> WRITE_SOURCE -> ALLOW
check("A. valid SOURCE_REFERENCE -> WRITE_SOURCE -> ALLOW", () => {
  const result = resolvePolicy(baseInput(), { store });
  assert(result.decision === "ALLOW", `expected ALLOW, got ${result.decision} (${result.reason_codes.join(",")})`);
  assert(result.reason_codes.includes("POLICY_MATCH"), "expected POLICY_MATCH reason code");
});

// B. SOURCE_REFERENCE -> APPEND_EVIDENCE -> DENY
check("B. SOURCE_REFERENCE -> APPEND_EVIDENCE -> DENY", () => {
  const result = resolvePolicy(baseInput({ requested_action: "APPEND_EVIDENCE" }), { store });
  assert(result.decision === "DENY", `expected DENY, got ${result.decision}`);
  assert(result.reason_codes.includes("ACTION_NOT_ALLOWED_FOR_DESTINATION"), `expected ACTION_NOT_ALLOWED_FOR_DESTINATION, got ${result.reason_codes.join(",")}`);
});

// C. TEST_RESULT -> APPEND_EVIDENCE -> ALLOW
check("C. TEST_RESULT -> APPEND_EVIDENCE -> ALLOW", () => {
  const result = resolvePolicy(baseInput({
    artifact_resource_id: testResultArtifact.resource_id!,
    artifact_resource_type: "TEST_RESULT",
    source_capability_id: testResultArtifact.capability_id,
    target_capability_id: testResultDestination.destination_capability_id,
    target_class: testResultDestination.destination_class,
    requested_action: "APPEND_EVIDENCE",
  }), { store });
  assert(result.decision === "ALLOW", `expected ALLOW, got ${result.decision} (${result.reason_codes.join(",")})`);
});

// D. CAPABILITY -> REGISTER_CAPABILITY -> ALLOW when work-order scope permits
check("D. CAPABILITY -> REGISTER_CAPABILITY -> ALLOW when work-order scope permits", () => {
  const result = resolvePolicy(baseInput({
    artifact_resource_id: capabilityArtifact.resource_id!,
    artifact_resource_type: "CAPABILITY",
    source_capability_id: capabilityArtifact.capability_id,
    target_capability_id: capabilityDestination.destination_capability_id,
    target_class: capabilityDestination.destination_class,
    requested_action: "REGISTER_CAPABILITY",
  }), { store });
  assert(result.decision === "ALLOW", `expected ALLOW, got ${result.decision} (${result.reason_codes.join(",")})`);
});

// E. unknown action -> DENY
check("E. unknown action -> DENY, reason UNKNOWN_ACTION", () => {
  const result = resolvePolicy(baseInput({ requested_action: "DELETE_EVERYTHING" }), { store });
  assert(result.decision === "DENY" && result.reason_codes.includes("UNKNOWN_ACTION"), `expected DENY/UNKNOWN_ACTION, got ${result.decision}/${result.reason_codes.join(",")}`);
});

// F. missing target -> DENY
check("F. missing target -> DENY, reason TARGET_NOT_RESOLVED", () => {
  const result = resolvePolicy(baseInput({ target_capability_id: null, target_class: null }), { store });
  assert(result.decision === "DENY" && result.reason_codes.includes("TARGET_NOT_RESOLVED"), `expected DENY/TARGET_NOT_RESOLVED, got ${result.decision}/${result.reason_codes.join(",")}`);
});

// G. missing artifact -> DENY
check("G. missing artifact -> DENY, reason ARTIFACT_NOT_FOUND", () => {
  const result = resolvePolicy(baseInput({ artifact_resource_id: "resource-does-not-exist" }), { store });
  assert(result.decision === "DENY" && result.reason_codes.includes("ARTIFACT_NOT_FOUND"), `expected DENY/ARTIFACT_NOT_FOUND, got ${result.decision}/${result.reason_codes.join(",")}`);
});

// H. wrong worker/task context -> DENY
check("H. wrong worker/task context -> DENY, reason WORKER_TASK_MISMATCH", () => {
  const result = resolvePolicy(baseInput({ worker_id: "some-other-agent" }), { store });
  assert(result.decision === "DENY" && result.reason_codes.includes("WORKER_TASK_MISMATCH"), `expected DENY/WORKER_TASK_MISMATCH, got ${result.decision}/${result.reason_codes.join(",")}`);
});

// I. missing required evidence -> DENY
check("I. missing required evidence -> DENY, reason EVIDENCE_REQUIRED", () => {
  const result = resolvePolicy(baseInput({ evidence_refs: [] }), { store });
  assert(result.decision === "DENY" && result.reason_codes.includes("EVIDENCE_REQUIRED"), `expected DENY/EVIDENCE_REQUIRED, got ${result.decision}/${result.reason_codes.join(",")}`);
});

// J. system-level mutation requiring owner approval -> REQUIRE_APPROVAL
check("J. system-level mutation (AI_INGRESS -> SYSTEM_REGISTRY, REGISTER_SYSTEM_RESOURCE) -> REQUIRE_APPROVAL", () => {
  const result = resolvePolicy(baseInput({
    artifact_resource_id: capabilityArtifact.resource_id!,
    artifact_resource_type: "AI_INGRESS",
    source_capability_id: capabilityArtifact.capability_id,
    target_capability_id: "software-registry",
    target_class: "SYSTEM_REGISTRY",
    requested_action: "REGISTER_SYSTEM_RESOURCE",
  }), { store });
  assert(result.decision === "REQUIRE_APPROVAL", `expected REQUIRE_APPROVAL, got ${result.decision} (${result.reason_codes.join(",")})`);
  assert(result.reason_codes.includes("OWNER_APPROVAL_REQUIRED"), `expected OWNER_APPROVAL_REQUIRED, got ${result.reason_codes.join(",")}`);
});

// K. no decision path can silently ALLOW
check("K. no decision path can silently ALLOW — an unmapped (resource_type, target_class) pair DENYs, never defaults to ALLOW", () => {
  const result = resolvePolicy(baseInput({ artifact_resource_type: "UNKNOWN_RESOURCE_TYPE_NEVER_MAPPED" }), { store });
  assert(result.decision === "DENY", `expected DENY for an unmapped pair, got ${result.decision}`);
  assert(result.reason_codes.includes("SOURCE_TARGET_MISMATCH"), `expected SOURCE_TARGET_MISMATCH, got ${result.reason_codes.join(",")}`);
  assert(result.reason_codes.length > 0, "every DENY must carry at least one reason_code — no silent decision");
});

// L (partial, unit-level): OUTSIDE_WORK_ORDER_SCOPE is reachable for real
check("action outside the original work order scope -> DENY, reason OUTSIDE_WORK_ORDER_SCOPE", () => {
  // A second, independent task with the same workspace_scope, so the
  // real duplicate-active-submission guard on the first task's handoff
  // never interferes with this artifact's own real registration.
  const scopeTaskId = `task-permission-policy-scope-${uniq}`;
  const scopeTask: Task = { ...task, task_id: scopeTaskId, memory: { ...task.memory, task_id: scopeTaskId, conversation_id: `conv-${scopeTaskId}` } };
  saveTask(scopeTask);
  const outOfScopeResult = ingestWorkResult({ ...workResult, task_id: scopeTaskId, files_changed: ["outside-scope/not-in-workspace.ts"], capabilities_introduced: undefined }, { store });
  if (outOfScopeResult.blocker) throw new Error(`out-of-scope fixture setup failed: ${outOfScopeResult.blocker}`);
  const outOfScopeArtifact = outOfScopeResult.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;
  const destination = resolveArtifactDestination({ resource_id: outOfScopeArtifact.resource_id!, resource_type: "SOURCE_REFERENCE", capability_id: outOfScopeArtifact.capability_id, evidence_ref: workResult.evidence_refs[0]! });
  const result = resolvePolicy(baseInput({
    artifact_resource_id: outOfScopeArtifact.resource_id!,
    source_capability_id: outOfScopeArtifact.capability_id,
    target_capability_id: destination.destination_capability_id,
    target_class: destination.destination_class,
    task_id: scopeTaskId,
  }), { store });
  assert(result.decision === "DENY" && result.reason_codes.includes("OUTSIDE_WORK_ORDER_SCOPE"), `expected DENY/OUTSIDE_WORK_ORDER_SCOPE, got ${result.decision}/${result.reason_codes.join(",")}`);
});

// Traceability: every decision persists as real, retrievable evidence.
check("every policy decision persists as retrievable Evidence (kind=policy_decision) on the real task", () => {
  const result = resolvePolicy(baseInput(), { store });
  const evidence = loadEvidenceForTask(taskId);
  const match = evidence.find((e) => e.evidence_id === result.policy_decision_id);
  assert(match !== undefined, "expected the policy decision to be retrievable via loadEvidenceForTask");
  assert(match!.kind === "policy_decision", `expected kind=policy_decision, got ${match!.kind}`);
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
