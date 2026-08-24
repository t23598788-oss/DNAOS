/**
 * หน้าที่: PHASE 4/5 proof — every terminal branch of
 * ../continuation.ts's `continueRegisteredArtifact()`, the real
 * REGISTERED -> ARTIFACT_DESTINATION -> TARGET_RESOLUTION ->
 * PERMISSION_POLICY_RESOLUTION -> ADMISSION -> (ADMITTED only)
 * SOURCE_EXECUTION continuation. Proves DUPLICATE/self-registry/
 * unresolved-target/DENY/no-content all produce zero source write, and
 * that a genuine ADMITTED decision really invokes `executeSource()` —
 * using a deliberately-unresolvable fake credential so no real GitHub
 * network call is ever made by this test (never risking a real commit
 * to a real repository).
 *
 * Fixture pattern copied from
 * control/permission-policy-resolution/tests/permission-policy-resolution.test.ts
 * (saveTask + ingestWorkResult) and
 * control/target-resolution/tests/target-resolution.test.ts (a
 * real-shaped, connected ConnectionRegistration object, never looked up
 * from a store — exactly what resolveTarget's own contract accepts).
 *
 * How to run: npx tsx control/work-result-ingress/tests/continuation.test.ts
 */

import { saveTask } from "../../agent-gateway/memory-store";
import { ingestWorkResult } from "../contract";
import { continueRegisteredArtifact } from "../contract";
import type { WorkResultInput } from "../contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import type { Task, WorkOrder } from "../../agent-gateway/types";
import type { ConnectionRegistration } from "../../../contracts/connector/connection";

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

const store = createLocalFileStore();
const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const EVIDENCE = "control/work-result-ingress/tests/continuation.test.ts";

// A real-shaped, "connected" GitHub connection — never persisted anywhere,
// exactly the same object-literal-as-context pattern
// control/target-resolution/tests/target-resolution.test.ts already uses.
// The credential_ref names an env var that deliberately does not exist,
// so source-execution's own real credential check honestly fails BEFORE
// any network call is ever attempted — this test never risks a real
// GitHub write.
const fixtureConnection: ConnectionRegistration = {
  connection_id: `conn-continuation-fixture-${uniq}`,
  account_id: "account-continuation-fixture",
  software_id: "dna-os-infrastructure",
  adapter: "github",
  credential_ref: { kind: "env_var", name: `DNA_OS_TEST_NONEXISTENT_ENV_VAR_${uniq}` },
  status: "connected",
  target: { owner: "test-owner-continuation", repository: `test-repo-continuation-${uniq}`, branch: "main" },
};

function makeTask(taskId: string, workOrder: WorkOrder): Task {
  return {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "continuation test fixture",
    submitted_by_client: "continuation.test.ts",
    status: "EXECUTING",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    work_order: workOrder,
    output_lane: "WORK_ITEM",
  };
}

function ingestFixture(taskId: string, filePath: string): ReturnType<typeof ingestWorkResult> {
  const workResult: WorkResultInput = {
    task_id: taskId,
    agent_id: "codex",
    role: "test-fixture",
    input_reference: `work-order://test-fixture/${taskId}`,
    files_read: [],
    files_changed: [filePath],
    tests_run: ["npx tsc --noEmit"],
    status: "VERIFIED",
    evidence_refs: [EVIDENCE],
    blockers: [],
    next_action: null,
  };
  return ingestWorkResult(workResult, { store });
}

async function main() {
  // --- Fixture A: happy scope — the file genuinely falls under the work_order's real workspace_scope, so Policy can genuinely reach ALLOW. ---
  const happyTaskId = `task-continuation-happy-${uniq}`;
  const happyFile = `test-fixtures/continuation/happy-${uniq}/a.ts`;
  saveTask(makeTask(happyTaskId, { operation: "MODIFY", target_type: "FILE", target_path: happyFile, requested_change: "test fixture", content: "// test fixture\n", workspace_scope: `test-fixtures/continuation/happy-${uniq}/`, mode: "sandbox", required_tests: [], forbidden_files: [], evidence: [{ source: EVIDENCE, note: "test fixture" }] }));
  const happyIngress = ingestFixture(happyTaskId, happyFile);
  if (happyIngress.blocker) throw new Error(`happy fixture setup failed: ${happyIngress.blocker}`);
  const happyArtifact = happyIngress.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;
  const testResultCandidateArtifact = happyIngress.artifacts.find((a) => a.resource_type !== "SOURCE_REFERENCE");

  // --- Fixture B: out-of-scope — the file does NOT fall under the work_order's declared workspace_scope, so Policy must DENY (OUTSIDE_WORK_ORDER_SCOPE). ---
  const denyTaskId = `task-continuation-deny-${uniq}`;
  const denyFile = `test-fixtures/continuation/deny-actual-${uniq}/a.ts`;
  saveTask(makeTask(denyTaskId, { operation: "MODIFY", target_type: "FILE", target_path: denyFile, requested_change: "test fixture", content: "// test fixture\n", workspace_scope: `test-fixtures/continuation/deny-scope-DIFFERENT-${uniq}/`, mode: "sandbox", required_tests: [], forbidden_files: [], evidence: [{ source: EVIDENCE, note: "test fixture" }] }));
  const denyIngress = ingestFixture(denyTaskId, denyFile);
  if (denyIngress.blocker) throw new Error(`deny fixture setup failed: ${denyIngress.blocker}`);
  const denyArtifact = denyIngress.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;

  await check("A. a DUPLICATE artifact decision never continues -> NOT_APPLICABLE, zero source write", async () => {
    const duplicateArtifact = { candidate_id: "fake", resource_type: "SOURCE_REFERENCE", decision: "DUPLICATE", resource_id: happyArtifact.resource_id, capability_id: null };
    const result = await continueRegisteredArtifact({ artifact: duplicateArtifact, source_location: happyFile, source_content: "irrelevant", connection: fixtureConnection, task_id: happyTaskId, worker_id: "codex", correlation_id: "corr-a", evidence_refs: [EVIDENCE] }, { store });
    assert(result.stage === "NOT_APPLICABLE", `expected NOT_APPLICABLE, got ${result.stage}: ${result.reason}`);
    assert(result.execution === null, "a DUPLICATE must never reach source execution");
  });

  await check("B. a self-registry destination class (e.g. TEST_RESULT -> EVIDENCE_STORE) stops honestly at ARTIFACT_DESTINATION — the registration itself already completed the real write", async () => {
    assert(testResultCandidateArtifact !== undefined, "fixture must have produced a non-SOURCE_REFERENCE artifact");
    const result = await continueRegisteredArtifact({ artifact: testResultCandidateArtifact!, source_location: happyFile, source_content: null, connection: null, task_id: happyTaskId, worker_id: "codex", correlation_id: "corr-b", evidence_refs: [EVIDENCE] }, { store });
    assert(result.stage === "ARTIFACT_DESTINATION", `expected to stop at ARTIFACT_DESTINATION, got ${result.stage}: ${result.reason}`);
    assert(result.destination !== null && result.destination.destination_class !== "SOURCE_AUTHORITY", "expected a real self-registry destination class");
    assert(result.execution === null, "a self-registry class must never reach source execution");
  });

  await check("C. no real connection supplied -> TARGET_RESOLUTION never resolves, zero source write", async () => {
    const result = await continueRegisteredArtifact({ artifact: happyArtifact, source_location: happyFile, source_content: "irrelevant", connection: null, task_id: happyTaskId, worker_id: "codex", correlation_id: "corr-c", evidence_refs: [EVIDENCE] }, { store });
    assert(result.stage === "TARGET_RESOLUTION", `expected to stop at TARGET_RESOLUTION, got ${result.stage}: ${result.reason}`);
    assert(result.target !== null && result.target.target_status === "TARGET_NOT_RESOLVED", `expected TARGET_NOT_RESOLVED, got ${result.target?.target_status}`);
    assert(result.execution === null, "an unresolved target must never reach source execution");
  });

  await check("D. Policy DENY (real OUTSIDE_WORK_ORDER_SCOPE) -> Admission NOT_ADMITTED, zero source write", async () => {
    const result = await continueRegisteredArtifact({ artifact: denyArtifact, source_location: denyFile, source_content: "irrelevant", connection: fixtureConnection, task_id: denyTaskId, worker_id: "codex", correlation_id: "corr-d", evidence_refs: [EVIDENCE] }, { store });
    assert(result.stage === "ADMISSION", `expected to stop at ADMISSION, got ${result.stage}: ${result.reason}`);
    assert(result.policy !== null && result.policy.decision === "DENY", `expected a real policy DENY, got ${result.policy?.decision}(${result.policy?.reason_codes.join(",")})`);
    assert(result.admission !== null && result.admission.decision === "NOT_ADMITTED", `expected NOT_ADMITTED, got ${result.admission?.decision}`);
    assert(result.execution === null, "DENY must produce zero source write");
  });

  await check("E. ADMITTED but no real source_content supplied -> zero source write, never fabricated", async () => {
    const result = await continueRegisteredArtifact({ artifact: happyArtifact, source_location: happyFile, source_content: null, connection: fixtureConnection, task_id: happyTaskId, worker_id: "codex", correlation_id: "corr-e", evidence_refs: [EVIDENCE] }, { store });
    assert(result.stage === "ADMISSION", `expected to stop at ADMISSION, got ${result.stage}: ${result.reason}`);
    assert(result.admission !== null && result.admission.decision === "ADMITTED", `expected a real ADMITTED decision, got ${result.admission?.decision}(${result.admission?.reason_code})`);
    assert(result.execution === null, "ADMITTED with no real content must still produce zero source write");
  });

  await check("F. REQUIRED PROOF — a genuine ADMITTED decision really invokes executeSource(); a fake, unresolvable credential proves this honestly without any real GitHub network call or commit", async () => {
    const result = await continueRegisteredArtifact({ artifact: happyArtifact, source_location: happyFile, source_content: "// real, safe test content — never actually pushed, see credential_ref\n", connection: fixtureConnection, task_id: happyTaskId, worker_id: "codex", correlation_id: "corr-f", evidence_refs: [EVIDENCE] }, { store });
    assert(result.admission !== null && result.admission.decision === "ADMITTED", `expected a real ADMITTED decision, got ${result.admission?.decision}(${result.admission?.reason_code})`);
    assert(result.execution !== null, "executeSource() must have genuinely been invoked once Admission is real ADMITTED");
    assert(result.execution!.execution_status !== "SUCCEEDED", "this test's credential is deliberately fake — a SUCCEEDED status here would mean a real network call happened, which must never occur in this test");
    assert(result.stage === "SOURCE_EXECUTION", `expected to stop at SOURCE_EXECUTION (honest failure, no real write), got ${result.stage}: ${result.reason}`);
    assert(result.post_commit === null, "post-commit verification must never run without a real successful commit");
    console.log(`    (real, honest executeSource() outcome: ${result.execution!.execution_status}:${result.execution!.reason_code} — proves invocation without a real GitHub write)`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
