/**
 * หน้าที่: proves Source Execution — real Admission, real registry, no
 * mocks. Two suites, matching `connections/github/adapter.test.ts`'s own
 * established convention:
 *
 * 1. OFFLINE — every rejection path (identity/action/path/connection/
 *   credential) plus idempotency and the static no-reprocessing proof.
 *   No real network call ever completes here — this environment genuinely
 *   has no GITHUB_PAT_INFRASTRUCTURE set, so even the "everything is
 *   ready" case honestly stops at CREDENTIAL_NOT_RESOLVED, never faked.
 * 2. LIVE — a real commit, real push, real commit SHA. Runs only when
 *   GITHUB_PAT_INFRASTRUCTURE (and GITHUB_ADAPTER_TEST_OWNER/_REPO/_BRANCH)
 *   are present in the process; otherwise prints "LIVE SUITE SKIPPED —
 *   NOT VERIFIED" and reports itself as not verified — never asserts a
 *   result that was not actually observed.
 *
 * How to run (offline): npx tsx control/source-execution/tests/source-execution.test.ts
 * How to run (live):   GITHUB_PAT_INFRASTRUCTURE=... GITHUB_ADAPTER_TEST_OWNER=... GITHUB_ADAPTER_TEST_REPO=... GITHUB_ADAPTER_TEST_BRANCH=... npx tsx control/source-execution/tests/source-execution.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { saveTask } from "../../agent-gateway/memory-store";
import { loadEvidenceForTask } from "../../agent-gateway/contract";
import { ingestWorkResult } from "../../work-result-ingress/contract";
import type { WorkResultInput } from "../../work-result-ingress/contract";
import { resolveTarget } from "../../target-resolution/contract";
import { resolvePolicy } from "../../permission-policy-resolution/contract";
import { evaluateAdmission } from "../../admission/contract";
import { executeSource } from "../contract";
import type { SourceExecutionInput } from "../contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import type { ConnectionRegistration } from "../../../contracts/connector/connection";
import type { Task, WorkOrder } from "../../agent-gateway/types";

declare const process: { exitCode?: number; cwd(): string; env: Record<string, string | undefined> };
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

/** Builds one real task + one real registered SOURCE_REFERENCE resource + a real RESOLVED target-resolution result (a fixture connected connection, matching target-resolution's own test precedent) + a real ALLOW policy decision + a real ADMITTED admission. Everything downstream of "already real" — never fabricated by this file beyond the same fixture shape target-resolution's own tests already establish as legitimate. */
function admittedFixture(scenario: string) {
  const taskId = `task-source-execution-${scenario}-${uniq}`;
  const workOrder: WorkOrder = {
    operation: "MODIFY", target_type: "FILE", target_path: `test-fixtures/source-execution/${scenario}/target.ts`,
    requested_change: "test fixture", content: "// test fixture\n", workspace_scope: `test-fixtures/source-execution/${scenario}/`,
    mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "source-execution.test.ts", note: "test fixture" }],
  };
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "source-execution test fixture", submitted_by_client: "source-execution.test.ts",
    status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    work_order: workOrder, output_lane: "WORK_ITEM",
  };
  saveTask(task);

  const sourceLocation = `test-fixtures/source-execution/${scenario}/a.ts`;
  // ingestWorkResult (not runRegistrationPipeline directly) so a real
  // handoff exists for worker_id="codex" on this task — Permission/Policy
  // Resolution's WORKER_TASK_MISMATCH check requires one.
  const workResult: WorkResultInput = {
    task_id: taskId, agent_id: "codex", role: "test-fixture", input_reference: `work-order://test-fixture/source-execution-${scenario}`,
    files_read: [], files_changed: [sourceLocation], tests_run: ["npx tsc --noEmit"],
    status: "VERIFIED", evidence_refs: ["control/source-execution/tests/source-execution.test.ts"],
    blockers: [], next_action: null,
  };
  const ingressResult = ingestWorkResult(workResult, { store });
  if (ingressResult.blocker) throw new Error(`fixture setup failed for ${scenario}: ${ingressResult.blocker}`);
  const sourceArtifact = ingressResult.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;
  const artifactResourceId = sourceArtifact.resource_id!;

  const fixtureConnection: ConnectionRegistration = { connection_id: `conn-fixture-${scenario}`, account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "GITHUB_PAT_FIXTURE" }, status: "connected" };
  const resolvedTarget = resolveTarget({ resource_id: artifactResourceId, resource_type: "SOURCE_REFERENCE", capability_id: null, source_location: sourceLocation, evidence_ref: "control/source-execution/tests/source-execution.test.ts" }, { connections: [fixtureConnection] });
  if (resolvedTarget.target_status !== "RESOLVED") throw new Error(`fixture target-resolution failed for ${scenario}: ${resolvedTarget.target_status}`);

  const policy = resolvePolicy({
    artifact_resource_id: artifactResourceId, artifact_resource_type: "SOURCE_REFERENCE", source_capability_id: null,
    target_capability_id: resolvedTarget.destination_capability_id, target_class: resolvedTarget.destination_class,
    task_id: taskId, worker_id: "codex", requested_action: "WRITE_SOURCE",
    evidence_refs: ["control/source-execution/tests/source-execution.test.ts"], correlation_id: `corr-policy-${scenario}`,
  }, { store });
  if (policy.decision !== "ALLOW") throw new Error(`fixture policy failed for ${scenario}: ${policy.decision}`);

  const admission = evaluateAdmission({
    artifact_resource_id: artifactResourceId, task_id: taskId, correlation_id: `corr-admission-${scenario}`,
    resolved_target: resolvedTarget, policy_decision_id: policy.policy_decision_id, policy_decision: policy.decision,
    evidence_refs: ["control/source-execution/tests/source-execution.test.ts"],
  }, { store });
  if (admission.decision !== "ADMITTED") throw new Error(`fixture admission failed for ${scenario}: ${admission.decision} (${admission.reason_code})`);

  return { taskId, artifactResourceId, sourceLocation, resolvedTarget, admission };
}

function baseInput(fixture: ReturnType<typeof admittedFixture>, overrides: Partial<SourceExecutionInput> = {}): SourceExecutionInput {
  const realConnection: ConnectionRegistration = { connection_id: "conn-source-execution-github", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "GITHUB_PAT_INFRASTRUCTURE" }, status: "connected" };
  return {
    admission_id: fixture.admission.admission_id,
    artifact_resource_id: fixture.artifactResourceId,
    task_id: fixture.taskId,
    correlation_id: "corr-execute",
    authorized_action: "WRITE_SOURCE",
    resolved_target: fixture.resolvedTarget,
    source_location: fixture.sourceLocation,
    source_content: "// source-execution test content\n",
    connection: realConnection,
    repository_reference: { owner: "dna-os-infrastructure-test-owner", repo: "dna-os-infrastructure-test-repo", branch: "main" },
    commit_message: "test: source-execution offline test fixture",
    evidence_refs: ["control/source-execution/tests/source-execution.test.ts"],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // A. ADMITTED + valid GitHub target -> execute path allowed all the way
  // to the real, honest external boundary. This process genuinely has no
  // GITHUB_PAT_INFRASTRUCTURE set — the correct, non-fabricated outcome
  // is UNRESOLVED/CREDENTIAL_NOT_RESOLVED, proving every DNA-OS-owned gate
  // (identity/action/path/connection) passed and only the real external
  // credential is missing.
  await (async () => {
    const fixture = admittedFixture("a-admitted");
    const result = await executeSource(baseInput(fixture), { store });
    check("A. ADMITTED + valid GitHub target -> execute path allowed (reaches the real credential boundary honestly)", () => {
      assert(result.execution_status === "UNRESOLVED", `expected UNRESOLVED (no real credential in this environment), got ${result.execution_status}`);
      assert(result.reason_code === "CREDENTIAL_NOT_RESOLVED", `expected CREDENTIAL_NOT_RESOLVED, got ${result.reason_code}`);
      assert(result.commit_sha === null, "expected no commit_sha without a real credential");
    });
  })();

  // B. NOT_ADMITTED -> blocked
  await (async () => {
    const fixture = admittedFixture("b-denied-source");
    // A second, real, DENY policy decision for a different action on the same artifact/task.
    const deniedPolicy = resolvePolicy({
      artifact_resource_id: fixture.artifactResourceId, artifact_resource_type: "SOURCE_REFERENCE", source_capability_id: null,
      target_capability_id: fixture.resolvedTarget.destination_capability_id, target_class: fixture.resolvedTarget.destination_class,
      task_id: fixture.taskId, worker_id: "codex", requested_action: "APPEND_EVIDENCE",
      evidence_refs: ["control/source-execution/tests/source-execution.test.ts"], correlation_id: "corr-b-denied",
    }, { store });
    assert(deniedPolicy.decision === "DENY", `precondition: expected DENY, got ${deniedPolicy.decision}`);
    const notAdmitted = evaluateAdmission({
      artifact_resource_id: fixture.artifactResourceId, task_id: fixture.taskId, correlation_id: "corr-b-not-admitted",
      resolved_target: fixture.resolvedTarget, policy_decision_id: deniedPolicy.policy_decision_id, policy_decision: deniedPolicy.decision,
      evidence_refs: ["control/source-execution/tests/source-execution.test.ts"],
    }, { store });
    assert(notAdmitted.decision === "NOT_ADMITTED", `precondition: expected NOT_ADMITTED, got ${notAdmitted.decision}`);
    const result = await executeSource(baseInput(fixture, { admission_id: notAdmitted.admission_id }), { store });
    check("B. NOT_ADMITTED admission -> blocked (FAILED/NOT_ADMITTED)", () => {
      assert(result.execution_status === "FAILED", `expected FAILED, got ${result.execution_status}`);
      assert(result.reason_code === "NOT_ADMITTED", `expected NOT_ADMITTED, got ${result.reason_code}`);
    });
  })();

  // C. wrong admission/artifact identity -> blocked
  await (async () => {
    const fixtureA = admittedFixture("c-identity-a");
    const fixtureB = admittedFixture("c-identity-b");
    const result = await executeSource(baseInput(fixtureA, { artifact_resource_id: fixtureB.artifactResourceId }), { store });
    check("C. wrong admission/artifact identity -> blocked (FAILED/IDENTITY_MISMATCH)", () => {
      assert(result.execution_status === "FAILED", `expected FAILED, got ${result.execution_status}`);
      assert(result.reason_code === "IDENTITY_MISMATCH", `expected IDENTITY_MISMATCH, got ${result.reason_code}`);
    });
  })();

  // D. unsupported action -> blocked
  await (async () => {
    const fixture = admittedFixture("d-unsupported");
    const result = await executeSource(baseInput(fixture, { authorized_action: "PREPARE_DEPLOYMENT" }), { store });
    check("D. unsupported action -> blocked (FAILED/EXECUTION_NOT_SUPPORTED)", () => {
      assert(result.execution_status === "FAILED", `expected FAILED, got ${result.execution_status}`);
      assert(result.reason_code === "EXECUTION_NOT_SUPPORTED", `expected EXECUTION_NOT_SUPPORTED, got ${result.reason_code}`);
    });
  })();

  // E. missing GitHub connection -> UNRESOLVED
  await (async () => {
    const fixture = admittedFixture("e-no-connection");
    const result = await executeSource(baseInput(fixture, { connection: null }), { store });
    check("E. missing GitHub connection -> UNRESOLVED/GITHUB_CONNECTION_NOT_REGISTERED", () => {
      assert(result.execution_status === "UNRESOLVED", `expected UNRESOLVED, got ${result.execution_status}`);
      assert(result.reason_code === "GITHUB_CONNECTION_NOT_REGISTERED", `expected GITHUB_CONNECTION_NOT_REGISTERED, got ${result.reason_code}`);
    });
  })();

  // F. missing credential -> UNRESOLVED
  await (async () => {
    const fixture = admittedFixture("f-no-credential");
    const wrongChannelConnection: ConnectionRegistration = { connection_id: "conn-wrong-channel", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "SOME_OTHER_ENV_VAR" }, status: "connected" };
    const result = await executeSource(baseInput(fixture, { connection: wrongChannelConnection }), { store });
    check("F. missing/unresolvable credential -> UNRESOLVED/CREDENTIAL_NOT_RESOLVED", () => {
      assert(result.execution_status === "UNRESOLVED", `expected UNRESOLVED, got ${result.execution_status}`);
      assert(result.reason_code === "CREDENTIAL_NOT_RESOLVED", `expected CREDENTIAL_NOT_RESOLVED, got ${result.reason_code}`);
    });
  })();

  // G. invalid source path -> blocked
  await (async () => {
    const fixture = admittedFixture("g-invalid-path");
    const result = await executeSource(baseInput(fixture, { source_location: "../../etc/passwd" }), { store });
    check("G. invalid source path -> blocked (FAILED/INVALID_SOURCE_PATH)", () => {
      assert(result.execution_status === "FAILED", `expected FAILED, got ${result.execution_status}`);
      assert(result.reason_code === "INVALID_SOURCE_PATH", `expected INVALID_SOURCE_PATH, got ${result.reason_code}`);
    });
  })();

  // J. no policy/classification/duplicate/target reprocessing (static source inspection).
  check("J. Source Execution never re-runs classification/duplicate/destination/target/policy", () => {
    const source = readFileSync(join(process.cwd(), "control/source-execution/resolver.ts"), "utf8");
    for (const forbidden of ["classifyCandidate(", "resolveDuplicate(", "resolveArtifactDestination(", "resolveTarget(", "resolvePolicy(", "fingerprintCandidate(", "runRegistrationPipeline(", "commitRegisteredCandidate("]) {
      assert(!source.includes(forbidden), `resolver.ts must never call ${forbidden} — Source Execution consumes finished results only`);
    }
  });

  // L. duplicate execution request -> idempotent, no uncontrolled repeated commits.
  await (async () => {
    const fixture = admittedFixture("l-idempotency");
    const first = await executeSource(baseInput(fixture), { store });
    const second = await executeSource(baseInput(fixture), { store });
    check("L. duplicate execution request for the same admission_id is idempotent — the exact same result is replayed, never re-executed", () => {
      assert(first.execution_id === second.execution_id, `expected the identical execution_id on replay, got ${first.execution_id} vs ${second.execution_id}`);
      assert(first.execution_status === second.execution_status && first.reason_code === second.reason_code, "expected the identical status/reason on replay");
      const evidence = loadEvidenceForTask(fixture.taskId).filter((e) => e.kind === "execution_output");
      assert(evidence.length === 1, `expected exactly one execution_output evidence row for this admission_id despite two calls, got ${evidence.length}`);
    });
  })();

  // H/I/K — LIVE suite: a real commit, real evidence/version persistence,
  // and (for K specifically) verified live against the running server
  // across a restart in the STEP's own live-verification phase, not here.
  const liveToken = process.env.GITHUB_PAT_INFRASTRUCTURE;
  const liveOwner = process.env.GITHUB_ADAPTER_TEST_OWNER;
  const liveRepo = process.env.GITHUB_ADAPTER_TEST_REPO;
  const liveBranch = process.env.GITHUB_ADAPTER_TEST_BRANCH ?? "main";
  if (!liveToken || !liveOwner || !liveRepo) {
    console.log("LIVE SUITE (H, I) SKIPPED — NOT VERIFIED: GITHUB_PAT_INFRASTRUCTURE / GITHUB_ADAPTER_TEST_OWNER / GITHUB_ADAPTER_TEST_REPO not set in this process. No real commit was attempted or claimed.");
  } else {
    await (async () => {
      const fixture = admittedFixture("h-live-commit");
      const liveConnection: ConnectionRegistration = { connection_id: "conn-live-github", account_id: "account-fixture", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: "GITHUB_PAT_INFRASTRUCTURE" }, status: "connected" };
      const result = await executeSource(baseInput(fixture, {
        connection: liveConnection,
        repository_reference: { owner: liveOwner, repo: liveRepo, branch: liveBranch },
        source_location: `test-fixtures/source-execution/live-${uniq}.md`,
        source_content: `# source-execution live test\n\nWritten by control/source-execution/tests/source-execution.test.ts at ${new Date().toISOString()}.\n`,
        commit_message: `test: control/source-execution live verification (${uniq})`,
      }), { store });
      check("H. successful commit returns a real commit SHA", () => {
        assert(result.execution_status === "SUCCEEDED", `expected SUCCEEDED, got ${result.execution_status} (${result.reason_code})`);
        assert(typeof result.commit_sha === "string" && result.commit_sha.length > 0, "expected a real, non-empty commit_sha");
      });
      check("I. commit SHA persisted as evidence/version reference, retrievable", () => {
        const evidence = loadEvidenceForTask(fixture.taskId).find((e) => e.kind === "execution_output" && e.evidence_id === result.execution_id);
        assert(evidence !== undefined, "expected the execution result to be retrievable via loadEvidenceForTask");
        assert((evidence!.payload as typeof result).commit_sha === result.commit_sha, "expected the persisted evidence to carry the real commit_sha");
      });
    })();
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
