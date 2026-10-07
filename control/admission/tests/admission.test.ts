/**
 * หน้าที่: proves Admission is deterministic, single-owner ("ready or
 * not"), never recomputes a prior stage, never executes anything — STEP
 * "Build Source Admission", tests A-I. Builds one real task + real
 * registered artifacts (control/work-result-ingress/) + real target
 * resolution (control/target-resolution/) + real policy decisions
 * (control/permission-policy-resolution/) exactly like the real pipeline
 * would, then exercises evaluateAdmission() against them.
 *
 * How to run: npx tsx control/admission/tests/admission.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saveTask } from "../../agent-gateway/memory-store";
import { loadEvidenceForTask } from "../../agent-gateway/contract";
import { ingestWorkResult } from "../../work-result-ingress/contract";
import type { WorkResultInput } from "../../work-result-ingress/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { resolveArtifactDestination } from "../../artifact-destination/contract";
import { resolveTarget } from "../../target-resolution/contract";
import { resolvePolicy } from "../../permission-policy-resolution/contract";
import { evaluateAdmission } from "../contract";
import type { AdmissionInput } from "../contract";
import type { Task, WorkOrder } from "../../agent-gateway/types";

declare const process: { exitCode?: number; cwd(): string };
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

const store = createLocalFileStore();
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function makeTaskAndArtifacts(scenario: string) {
  const taskId = `task-admission-${scenario}-${uniq}`;
  const workOrder: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: `test-fixtures/admission/${scenario}/target.ts`,
    requested_change: "test fixture", content: "// test fixture\n", workspace_scope: `test-fixtures/admission/${scenario}/`,
    mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "admission.test.ts", note: "test fixture" }],
  };
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "admission test fixture", submitted_by_client: "admission.test.ts",
    status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    work_order: workOrder, output_lane: "WORK_ITEM",
  };
  saveTask(task);

  const workResult: WorkResultInput = {
    task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: `work-order://test-fixture/admission-${scenario}`,
    files_read: [],
    files_changed: [`test-fixtures/admission/${scenario}/a.ts`],
    tests_run: ["npx tsc --noEmit"],
    status: "VERIFIED",
    evidence_refs: ["control/admission/tests/admission.test.ts"],
    blockers: [], next_action: null,
    // The trailing digits (not letters) are the part that survives
    // registration-contract.ts's normalize() untouched — every identifier
    // -like word longer than 2 chars collapses to the literal string
    // "identifier" there, so two scenarios whose purpose differs only in
    // words would otherwise share one semantic fingerprint and collide as
    // DUPLICATE_SEMANTIC against each other in this shared store.
    capabilities_introduced: [{ name: `test-fixture-admission-capability-${scenario}-${uniq}`, source_location: `test-fixtures/admission/${scenario}/capability.ts`, purpose: `prove admission against a real registered artifact ${Math.floor(Math.random() * 1e9)}` }],
  };
  const ingressResult = ingestWorkResult(workResult, { store });
  if (ingressResult.blocker) throw new Error(`fixture setup failed for ${scenario}: ${ingressResult.blocker}`);
  return { taskId, workOrder, ingressResult };
}

function main(): void {
  // A. registered + resolved + ALLOW + valid task + evidence -> ADMITTED
  check("A. registered + resolved(REGISTRY_ROW) + ALLOW + valid task + evidence -> ADMITTED", () => {
    const { taskId, ingressResult } = makeTaskAndArtifacts("admitted");
    const capabilityArtifact = ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const destination = resolveArtifactDestination({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, evidence_ref: "control/admission/tests/admission.test.ts" });
    const resolvedTarget = resolveTarget({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, source_location: "test-fixtures/admission/admitted/capability.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    assert(resolvedTarget.target_status === "RESOLVED", `precondition: expected RESOLVED target, got ${resolvedTarget.target_status}`);
    const policy = resolvePolicy({
      artifact_resource_id: capabilityArtifact.resource_id!, artifact_resource_type: "CAPABILITY", source_capability_id: capabilityArtifact.capability_id,
      target_capability_id: destination.destination_capability_id, target_class: destination.destination_class,
      task_id: taskId, worker_id: "codex", requested_action: "REGISTER_CAPABILITY",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-a",
    }, { store });
    assert(policy.decision === "ALLOW", `precondition: expected ALLOW, got ${policy.decision}`);
    const input: AdmissionInput = { artifact_resource_id: capabilityArtifact.resource_id!, task_id: taskId, correlation_id: "corr-admission-a", resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: ["control/admission/tests/admission.test.ts"] };
    const result = evaluateAdmission(input, { store });
    assert(result.decision === "ADMITTED", `expected ADMITTED, got ${result.decision} (${result.reason_code})`);
    assert(result.execution_ready_reference !== null, "expected a real ExecutionReadyReference");
    assert(result.execution_ready_reference!.authorized_action === "REGISTER_CAPABILITY", "expected the reference to carry the real authorized_action from policy");
    assert(result.execution_ready_reference!.policy_decision_id === policy.policy_decision_id, "expected the reference to carry the real policy_decision_id");
  });

  // B. DENY -> NOT_ADMITTED
  check("B. policy DENY -> NOT_ADMITTED", () => {
    const { taskId, ingressResult } = makeTaskAndArtifacts("denied");
    // Use the CAPABILITY artifact (its target genuinely resolves —
    // REGISTRY_ROW, no GitHub connection needed) with an action that's
    // not valid for CAPABILITY_GRAPH, so the DENY comes from the policy
    // decision itself, not from an unresolved target masking it.
    const capabilityArtifact = ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const destination = resolveArtifactDestination({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, evidence_ref: "control/admission/tests/admission.test.ts" });
    const resolvedTarget = resolveTarget({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, source_location: "test-fixtures/admission/denied/capability.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    assert(resolvedTarget.target_status === "RESOLVED", `precondition: expected RESOLVED target, got ${resolvedTarget.target_status}`);
    const policy = resolvePolicy({
      artifact_resource_id: capabilityArtifact.resource_id!, artifact_resource_type: "CAPABILITY", source_capability_id: capabilityArtifact.capability_id,
      target_capability_id: destination.destination_capability_id, target_class: destination.destination_class,
      task_id: taskId, worker_id: "codex", requested_action: "WRITE_SOURCE",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-b",
    }, { store });
    assert(policy.decision === "DENY", `precondition: expected DENY, got ${policy.decision}`);
    const input: AdmissionInput = { artifact_resource_id: capabilityArtifact.resource_id!, task_id: taskId, correlation_id: "corr-admission-b", resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: ["control/admission/tests/admission.test.ts"] };
    const result = evaluateAdmission(input, { store });
    assert(result.decision === "NOT_ADMITTED", `expected NOT_ADMITTED, got ${result.decision} (${result.reason_code})`);
    assert(result.reason_code === "POLICY_DENIED", `expected POLICY_DENIED, got ${result.reason_code}`);
    assert(result.execution_ready_reference === null, "expected no ExecutionReadyReference for NOT_ADMITTED");
  });

  // C. REQUIRE_APPROVAL -> REQUIRE_APPROVAL
  check("C. policy REQUIRE_APPROVAL -> REQUIRE_APPROVAL", () => {
    const { taskId, ingressResult } = makeTaskAndArtifacts("approval");
    const capabilityArtifact = ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const resolvedTarget = resolveTarget({ resource_id: capabilityArtifact.resource_id!, resource_type: "AI_INGRESS", capability_id: capabilityArtifact.capability_id, source_location: "test-fixtures/admission/approval/capability.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    const policy = resolvePolicy({
      artifact_resource_id: capabilityArtifact.resource_id!, artifact_resource_type: "AI_INGRESS", source_capability_id: capabilityArtifact.capability_id,
      target_capability_id: "software-registry", target_class: "SYSTEM_REGISTRY",
      task_id: taskId, worker_id: "codex", requested_action: "REGISTER_SYSTEM_RESOURCE",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-c",
    }, { store });
    assert(policy.decision === "REQUIRE_APPROVAL", `precondition: expected REQUIRE_APPROVAL, got ${policy.decision}`);
    const input: AdmissionInput = { artifact_resource_id: capabilityArtifact.resource_id!, task_id: taskId, correlation_id: "corr-admission-c", resolved_target: { ...resolvedTarget, target_status: "RESOLVED", target_ref: "software-registry://system_registry/test", target_kind: "REGISTRY_ROW" }, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: ["control/admission/tests/admission.test.ts"] };
    const result = evaluateAdmission(input, { store });
    assert(result.decision === "REQUIRE_APPROVAL", `expected REQUIRE_APPROVAL, got ${result.decision} (${result.reason_code})`);
    assert(result.reason_code === "OWNER_APPROVAL_REQUIRED", `expected OWNER_APPROVAL_REQUIRED, got ${result.reason_code}`);
  });

  // D. target unresolved -> UNRESOLVED
  check("D. target unresolved (real empty connection state) -> UNRESOLVED", () => {
    const { taskId, ingressResult } = makeTaskAndArtifacts("unresolved-target");
    const sourceRef = ingressResult.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;
    const destination = resolveArtifactDestination({ resource_id: sourceRef.resource_id!, resource_type: "SOURCE_REFERENCE", capability_id: sourceRef.capability_id, evidence_ref: "control/admission/tests/admission.test.ts" });
    const resolvedTarget = resolveTarget({ resource_id: sourceRef.resource_id!, resource_type: "SOURCE_REFERENCE", capability_id: sourceRef.capability_id, source_location: "test-fixtures/admission/unresolved-target/a.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    assert(resolvedTarget.target_status === "TARGET_NOT_RESOLVED", `precondition: expected TARGET_NOT_RESOLVED (no real GitHub connection exists), got ${resolvedTarget.target_status}`);
    const policy = resolvePolicy({
      artifact_resource_id: sourceRef.resource_id!, artifact_resource_type: "SOURCE_REFERENCE", source_capability_id: sourceRef.capability_id,
      target_capability_id: destination.destination_capability_id, target_class: destination.destination_class,
      task_id: taskId, worker_id: "codex", requested_action: "WRITE_SOURCE",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-d",
    }, { store });
    assert(policy.decision === "ALLOW", `precondition: expected policy ALLOW despite target-resolution's own TARGET_NOT_RESOLVED (a different, independent check), got ${policy.decision}`);
    const input: AdmissionInput = { artifact_resource_id: sourceRef.resource_id!, task_id: taskId, correlation_id: "corr-admission-d", resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: ["control/admission/tests/admission.test.ts"] };
    const result = evaluateAdmission(input, { store });
    assert(result.decision === "UNRESOLVED", `expected UNRESOLVED, got ${result.decision} (${result.reason_code})`);
    assert(result.reason_code === "TARGET_NOT_RESOLVED", `expected TARGET_NOT_RESOLVED, got ${result.reason_code}`);
  });

  // E. artifact/task/policy mismatch -> NOT_ADMITTED
  check("E. artifact/task/policy mismatch -> NOT_ADMITTED", () => {
    const first = makeTaskAndArtifacts("mismatch-a");
    const second = makeTaskAndArtifacts("mismatch-b");
    const firstCapability = first.ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const secondCapability = second.ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const destination = resolveArtifactDestination({ resource_id: firstCapability.resource_id!, resource_type: "CAPABILITY", capability_id: firstCapability.capability_id, evidence_ref: "control/admission/tests/admission.test.ts" });
    const resolvedTarget = resolveTarget({ resource_id: firstCapability.resource_id!, resource_type: "CAPABILITY", capability_id: firstCapability.capability_id, source_location: "test-fixtures/admission/mismatch-a/capability.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    // A real policy decision made for the FIRST task/artifact...
    const policy = resolvePolicy({
      artifact_resource_id: firstCapability.resource_id!, artifact_resource_type: "CAPABILITY", source_capability_id: firstCapability.capability_id,
      target_capability_id: destination.destination_capability_id, target_class: destination.destination_class,
      task_id: first.taskId, worker_id: "codex", requested_action: "REGISTER_CAPABILITY",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-e",
    }, { store });
    assert(policy.decision === "ALLOW", `precondition: expected ALLOW, got ${policy.decision}`);
    // ...but Admission is asked about the SECOND artifact, while still
    // citing the FIRST's real task_id/policy_decision_id (so the real,
    // persisted policy evidence IS findable — the mismatch is caught by
    // comparing identities, not by failing to find the record at all).
    const input: AdmissionInput = { artifact_resource_id: secondCapability.resource_id!, task_id: first.taskId, correlation_id: "corr-admission-e", resolved_target: { ...resolvedTarget, artifact_resource_id: secondCapability.resource_id! }, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: ["control/admission/tests/admission.test.ts"] };
    const result = evaluateAdmission(input, { store });
    assert(result.decision === "NOT_ADMITTED", `expected NOT_ADMITTED, got ${result.decision} (${result.reason_code})`);
    assert(result.reason_code === "IDENTITY_MISMATCH", `expected IDENTITY_MISMATCH, got ${result.reason_code}`);
  });

  // F. evidence missing -> UNRESOLVED
  check("F. missing evidence_refs on the Admission input itself -> UNRESOLVED", () => {
    const { taskId, ingressResult } = makeTaskAndArtifacts("missing-evidence");
    const capabilityArtifact = ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const destination = resolveArtifactDestination({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, evidence_ref: "control/admission/tests/admission.test.ts" });
    const resolvedTarget = resolveTarget({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, source_location: "test-fixtures/admission/missing-evidence/capability.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    const policy = resolvePolicy({
      artifact_resource_id: capabilityArtifact.resource_id!, artifact_resource_type: "CAPABILITY", source_capability_id: capabilityArtifact.capability_id,
      target_capability_id: destination.destination_capability_id, target_class: destination.destination_class,
      task_id: taskId, worker_id: "codex", requested_action: "REGISTER_CAPABILITY",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-f",
    }, { store });
    assert(policy.decision === "ALLOW", `precondition: expected ALLOW, got ${policy.decision}`);
    const input: AdmissionInput = { artifact_resource_id: capabilityArtifact.resource_id!, task_id: taskId, correlation_id: "corr-admission-f", resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: [] };
    const result = evaluateAdmission(input, { store });
    assert(result.decision === "UNRESOLVED", `expected UNRESOLVED, got ${result.decision} (${result.reason_code})`);
    assert(result.reason_code === "EVIDENCE_INCOMPLETE", `expected EVIDENCE_INCOMPLETE, got ${result.reason_code}`);
  });

  // G. Admission never calls Git/GitHub/Vercel/network/process.
  check("G. Admission source calls no Git/GitHub/Vercel/network/child-process API", () => {
    const source = readFileSync(join(process.cwd(), "control/admission/resolver.ts"), "utf8");
    for (const forbidden of ["child_process", "node:child_process", "fetch(", "http.request", "https.request", "simple-git", "octokit", "vercel"]) {
      assert(!source.toLowerCase().includes(forbidden.toLowerCase()), `resolver.ts must never reference ${forbidden}`);
    }
  });

  // H. Admission never re-runs classification/duplicate/destination/target/policy.
  check("H. Admission never re-runs classification/duplicate/destination/target/policy", () => {
    const source = readFileSync(join(process.cwd(), "control/admission/resolver.ts"), "utf8");
    for (const forbidden of ["classifyCandidate(", "resolveDuplicate(", "resolveArtifactDestination(", "resolveTarget(", "resolvePolicy(", "fingerprintCandidate(", "findCapabilityBySemanticFingerprint(", "findResourceByContentHash("]) {
      assert(!source.includes(forbidden), `resolver.ts must never call ${forbidden} — Admission consumes finished results only`);
    }
  });

  // I. Admission evidence/state persists and is retrievable (within-process proof; a real restart is verified live against the running server, not here).
  check("I. Admission result persists as real, retrievable Evidence", () => {
    const { taskId, ingressResult } = makeTaskAndArtifacts("persist-check");
    const capabilityArtifact = ingressResult.artifacts.find((a) => a.resource_type === "CAPABILITY")!;
    const destination = resolveArtifactDestination({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, evidence_ref: "control/admission/tests/admission.test.ts" });
    const resolvedTarget = resolveTarget({ resource_id: capabilityArtifact.resource_id!, resource_type: "CAPABILITY", capability_id: capabilityArtifact.capability_id, source_location: "test-fixtures/admission/persist-check/capability.ts", evidence_ref: "control/admission/tests/admission.test.ts" });
    const policy = resolvePolicy({
      artifact_resource_id: capabilityArtifact.resource_id!, artifact_resource_type: "CAPABILITY", source_capability_id: capabilityArtifact.capability_id,
      target_capability_id: destination.destination_capability_id, target_class: destination.destination_class,
      task_id: taskId, worker_id: "codex", requested_action: "REGISTER_CAPABILITY",
      evidence_refs: ["control/admission/tests/admission.test.ts"], correlation_id: "corr-admission-i",
    }, { store });
    const input: AdmissionInput = { artifact_resource_id: capabilityArtifact.resource_id!, task_id: taskId, correlation_id: "corr-admission-i", resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision, evidence_refs: ["control/admission/tests/admission.test.ts"] };
    const result = evaluateAdmission(input, { store });
    const evidence = loadEvidenceForTask(taskId);
    const match = evidence.find((e) => e.evidence_id === result.admission_id);
    assert(match !== undefined, "expected the admission result to be retrievable via loadEvidenceForTask");
    assert(match!.kind === "admission", `expected kind=admission, got ${match!.kind}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
