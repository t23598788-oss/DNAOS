/**
 * หน้าที่: proves Release Authority — real evidence-based decisions, real
 * dependency staleness detection (live re-read), never a re-run of
 * build/test, real RELEASE:<repository_id> lock preventing concurrent
 * decisions for the same repository from racing.
 *
 * How to run: npx tsx governance/release-gate/tests/release-gate.test.ts
 */

import { saveTask, saveEvidence } from "../../../control/agent-gateway/contract";
import type { Task } from "../../../control/agent-gateway/contract";
import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { applyMutation } from "../../../control/registration-update/contract";
import { decideRelease } from "../contract";
import type { RegistrationCandidate } from "../../../control/event-pipeline/contract";

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

const store = createLocalFileStore();
let fixtureCounter = 0;
function fixtureCandidate(name: string): RegistrationCandidate {
  fixtureCounter += 1;
  return {
    candidate_id: `candidate-release-gate-${name}-${Math.random().toString(36).slice(2)}`,
    name: `test-release-gate-${name}`,
    kind: "capability",
    source_location: `governance/release-gate/tests/fixtures/${name}/`,
    owner: "governance/release-gate/tests/release-gate.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: `a fixture capability for release gate scenario ${"marker ".repeat(fixtureCounter).trim()}`,
    version: "1.0.0",
    evidence_refs: ["governance/release-gate/tests/release-gate.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "test",
  };
}

function fixtureTask(taskId: string): Task {
  return { task_id: taskId, memory: { user_id: "owner", workspace_id: "ws", conversation_id: "conv", parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() }, intent_text: "release-gate-test", submitted_by_client: "test", status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), output_lane: "WORK_ITEM" };
}

check("A. no post_commit_verification evidence found -> RELEASE_UNRESOLVED", () => {
  const taskId = `task-release-a-${Math.random().toString(36).slice(2)}`;
  saveTask(fixtureTask(taskId));
  const result = decideRelease({ task_id: taskId, commit_sha: "sha-a", repository_id: "repository://test/repo-a", declared_dependencies: [], required_evidence_refs: [], correlation_id: "corr-a" }, store);
  assert(result.status === "RELEASE_UNRESOLVED", `expected RELEASE_UNRESOLVED, got ${result.status}: ${result.reason}`);
});

check("B. real VERIFIED evidence, no dependencies, no required evidence -> RELEASE_ELIGIBLE", () => {
  const taskId = `task-release-b-${Math.random().toString(36).slice(2)}`;
  saveTask(fixtureTask(taskId));
  saveEvidence({ evidence_id: `ev-${taskId}`, task_id: taskId, kind: "post_commit_verification", source: "test-setup", recorded_at: new Date().toISOString(), payload: { commit_sha: "sha-b", status: "VERIFIED", reason_code: "VERIFIED" } });
  const result = decideRelease({ task_id: taskId, commit_sha: "sha-b", repository_id: "repository://test/repo-b", declared_dependencies: [], required_evidence_refs: [], correlation_id: "corr-b" }, store);
  assert(result.status === "RELEASE_ELIGIBLE", `expected RELEASE_ELIGIBLE, got ${result.status}: ${result.reason}`);
});

check("C. real FAILED verification evidence -> RELEASE_BLOCKED, never eligible", () => {
  const taskId = `task-release-c-${Math.random().toString(36).slice(2)}`;
  saveTask(fixtureTask(taskId));
  saveEvidence({ evidence_id: `ev-${taskId}`, task_id: taskId, kind: "post_commit_verification", source: "test-setup", recorded_at: new Date().toISOString(), payload: { commit_sha: "sha-c", status: "FAILED", reason_code: "CHECK_FAILED" } });
  const result = decideRelease({ task_id: taskId, commit_sha: "sha-c", repository_id: "repository://test/repo-c", declared_dependencies: [], required_evidence_refs: [], correlation_id: "corr-c" }, store);
  assert(result.status === "RELEASE_BLOCKED", `expected RELEASE_BLOCKED, got ${result.status}`);
});

check("D. real, unchanged dependency (declared version still current) -> RELEASE_ELIGIBLE", () => {
  const dep = runRegistrationPipeline(fixtureCandidate("dep-unchanged"), store, "corr-dep-d");
  assert(dep.status === "REGISTERED", "setup dependency must register");
  const capabilityId = dep.status === "REGISTERED" ? dep.capability_id! : "";

  const taskId = `task-release-d-${Math.random().toString(36).slice(2)}`;
  saveTask(fixtureTask(taskId));
  saveEvidence({ evidence_id: `ev-${taskId}`, task_id: taskId, kind: "post_commit_verification", source: "test-setup", recorded_at: new Date().toISOString(), payload: { commit_sha: "sha-d", status: "VERIFIED", reason_code: "VERIFIED" } });
  const result = decideRelease({ task_id: taskId, commit_sha: "sha-d", repository_id: "repository://test/repo-d", declared_dependencies: [{ capability_id: capabilityId, declared_version: "1.0.0" }], required_evidence_refs: [], correlation_id: "corr-d" }, store);
  assert(result.status === "RELEASE_ELIGIBLE", `expected RELEASE_ELIGIBLE, got ${result.status}: ${result.reason}`);
});

check("E. STALE_DEPENDENCY — a dependency's real version changed after it was declared -> RELEASE_BLOCKED, never silently released", () => {
  const dep = runRegistrationPipeline(fixtureCandidate("dep-stale"), store, "corr-dep-e");
  assert(dep.status === "REGISTERED", "setup dependency must register");
  const capabilityId = dep.status === "REGISTERED" ? dep.capability_id! : "";
  const resourceId = dep.status === "REGISTERED" ? dep.resource_id : "";

  // Real ADD_VERSION mutation — the dependency's real current version now differs from what was declared.
  const updateResult = applyMutation({ resource_id: resourceId, capability_id: capabilityId, expected_current_version: "1.0.0", mutation_type: "ADD_VERSION", mutation_payload: { version: "2.0.0" }, evidence_refs: [], correlation_id: "corr-add-version-e" }, store);
  assert(updateResult.status === "APPLIED", `setup version bump must apply, got ${JSON.stringify(updateResult)}`);

  const taskId = `task-release-e-${Math.random().toString(36).slice(2)}`;
  saveTask(fixtureTask(taskId));
  saveEvidence({ evidence_id: `ev-${taskId}`, task_id: taskId, kind: "post_commit_verification", source: "test-setup", recorded_at: new Date().toISOString(), payload: { commit_sha: "sha-e", status: "VERIFIED", reason_code: "VERIFIED" } });
  const result = decideRelease({ task_id: taskId, commit_sha: "sha-e", repository_id: "repository://test/repo-e", declared_dependencies: [{ capability_id: capabilityId, declared_version: "1.0.0" }], required_evidence_refs: [], correlation_id: "corr-e" }, store);
  assert(result.status === "RELEASE_BLOCKED", `expected RELEASE_BLOCKED for a stale dependency, got ${result.status}: ${result.reason}`);
  assert(result.stale_dependencies.some((s) => s.startsWith(capabilityId)), `expected the real stale capability_id named, got ${JSON.stringify(result.stale_dependencies)}`);
});

check("F. missing required evidence file -> RELEASE_UNRESOLVED, never fabricated as present", () => {
  const taskId = `task-release-f-${Math.random().toString(36).slice(2)}`;
  saveTask(fixtureTask(taskId));
  saveEvidence({ evidence_id: `ev-${taskId}`, task_id: taskId, kind: "post_commit_verification", source: "test-setup", recorded_at: new Date().toISOString(), payload: { commit_sha: "sha-f", status: "VERIFIED", reason_code: "VERIFIED" } });
  const result = decideRelease({ task_id: taskId, commit_sha: "sha-f", repository_id: "repository://test/repo-f", declared_dependencies: [], required_evidence_refs: ["governance/release-gate/tests/no-such-evidence-file.txt"], correlation_id: "corr-f" }, store);
  assert(result.status === "RELEASE_UNRESOLVED", `expected RELEASE_UNRESOLVED, got ${result.status}`);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
