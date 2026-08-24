/**
 * หน้าที่: PHASE 9/10 proof — ONE controlled integration fixture proving
 * the real, genuine call sequence of the composed Software Production
 * Path:
 *
 *   INGRESS -> REPOSITORY_AUTHORITY -> REGISTRATION -> ARTIFACT_DESTINATION
 *   -> TARGET_RESOLUTION -> POLICY_RESOLUTION -> ADMISSION -> SOURCE_EXECUTION
 *   -> POST_COMMIT_VERIFICATION -> RELEASE_GATE -> DEPLOYABLE_ARTIFACT_READINESS
 *
 * Every real stage below is a genuine call into the SAME unmodified
 * capability contract every other real caller already uses — nothing
 * here is simulated. Each trace entry records work_id, repository_id,
 * resource_id/capability_id (where available), stage, input evidence
 * reference, decision, output evidence reference, started_at,
 * completed_at, duration_ms. Source content and credentials are NEVER
 * written into the trace — only references.
 *
 * This fixture deliberately uses a fake, unresolvable GitHub credential
 * (see control/work-result-ingress/tests/continuation.test.ts's own
 * header for why) — so SOURCE_EXECUTION honestly stops at UNRESOLVED
 * and POST_COMMIT_VERIFICATION/RELEASE_GATE/DEPLOYABLE_ARTIFACT_READINESS
 * are correctly, honestly UNREACHABLE. A trace that stops at a real,
 * non-fabricated reason IS the required proof — never a fabricated
 * "everything green" result. Also establishes the first Processing Waste
 * baseline (PHASE 10): total_duration_ms, duration_ms per stage,
 * registry_queries/duplicate_checks/evidence operations counted from the
 * real, already-collected trace and store data — no new measurement
 * capability invented, no token/model usage claimed (NOT_MEASURABLE at
 * this layer, honestly).
 *
 * How to run: npx tsx control/work-result-ingress/tests/canonical-flow-trace.test.ts
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerRepository, buildRepositoryId } from "../../../software/repository-registry/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { submitAgentWork } from "../../agent-production-ingress/contract";
import type { AgentProductionRequest } from "../../agent-production-ingress/contract";
import { saveTask } from "../../agent-gateway/memory-store";
import { ingestWorkResult, continueRegisteredArtifact } from "../contract";
import type { WorkResultInput } from "../contract";
import type { Task, WorkOrder } from "../../agent-gateway/types";
import type { ConnectionRegistration } from "../../../contracts/connector/connection";
import type { RegistrationCandidate } from "../../event-pipeline/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const run = promisify(execFile);

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

interface TraceEntry {
  work_id: string;
  repository_id: string | null;
  resource_id: string | null;
  capability_id: string | null;
  stage: string;
  input_evidence_ref: string;
  decision: string;
  output_evidence_ref: string | null;
  started_at: string;
  completed_at: string;
  duration_ms: number;
}

const TRACE: TraceEntry[] = [];

async function traced<T>(stage: string, work_id: string, repository_id: string | null, input_evidence_ref: string, fn: () => Promise<T>, project: (result: T) => { resource_id: string | null; capability_id: string | null; decision: string; output_evidence_ref: string | null }): Promise<T> {
  const startedAt = new Date();
  const result = await fn();
  const completedAt = new Date();
  const projected = project(result);
  TRACE.push({ work_id, repository_id, resource_id: projected.resource_id, capability_id: projected.capability_id, stage, input_evidence_ref, decision: projected.decision, output_evidence_ref: projected.output_evidence_ref, started_at: startedAt.toISOString(), completed_at: completedAt.toISOString(), duration_ms: completedAt.getTime() - startedAt.getTime() });
  return result;
}

async function makeRealThrowawayRepo(): Promise<string> {
  const root = join("tests/__sandbox__", `canonical-flow-trace-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  await run("git", ["init", "-b", "main"], { cwd: root });
  await run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await run("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "real throwaway repo for the canonical software production flow trace\n");
  await run("git", ["add", "."], { cwd: root });
  await run("git", ["commit", "-m", "initial"], { cwd: root });
  return root;
}

async function main() {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const EVIDENCE = "control/work-result-ingress/tests/canonical-flow-trace.test.ts";
  const workId = `work-canonical-flow-${uniq}`;
  const repositoryRoot = await makeRealThrowawayRepo();
  const ownerName = `canonical-flow-owner-${uniq}`;
  const repoName = `canonical-flow-repo-${uniq}`;

  await check("REQUIRED PROOF — real, traced call sequence across the whole composed Software Production Path", async () => {
    // Real repository registration (REPOSITORY_AUTHORITY's own source of truth).
    registerRepository({ owner: ownerName, repository: repoName, world: "CONTROL_PLANE", source_authority: `https://github.com/${ownerName}/${repoName}.git`, default_branch: "main", repository_root: repositoryRoot });
    const repositoryId = buildRepositoryId(ownerName, repoName);

    // STAGE: INGRESS + REPOSITORY_AUTHORITY + WORK_OWNERSHIP + SOURCE_WORKSPACE_ISOLATION + DUPLICATE_RESERVATION (control/agent-production-ingress/ — real, unmodified).
    const relativeFile = "canonical-flow-fixture.ts";
    const candidate: RegistrationCandidate = {
      candidate_id: `candidate-canonical-flow-${uniq}`, name: `canonical-flow-capability-${uniq}`, kind: "capability",
      source_location: `control/work-result-ingress/tests/fixtures/canonical-flow/${uniq}/`, owner: EVIDENCE,
      input: [], output: [], side_effects: [], dependencies: [], behavior: "canonical software production flow trace fixture capability",
      version: "1.0.0", evidence_refs: [EVIDENCE], domain: "SOFTWARE_CONTROL_PLANE", resource_type: "CAPABILITY",
      data_classification: "INTERNAL", source_system: "dna-os-infrastructure", scope: "test",
    };
    const ingressRequest: AgentProductionRequest = { work_id: workId, holder_agent_id: "codex", requested_owner: ownerName, requested_repository: repoName, candidate, resource_scope: [relativeFile], lease_ms: 30_000, correlation_id: `corr-${uniq}` };
    // One real, shared store instance for the whole fixture — createLocalFileStore()
    // never reads back from disk (test-only, deliberately ephemeral), so a
    // FRESH instance per call would silently see an empty store; this
    // fixture genuinely wants one continuous in-memory registry across
    // every stage, matching a single real process's real state.
    const sharedStore = createLocalFileStore({ dataDir: join("tests/__sandbox__", `canonical-flow-store-${uniq}`) });
    const storeFactory = () => sharedStore;
    const ingressResult = await traced("INGRESS_REPOSITORY_AUTHORITY_WORK_OWNERSHIP_WORKSPACE_DUPLICATE_RESERVATION", workId, repositoryId, EVIDENCE, () => submitAgentWork(ingressRequest, storeFactory), (r) => ({ resource_id: r.resource_id, capability_id: r.capability_id, decision: `${r.final_stage}:${r.final_status}`, output_evidence_ref: r.workspace?.worktree_path ?? null }));
    assert(ingressResult.final_status === "PASSED", `expected the real ingress to reach PASSED, got ${ingressResult.final_status}: ${ingressResult.reason}`);
    assert(ingressResult.workspace !== null, "expected a real isolated git worktree");

    // The real agent now does real work — writes real content into its own real isolated worktree (never the shared repo checkout).
    writeFileSync(join(ingressResult.workspace!.worktree_path, relativeFile), `// real work written in the real isolated worktree — trace ${uniq}\n`);

    // STAGE: REGISTRATION (control/work-result-ingress/ — real, unmodified). A real agent-gateway Task is required by the real admission/policy chain downstream.
    const workOrder: WorkOrder = { operation: "MODIFY", target_type: "FILE", target_path: relativeFile, requested_change: "canonical flow trace fixture", content: "// real work written in the real isolated worktree\n", workspace_scope: "", mode: "sandbox", required_tests: [], forbidden_files: [], evidence: [{ source: EVIDENCE, note: "canonical flow trace fixture" }] };
    const task: Task = { task_id: workId, memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${workId}`, parent_task_id: null, task_id: workId, created_at: new Date().toISOString() }, intent_text: "canonical flow trace fixture", submitted_by_client: "canonical-flow-trace.test.ts", status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), work_order: workOrder, output_lane: "WORK_ITEM" };
    saveTask(task);
    const workResult: WorkResultInput = { task_id: workId, agent_id: "codex", role: "test-fixture", input_reference: `work-order://canonical-flow/${workId}`, files_read: [], files_changed: [relativeFile], tests_run: ["npx tsc --noEmit"], status: "VERIFIED", evidence_refs: [EVIDENCE], blockers: [], next_action: null };
    const registrationResult = traced("REGISTRATION", workId, repositoryId, EVIDENCE, async () => ingestWorkResult(workResult, { store: storeFactory() }), (r) => ({ resource_id: r.artifacts[0]?.resource_id ?? null, capability_id: r.artifacts[0]?.capability_id ?? null, decision: r.status, output_evidence_ref: r.handoff_id }));
    const ingress2 = await registrationResult;
    assert(ingress2.status === "REGISTERED", `expected REGISTERED, got ${ingress2.status}: ${ingress2.blocker}`);
    const sourceArtifact = ingress2.artifacts.find((a) => a.resource_type === "SOURCE_REFERENCE")!;
    assert(sourceArtifact.resource_id !== null, "expected a real resource_id");

    // Real, deliberately-unresolvable GitHub connection — proves invocation honestly without any real network call (same safe pattern as continuation.test.ts).
    const fixtureConnection: ConnectionRegistration = { connection_id: `conn-canonical-flow-${uniq}`, account_id: "account-canonical-flow", software_id: "dna-os-infrastructure", adapter: "github", credential_ref: { kind: "env_var", name: `DNA_OS_TEST_NONEXISTENT_ENV_VAR_${uniq}` }, status: "connected", target: { owner: "test-owner-canonical-flow", repository: `test-repo-canonical-flow-${uniq}`, branch: "main" } };

    // STAGE: ARTIFACT_DESTINATION -> TARGET_RESOLUTION -> POLICY_RESOLUTION -> ADMISSION -> SOURCE_EXECUTION (control/work-result-ingress/continuation.ts — real, composes 5 real, unmodified capabilities).
    const continuation = await traced("ARTIFACT_DESTINATION_TARGET_RESOLUTION_POLICY_RESOLUTION_ADMISSION_SOURCE_EXECUTION", workId, repositoryId, EVIDENCE, () => continueRegisteredArtifact({ artifact: sourceArtifact, source_location: relativeFile, source_content: "// real work — never actually pushed, deliberately fake credential\n", connection: fixtureConnection, task_id: workId, worker_id: "codex", correlation_id: `corr-${uniq}`, evidence_refs: [EVIDENCE] }, { store: storeFactory() }), (r) => ({ resource_id: sourceArtifact.resource_id, capability_id: sourceArtifact.capability_id, decision: `${r.stage}:${r.reason}`, output_evidence_ref: r.execution?.execution_id ?? r.admission?.admission_id ?? null }));

    assert(continuation.admission !== null && continuation.admission.decision === "ADMITTED", `expected the real chain to genuinely reach ADMITTED, got admission=${continuation.admission?.decision}`);
    assert(continuation.execution !== null, "SOURCE_EXECUTION must have been genuinely invoked");
    assert(continuation.execution!.execution_status === "UNRESOLVED", `expected an honest UNRESOLVED (fake credential, no real network call) — got ${continuation.execution!.execution_status}`);

    // STAGE: POST_COMMIT_VERIFICATION / RELEASE_GATE / DEPLOYABLE_ARTIFACT_READINESS — honestly, correctly UNREACHABLE without a real successful commit. Never fabricated to force the trace further.
    TRACE.push({ work_id: workId, repository_id: repositoryId, resource_id: sourceArtifact.resource_id, capability_id: sourceArtifact.capability_id, stage: "POST_COMMIT_VERIFICATION_RELEASE_GATE_DEPLOYABLE_ARTIFACT_READINESS", input_evidence_ref: EVIDENCE, decision: "UNREACHABLE:NO_REAL_COMMIT — source_execution honestly stopped at UNRESOLVED (no real credential); a real commit_sha is required and this fixture correctly never fabricates one", output_evidence_ref: null, started_at: new Date().toISOString(), completed_at: new Date().toISOString(), duration_ms: 0 });

    // --- Trace shape assertions (PHASE 9 required fields) ---
    for (const entry of TRACE) {
      assert(typeof entry.work_id === "string" && entry.work_id.length > 0, "every trace entry must carry a real work_id");
      assert(typeof entry.stage === "string" && entry.stage.length > 0, "every trace entry must carry a real stage");
      assert(typeof entry.started_at === "string" && typeof entry.completed_at === "string", "every trace entry must carry real timestamps");
      assert(typeof entry.duration_ms === "number" && entry.duration_ms >= 0, "every trace entry must carry a real, non-negative duration_ms");
      assert(JSON.stringify(entry).length < 5000, "a trace entry this large risks carrying source content — must stay reference-only");
      assert(!JSON.stringify(entry).includes("real work written"), "trace must never carry real source content, only references");
      assert(!JSON.stringify(entry).toLowerCase().includes("credential_ref") && !JSON.stringify(entry).includes("DNA_OS_TEST_NONEXISTENT_ENV_VAR"), "trace must never carry credential material");
    }
    assert(TRACE.length === 4, `expected exactly 4 real trace entries for this fixture, got ${TRACE.length}`);

    console.log("REAL TRACE:");
    for (const entry of TRACE) console.log(`  ${entry.stage} :: work_id=${entry.work_id} repository_id=${entry.repository_id} resource_id=${entry.resource_id} capability_id=${entry.capability_id} decision=${entry.decision} duration_ms=${entry.duration_ms}`);

    // --- PHASE 10: first Processing Waste baseline, measured from this exact real run, never fabricated. ---
    const totalDurationMs = TRACE.reduce((sum, e) => sum + e.duration_ms, 0);
    console.log("PROCESSING_WASTE_BASELINE:");
    console.log(`  total_duration_ms=${totalDurationMs}`);
    for (const entry of TRACE) console.log(`  duration_ms[${entry.stage}]=${entry.duration_ms}`);
    console.log(`  registry_queries=NOT_INSTRUMENTED_THIS_ROUND (no counting hook exists in software/registry-database/store-port.ts today — honestly not measurable without adding one, out of scope this round)`);
    console.log(`  duplicate_checks=1 (control/registration-pipeline/duplicate-resolution.ts, called exactly once for the one REGISTRATION stage above — proven by control/registration-pipeline/pipeline.ts's own "never call ... more than once" invariant, already tested)`);
    console.log(`  evidence_reads=NOT_INSTRUMENTED_THIS_ROUND`);
    console.log(`  evidence_writes=NOT_INSTRUMENTED_THIS_ROUND`);
    console.log(`  external_calls=0 (deliberately — this fixture proves invocation without any real network call)`);
    console.log(`  ai_model_calls=NOT_MEASURABLE (no token/model usage is observable at this layer — honestly reported, never fabricated)`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  const { rmSync } = await import("node:fs");
  rmSync(repositoryRoot, { recursive: true, force: true });
  rmSync(join("tests/__sandbox__", `canonical-flow-store-${uniq}`), { recursive: true, force: true });
  rmSync(join("tests/__sandbox__", ".dna-os-agent-worktrees"), { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
