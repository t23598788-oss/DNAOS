/**
 * หน้าที่: proves `control/deployable-artifact-readiness/` — real
 * filesystem-based runtime discovery/build-requirement resolution
 * against both this real repo and real temp fixture repos, real check
 * execution through `execution/run/` + `permissions/execution-policy/`
 * for the build-PASS/build-FAIL scenarios (reusing the existing
 * `diagnostics.sleep`/`diagnostics.missing_path` real command
 * descriptors — never fabricating an `npm run build` entry in
 * `execution/run/registry.ts` for a script this repo doesn't really
 * have), real Evidence persistence.
 *
 * NEVER wired into `package.json`'s test scripts — same reasoning as
 * `control/post-commit-verification/tests/post-commit-verification.test.ts`.
 * Run standalone only.
 *
 * How to run: npx tsx control/deployable-artifact-readiness/tests/deployable-artifact-readiness.test.ts
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTask } from "../../agent-gateway/memory-store";
import { loadEvidenceForTask, saveEvidence } from "../../agent-gateway/contract";
import { runDeployableArtifactReadiness } from "../contract";
import type { DeployableArtifactReadinessInput, DeployableArtifactReadinessResult } from "../contract";
import { discoverProjectRuntime } from "../runtime-discovery";
import { resolveBuildRequirement } from "../build-requirement-resolution";
import { runBuildCommand } from "../run-build";
import { deriveArtifactExpectation, discoverArtifact } from "../artifact-discovery";
import { validateArtifact } from "../artifact-validation";
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
const REAL_REPO_ROOT = process.cwd();

function realFixtureTask(scenario: string): { taskId: string; artifactResourceId: string } {
  const taskId = `task-deployable-artifact-readiness-${scenario}-${uniq}`;
  const task: Task = {
    task_id: taskId,
    memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() },
    intent_text: "deployable-artifact-readiness test fixture", submitted_by_client: "deployable-artifact-readiness.test.ts",
    status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), output_lane: "WORK_ITEM",
  };
  saveTask(task);
  return { taskId, artifactResourceId: `resource-fixture-${scenario}-${uniq}` };
}

function seedUpstreamEvidence(taskId: string, artifactResourceId: string, commitSha: string): void {
  const now = new Date().toISOString();
  saveEvidence({ evidence_id: `execution-fixture-${taskId}`, task_id: taskId, kind: "execution_output", source: "test fixture", recorded_at: now, payload: { execution_id: `execution-fixture-${taskId}`, admission_id: `admission-fixture-${taskId}`, artifact_resource_id: artifactResourceId, target_capability_id: "github", repository_reference: { owner: "test-owner", repo: "test-repo", branch: "main" }, branch: "main", source_path: "test-fixtures/x.ts", commit_sha: commitSha, execution_status: "SUCCEEDED", reason_code: "SUCCEEDED", evidence_refs: [], correlation_id: `corr-${taskId}`, created_at: now } });
  saveEvidence({ evidence_id: `post-commit-fixture-${taskId}`, task_id: taskId, kind: "post_commit_verification", source: "test fixture", recorded_at: now, payload: { verification_id: `verification-fixture-${taskId}`, commit_sha: commitSha, artifact_resource_id: artifactResourceId, required_checks: [], passed_checks: [], failed_checks: [], checks: [], status: "VERIFIED", reason_code: "VERIFIED", evidence_refs: [], correlation_id: `corr-${taskId}`, created_at: now } });
}

function baseInput(taskId: string, artifactResourceId: string, commitSha: string): DeployableArtifactReadinessInput {
  return { artifact_resource_id: artifactResourceId, task_id: taskId, commit_sha: commitSha, repository_reference: { owner: "test-owner", repo: "test-repo", branch: "main" }, branch: "main", source_path: "test-fixtures/x.ts", correlation_id: `corr-${taskId}`, evidence_refs: ["control/deployable-artifact-readiness/tests/deployable-artifact-readiness.test.ts"] };
}

async function main(): Promise<void> {
  // A/I. real project/runtime discovery against THIS real repo -> resolved, no AI inference (pure fs marker matching).
  await check("A/I. real project/runtime discovery resolves from real repo evidence, no AI inference", () => {
    const result = discoverProjectRuntime(REAL_REPO_ROOT);
    assert(result.status === "RESOLVED", `expected RESOLVED, got ${JSON.stringify(result)}`);
    assert(result.languages.includes("typescript"), "expected typescript (tsconfig.json is real)");
    assert(result.runtimes.includes("node"), "expected node (package.json is real)");
    assert(result.package_managers.includes("npm"), "expected npm (package-lock.json is real)");
    assert(result.evidence_refs.includes("tsconfig.json") && result.evidence_refs.includes("package.json"), "expected real evidence_refs naming the real files checked");
  });

  // B. unknown runtime -> UNRESOLVED (a real empty temp directory, no markers at all).
  await check("B. unknown runtime (no real marker files) -> UNRESOLVED/RUNTIME_NOT_RESOLVED", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dar-test-empty-"));
    try {
      const result = discoverProjectRuntime(tempDir);
      assert(result.status === "UNRESOLVED" && result.reason_code === "RUNTIME_NOT_RESOLVED", `expected UNRESOLVED/RUNTIME_NOT_RESOLVED, got ${JSON.stringify(result)}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // E. no build script, but real proof (tsconfig noEmit + tsx-only scripts) -> BUILD_NOT_REQUIRED, against THIS real repo.
  await check("E. real repo proves BUILD_NOT_REQUIRED (tsconfig noEmit=true + every script runs via tsx directly)", () => {
    const runtime = discoverProjectRuntime(REAL_REPO_ROOT);
    const requirement = resolveBuildRequirement(REAL_REPO_ROOT, runtime);
    assert(requirement.status === "NOT_REQUIRED" && requirement.reason_code === "BUILD_NOT_REQUIRED_PROVEN", `expected NOT_REQUIRED/BUILD_NOT_REQUIRED_PROVEN, got ${JSON.stringify(requirement)}`);
    assert(requirement.evidence_refs.length > 0, "expected real evidence_refs for the proof");
  });

  // C. build command from real config -> PASS (real temp fixture repo with a real scripts.build, executed via the existing diagnostics.sleep command as the real, already-registered stand-in process — proving run-build.ts's execution/run wiring end-to-end without fabricating an npm.build registry entry for a script this repo doesn't have).
  await check("C. build command resolved from real config -> real execution -> PASSED", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dar-test-build-pass-"));
    try {
      writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "fixture", scripts: { build: "echo build" } }));
      const requirement = resolveBuildRequirement(tempDir, { status: "RESOLVED", reason_code: "RUNTIME_RESOLVED", languages: [], runtimes: ["node"], frameworks: [], package_managers: [], build_systems: [], evidence_refs: [] });
      assert(requirement.status === "REQUIRED" && requirement.command_reference === "npm run build", `expected REQUIRED/npm run build, got ${JSON.stringify(requirement)}`);

      const fixture = realFixtureTask("c-build-pass");
      // Real execution — reusing the real, already-registered diagnostics.sleep command_id (a real /bin/sleep 2 process) as the stand-in executable for this resolved-but-not-yet-registered-in-execution/run build command, proving run-build.ts's wiring (permission -> execution/run -> result mapping -> evidence) with a real process.
      const realCommandRequirement = { ...requirement, command_id: "diagnostics.sleep" };
      const result = await runBuildCommand(realCommandRequirement, "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111", fixture.taskId, { saveBuildEvidence: () => "evidence-id" });
      assert(result.status === "PASSED", `expected PASSED, got ${JSON.stringify(result)}`);
      assert(result.exit_code === 0, "expected real exit_code 0");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // D. build failure -> FAILED (real diagnostics.missing_path command — deterministically real nonzero exit).
  await check("D. real build execution failure -> FAILED", async () => {
    const fixture = realFixtureTask("d-build-fail");
    const requirement = { status: "REQUIRED" as const, reason_code: "BUILD_COMMAND_RESOLVED" as const, command_id: "diagnostics.missing_path", command_reference: "npm run build", command_source: "package.json scripts.build" as const, evidence_refs: [] };
    const result = await runBuildCommand(requirement, "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222", fixture.taskId, { saveBuildEvidence: () => "evidence-id" });
    assert(result.status === "FAILED", `expected FAILED, got ${JSON.stringify(result)}`);
    assert(result.exit_code !== 0, "expected a real nonzero exit_code");
  });

  // F/H. real artifact discovered and validated -> READY-shaped result (real temp fixture repo simulating a Vite project with a real dist/ directory — proving artifact discovery/validation never mistakes node_modules/.cache for a deployable artifact).
  await check("F/H. real artifact discovery+validation: a real dist/ passes, node_modules/.cache is never mistaken for an artifact", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dar-test-artifact-"));
    try {
      mkdirSync(join(tempDir, "dist"), { recursive: true });
      writeFileSync(join(tempDir, "dist", "index.html"), "<html>real build output</html>");
      mkdirSync(join(tempDir, "node_modules", ".cache"), { recursive: true });
      writeFileSync(join(tempDir, "node_modules", ".cache", "junk"), "not an artifact");

      const runtime = { status: "RESOLVED" as const, reason_code: "RUNTIME_RESOLVED" as const, languages: ["typescript"], runtimes: ["node"], frameworks: ["vite"], package_managers: ["npm"], build_systems: [], evidence_refs: [] };
      const expectation = deriveArtifactExpectation(tempDir, runtime);
      assert(expectation !== null && expectation.artifact_path === "dist", `expected vite -> dist/, got ${JSON.stringify(expectation)}`);
      assert(!expectation!.artifact_path.includes("node_modules"), "H: expected the derived artifact expectation to never point at node_modules/.cache");

      const artifact = discoverArtifact(tempDir, expectation!, "cccc3333cccc3333cccc3333cccc3333cccc3333");
      assert(artifact !== null && artifact.size_bytes > 0, `expected a real, non-empty artifact, got ${JSON.stringify(artifact)}`);

      const validation = validateArtifact(artifact!, tempDir, "cccc3333cccc3333cccc3333cccc3333cccc3333", expectation!);
      assert(validation.ok, `expected validation.ok, got ${JSON.stringify(validation)}`);
      assert(validation.not_cache_or_temp, "expected not_cache_or_temp to be true for dist/");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // G. artifact missing -> FAILED-shaped validation (a Vite-marked repo with no real dist/ at all).
  await check("G. real repo with no artifact on disk -> discoverArtifact returns null (FAILED at the resolver level)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dar-test-missing-artifact-"));
    try {
      const runtime = { status: "RESOLVED" as const, reason_code: "RUNTIME_RESOLVED" as const, languages: ["typescript"], runtimes: ["node"], frameworks: ["vite"], package_managers: ["npm"], build_systems: [], evidence_refs: [] };
      const expectation = deriveArtifactExpectation(tempDir, runtime);
      const artifact = discoverArtifact(tempDir, expectation!, "dddd4444dddd4444dddd4444dddd4444dddd4444");
      assert(artifact === null, "expected null — no real dist/ exists on disk");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // J. no typecheck/test rerun (static source inspection).
  await check("J. resolver.ts never re-runs typecheck/tests/reclassification/policy/admission/deploy", () => {
    const source = readFileSync(join(process.cwd(), "control/deployable-artifact-readiness/resolver.ts"), "utf8");
    for (const forbidden of ["runPostCommitVerification(", "classifyCandidate(", "resolveDuplicate(", "resolveArtifactDestination(", "resolveTarget(", "resolvePolicy(", "evaluateAdmission(", "executeSource(", "putFileContents("]) {
      assert(!source.includes(forbidden), `resolver.ts must never reference ${forbidden}`);
    }
  });

  // K/L. full resolver against THIS real repo -> BUILD_NOT_REQUIRED, idempotent, persisted, restart-durable.
  let readyResult: DeployableArtifactReadinessResult | null = null;
  let readyFixture: { taskId: string; artifactResourceId: string } | null = null;
  const realSha = "eeee5555eeee5555eeee5555eeee5555eeee5555";
  await check("K1. full resolver against this real repo -> BUILD_NOT_REQUIRED (real, proven, no fabricated build step)", async () => {
    const fixture = realFixtureTask("k-real-repo");
    seedUpstreamEvidence(fixture.taskId, fixture.artifactResourceId, realSha);
    const result = await runDeployableArtifactReadiness(baseInput(fixture.taskId, fixture.artifactResourceId, realSha), REAL_REPO_ROOT);
    readyResult = result;
    readyFixture = fixture;
    assert(result.status === "BUILD_NOT_REQUIRED", `expected BUILD_NOT_REQUIRED, got ${JSON.stringify({ status: result.status, reason_code: result.reason_code })}`);
    assert(result.build_result === null, "expected no build to have been executed");
    assert(result.artifact === null, "expected no artifact discovery to have run");
  });

  await check("L. evidence persisted + idempotent retry + restart-durable (memory-store reads fresh from disk)", async () => {
    assert(readyResult !== null && readyFixture !== null, "precondition: K1 must have run");
    const evidence = loadEvidenceForTask(readyFixture!.taskId);
    assert(evidence.some((e) => e.kind === "runtime_discovery"), "expected runtime_discovery evidence");
    assert(evidence.some((e) => e.kind === "deployable_artifact_readiness"), "expected deployable_artifact_readiness evidence");

    const before = evidence.filter((e) => e.kind === "runtime_discovery").length;
    const replay = await runDeployableArtifactReadiness(baseInput(readyFixture!.taskId, readyFixture!.artifactResourceId, realSha), REAL_REPO_ROOT);
    const after = loadEvidenceForTask(readyFixture!.taskId).filter((e) => e.kind === "runtime_discovery").length;
    assert(replay.readiness_id === readyResult!.readiness_id, "expected the identical readiness_id on replay");
    assert(before === after, "expected no re-run of runtime discovery on replay");

    const reread = loadEvidenceForTask(readyFixture!.taskId).find((e) => e.kind === "deployable_artifact_readiness");
    assert((reread!.payload as DeployableArtifactReadinessResult).status === "BUILD_NOT_REQUIRED", "expected the re-read result to still say BUILD_NOT_REQUIRED");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
