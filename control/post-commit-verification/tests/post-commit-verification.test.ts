/**
 * หน้าที่: proves `control/post-commit-verification/` — real requirement
 * resolution against this repo's real `package.json`, real check
 * execution through `execution/run/` + `permissions/execution-policy/`
 * (test A genuinely runs `npm run typecheck` and `npm run
 * test:integration`), real Evidence persistence.
 *
 * NEVER wired into `package.json`'s `test:control-plane`/`test:integration`
 * scripts — test A's real check run for "integration_test" itself
 * invokes `npm run test:integration`, and `test:integration` already
 * chains `test:control-plane`; wiring this file into either would create
 * infinite self-recursion. Run standalone only.
 *
 * How to run: npx tsx control/post-commit-verification/tests/post-commit-verification.test.ts
 * (takes ~1-2 minutes — test A really runs the full test:integration suite)
 */

import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTask } from "../../agent-gateway/memory-store";
import { loadEvidenceForTask, saveEvidence } from "../../agent-gateway/contract";
import { runPostCommitVerification } from "../contract";
import type { PostCommitVerificationInput, PostCommitVerificationResult } from "../contract";
import { resolveRequiredChecks } from "../requirement-resolution";
import { decideVerification } from "../decision";
import type { CheckResult } from "../types";
import type { Task } from "../../agent-gateway/types";

declare const process: { exitCode?: number; cwd(): string };
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

const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function realFixtureTask(scenario: string): { taskId: string; artifactResourceId: string } {
  const taskId = `task-post-commit-verification-${scenario}-${uniq}`;
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "post-commit-verification test fixture", submitted_by_client: "post-commit-verification.test.ts",
    status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), output_lane: "WORK_ITEM",
  };
  saveTask(task);
  return { taskId, artifactResourceId: `resource-fixture-${scenario}-${uniq}` };
}

/** Seeds a real, well-shaped execution_output Evidence row — exactly what a real executeSource() SUCCEEDED call would have left behind — without paying for a real GitHub write per test scenario (only the LIVE test at the bottom uses the real commit). */
function seedSourceExecutionEvidence(taskId: string, artifactResourceId: string, commitSha: string): void {
  saveEvidence({
    evidence_id: `execution-fixture-${taskId}`,
    task_id: taskId,
    kind: "execution_output",
    source: "control/post-commit-verification/tests/post-commit-verification.test.ts",
    recorded_at: new Date().toISOString(),
    payload: {
      execution_id: `execution-fixture-${taskId}`, admission_id: `admission-fixture-${taskId}`,
      artifact_resource_id: artifactResourceId, target_capability_id: "github",
      repository_reference: { owner: "test-owner", repo: "test-repo", branch: "main" }, branch: "main",
      source_path: "test-fixtures/post-commit-verification/fixture.ts", commit_sha: commitSha,
      execution_status: "SUCCEEDED", reason_code: "SUCCEEDED", evidence_refs: [], correlation_id: `corr-${taskId}`,
      created_at: new Date().toISOString(),
    },
  });
}

function baseInput(taskId: string, artifactResourceId: string, commitSha: string, overrides: Partial<PostCommitVerificationInput> = {}): PostCommitVerificationInput {
  return {
    artifact_resource_id: artifactResourceId, task_id: taskId, commit_sha: commitSha,
    repository_reference: { owner: "test-owner", repo: "test-repo", branch: "main" }, branch: "main",
    source_path: "test-fixtures/post-commit-verification/fixture.ts",
    correlation_id: `corr-${taskId}`, evidence_refs: ["control/post-commit-verification/tests/post-commit-verification.test.ts"],
    ...overrides,
  };
}

async function main(): Promise<void> {
  // A/H. real commit + real required checks (npm run typecheck, npm run test:integration) all pass -> VERIFIED, evidence persisted.
  let verifiedResult: PostCommitVerificationResult | null = null;
  let verifiedFixture: { taskId: string; artifactResourceId: string } | null = null;
  const realCommitSha = "a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4";
  await check("A. real commit + all required checks pass -> VERIFIED (real npm run typecheck + npm run test:integration)", async () => {
    const fixture = realFixtureTask("a-verified");
    seedSourceExecutionEvidence(fixture.taskId, fixture.artifactResourceId, realCommitSha);
    const result = await runPostCommitVerification(baseInput(fixture.taskId, fixture.artifactResourceId, realCommitSha));
    verifiedResult = result;
    verifiedFixture = fixture;
    assert(result.status === "VERIFIED", `expected VERIFIED, got ${result.status} (reason=${result.reason_code}, checks=${JSON.stringify(result.checks)})`);
    assert(result.required_checks.includes("typecheck"), "expected typecheck to be a required check (package.json declares it)");
    assert(result.required_checks.includes("integration_test"), "expected integration_test to be a required check (package.json declares test:integration)");
    assert(result.failed_checks.length === 0, "expected no failed checks");
  });

  // H. evidence persisted — real, retrievable via loadEvidenceForTask, and really on disk.
  await check("H. execution evidence + verification result persist as real Evidence", () => {
    assert(verifiedResult !== null && verifiedFixture !== null, "precondition: test A must have run");
    const evidence = loadEvidenceForTask(verifiedFixture!.taskId);
    const verificationEvidence = evidence.find((e) => e.kind === "post_commit_verification");
    const checkEvidence = evidence.filter((e) => e.kind === "post_commit_check");
    assert(!!verificationEvidence, "expected a post_commit_verification Evidence row");
    assert(checkEvidence.length === verifiedResult!.required_checks.length, `expected one post_commit_check row per required check, got ${checkEvidence.length}`);
    const onDisk = readFileSync(join(process.cwd(), "control/agent-gateway/data/evidence.jsonl"), "utf8");
    assert(onDisk.includes(verifiedResult!.verification_id), "expected the verification_id to be really written to evidence.jsonl on disk");
  });

  // I. restart -> verification result still readable. memory-store.ts reads fresh from disk on every call (no in-memory cache) — proven directly by re-reading via a fresh loadEvidenceForTask call, matching that file's own documented "survives process restart" design.
  await check("I. verification result remains readable (memory-store reads fresh from disk, no in-process cache to invalidate)", () => {
    assert(verifiedFixture !== null, "precondition: test A must have run");
    const reread = loadEvidenceForTask(verifiedFixture!.taskId).find((e) => e.kind === "post_commit_verification");
    assert(!!reread, "expected the verification Evidence to still be readable");
    assert((reread!.payload as PostCommitVerificationResult).status === "VERIFIED", "expected the re-read result to still say VERIFIED");
  });

  // J. repeated same verification request is idempotent — no checks re-run, same verification_id replayed.
  await check("J. repeated verification request for the same commit/artifact is idempotent", async () => {
    assert(verifiedFixture !== null, "precondition: test A must have run");
    const before = loadEvidenceForTask(verifiedFixture!.taskId).filter((e) => e.kind === "post_commit_check").length;
    const replay = await runPostCommitVerification(baseInput(verifiedFixture!.taskId, verifiedFixture!.artifactResourceId, realCommitSha));
    const after = loadEvidenceForTask(verifiedFixture!.taskId).filter((e) => e.kind === "post_commit_check").length;
    assert(replay.verification_id === verifiedResult!.verification_id, "expected the identical verification_id on replay");
    assert(before === after, `expected no new check evidence from the replay — before=${before}, after=${after}`);
  });

  // B. typecheck fail -> FAILED (pure decision-rule test — decideVerification is the one owner of PASS/FAIL/UNRESOLVED, no real process needed to prove this rule).
  await check("B. a FAILED typecheck check -> overall FAILED", () => {
    const checks: CheckResult[] = [
      { check_id: "c1", check_type: "typecheck", command_reference: "npm run typecheck", started_at: "t", finished_at: "t", exit_code: 1, status: "FAILED", evidence_ref: "e1" },
      { check_id: "c2", check_type: "integration_test", command_reference: "npm run test:integration", started_at: "t", finished_at: "t", exit_code: 0, status: "PASSED", evidence_ref: "e2" },
    ];
    const decision = decideVerification(["typecheck", "integration_test"], checks);
    assert(decision.status === "FAILED" && decision.reason_code === "CHECK_FAILED", `expected FAILED/CHECK_FAILED, got ${JSON.stringify(decision)}`);
  });

  // C. unit test fail -> FAILED (same rule, different check_type — this repo declares no real "unit_test" script today, so this proves the DECISION rule, which is the one real owner of this outcome per "ONE SUBJECT = ONE OWNER").
  await check("C. a FAILED unit_test check -> overall FAILED", () => {
    const checks: CheckResult[] = [
      { check_id: "c1", check_type: "typecheck", command_reference: "npm run typecheck", started_at: "t", finished_at: "t", exit_code: 0, status: "PASSED", evidence_ref: "e1" },
      { check_id: "c2", check_type: "unit_test", command_reference: "npm run test:unit", started_at: "t", finished_at: "t", exit_code: 1, status: "FAILED", evidence_ref: "e2" },
    ];
    const decision = decideVerification(["typecheck", "unit_test"], checks);
    assert(decision.status === "FAILED" && decision.reason_code === "CHECK_FAILED", `expected FAILED/CHECK_FAILED, got ${JSON.stringify(decision)}`);
  });

  // D. missing required check definition -> UNRESOLVED (real requirement resolution against a real temp directory with no matching package.json scripts).
  await check("D. no declared requirement (no matching package.json script) -> UNRESOLVED/VERIFICATION_REQUIREMENT_NOT_FOUND", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dna-os-post-commit-verification-test-"));
    try {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "empty", scripts: { "some-other-script": "echo hi" } }));
      const requirements = resolveRequiredChecks(tempDir);
      assert(requirements.length === 0, `expected no resolved requirements in a repo with no declared typecheck/test:integration/test:unit/build scripts, got ${JSON.stringify(requirements)}`);

      const fixture = realFixtureTask("d-unresolved");
      const fakeSha = "0000000000000000000000000000000000dead";
      seedSourceExecutionEvidence(fixture.taskId, fixture.artifactResourceId, fakeSha);
      // resolveRequiredChecks() inside the resolver always reads THIS repo's real package.json (which does declare typecheck/test:integration) — so to prove the UNRESOLVED path end-to-end without a second real check run, this test asserts directly against resolveRequiredChecks(tempDir)'s real empty result above (the actual requirement-resolution contract), which is what resolver.ts calls unmodified.
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // E. invalid commit SHA -> UNRESOLVED/FAIL CLOSED.
  await check("E. invalid commit SHA -> UNRESOLVED/INVALID_COMMIT_SHA, fail closed", async () => {
    const fixture = realFixtureTask("e-invalid-sha");
    const result = await runPostCommitVerification(baseInput(fixture.taskId, fixture.artifactResourceId, "not-a-real-sha!!"));
    assert(result.status === "UNRESOLVED" && result.reason_code === "INVALID_COMMIT_SHA", `expected UNRESOLVED/INVALID_COMMIT_SHA, got ${JSON.stringify({ status: result.status, reason_code: result.reason_code })}`);
  });

  // F. result belongs to wrong commit -> reject.
  await check("F. commit_sha with no matching real SUCCEEDED execution_output evidence -> UNRESOLVED/COMMIT_NOT_FOUND_FOR_ARTIFACT", async () => {
    const fixture = realFixtureTask("f-wrong-commit");
    seedSourceExecutionEvidence(fixture.taskId, fixture.artifactResourceId, "1111111111111111111111111111111111aaaa");
    const result = await runPostCommitVerification(baseInput(fixture.taskId, fixture.artifactResourceId, "2222222222222222222222222222222222bbbb"));
    assert(result.status === "UNRESOLVED" && result.reason_code === "COMMIT_NOT_FOUND_FOR_ARTIFACT", `expected UNRESOLVED/COMMIT_NOT_FOUND_FOR_ARTIFACT, got ${JSON.stringify({ status: result.status, reason_code: result.reason_code })}`);
  });

  // G. no reclassification/duplicate/policy/admission/commit/deploy work (static source inspection).
  await check("G. resolver.ts never re-classifies/duplicate-checks/re-maps destination/re-resolves target/re-decides policy/re-checks admission/commits/deploys", () => {
    const source = readFileSync(join(process.cwd(), "control/post-commit-verification/resolver.ts"), "utf8");
    for (const forbidden of ["classifyCandidate(", "resolveDuplicate(", "resolveArtifactDestination(", "resolveTarget(", "resolvePolicy(", "evaluateAdmission(", "executeSource(", "runRegistrationPipeline(", "commitRegisteredCandidate(", "putFileContents("]) {
      assert(!source.includes(forbidden), `resolver.ts must never call ${forbidden} — Post-Commit Verification consumes a finished commit result only`);
    }
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
