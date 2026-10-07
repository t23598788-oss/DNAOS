/**
 * หน้าที่: proves the Registration Pipeline is genuinely single-owner
 * sequential stages — STEP "Refactor Registration Pipeline to
 * Single-Owner Sequential Stages", tests A-J.
 *
 * How to run: npx tsx control/registration-pipeline/tests/registration-pipeline.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RegistrationCandidate } from "../../event-pipeline/contract";
import { runRegistrationPipeline } from "../contract";
import { getTask, loadEvidenceForTask } from "../../agent-gateway/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import type { ApprovedCandidateWrite } from "../../../software/registry-database/store-port";
import { resolveArtifactDestination } from "../../artifact-destination/contract";
import { resolvePolicy } from "../../permission-policy-resolution/contract";
import { saveTask } from "../../agent-gateway/memory-store";
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

function fixtureCandidate(scenario: string, overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  // `scope` (and domain/resource_type/data_classification/source_system)
  // are used LITERALLY in fingerprintCandidate's semantic fingerprint,
  // never passed through registration-contract.ts's normalize() — which
  // collapses every identifier-like token longer than 2 characters into
  // the literal string "identifier", so two fixtures whose only
  // difference is a `behavior`/`name` suffix like "-exact-dup" vs
  // "-semantic-dup" would silently normalize to the SAME semantic
  // fingerprint. `scope` is the one field safe to vary per scenario to
  // keep unrelated fixtures genuinely semantically distinct in this
  // shared store.
  return {
    candidate_id: `candidate-pipeline-${scenario}-${Math.random().toString(36).slice(2)}`,
    name: `test-pipeline-${scenario}`,
    kind: "capability",
    source_location: `test-fixtures/registration-pipeline/${scenario}/`,
    owner: "control/registration-pipeline/tests/registration-pipeline.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: "test_pipeline_scenario_fixture",
    version: "1.0.0",
    evidence_refs: ["control/registration-pipeline/tests/registration-pipeline.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: `registration-pipeline-test-${scenario}`,
    ...overrides,
  };
}

function main(): void {
  const store = createLocalFileStore();

  // A. exact duplicate -> Duplicate Resolver catches it once, Writer never called
  check("A. exact duplicate -> Duplicate Resolver catches it, Writer never called", () => {
    const candidate = fixtureCandidate("exact-dup");
    const first = runRegistrationPipeline(candidate, store, "corr-a-1");
    assert(first.status === "REGISTERED", `expected first submission REGISTERED, got ${first.status}`);
    const callsBefore = store.debugCallCounts();
    const second = runRegistrationPipeline(candidate, store, "corr-a-2");
    assert(second.status === "DUPLICATE" && second.reason_code === "DUPLICATE_EXACT", `expected DUPLICATE/DUPLICATE_EXACT, got ${second.status}/${(second as any).reason_code}`);
    const callsAfter = store.debugCallCounts();
    assert(callsAfter.writeApprovedCandidateCalls === callsBefore.writeApprovedCandidateCalls, "the store's write path was never reached for the exact duplicate");
  });

  // B. semantic duplicate -> Duplicate Resolver catches it once, Writer never called
  check("B. semantic duplicate -> Duplicate Resolver catches it, Writer never called", () => {
    const original = fixtureCandidate("semantic-dup");
    const first = runRegistrationPipeline(original, store, "corr-b-1");
    assert(first.status === "REGISTERED", `expected first submission REGISTERED, got ${first.status}`);
    const renamed = fixtureCandidate("semantic-dup", { candidate_id: "candidate-renamed-semantic-dup", name: "renamed-name", source_location: "test-fixtures/registration-pipeline/semantic-dup-v2/", version: "2.0.0" });
    const callsBefore = store.debugCallCounts();
    const second = runRegistrationPipeline(renamed, store, "corr-b-2");
    assert(second.status === "DUPLICATE" && second.reason_code === "DUPLICATE_SEMANTIC", `expected DUPLICATE/DUPLICATE_SEMANTIC, got ${second.status}/${(second as any).reason_code}`);
    const callsAfter = store.debugCallCounts();
    assert(callsAfter.writeApprovedCandidateCalls === callsBefore.writeApprovedCandidateCalls, "the store's write path was never reached for the semantic duplicate");
  });

  // C. unique -> passes Registration Decision -> REGISTERED
  check("C. unique candidate -> REGISTERED", () => {
    const candidate = fixtureCandidate("unique");
    const result = runRegistrationPipeline(candidate, store, "corr-c");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}`);
  });

  // D. unknown resource -> UNRESOLVED
  let unresolvedTaskId: string | null = null;
  let unresolvedCandidateId = "";
  check("D. unknown resource_type -> UNRESOLVED", () => {
    const candidate = fixtureCandidate("unknown-resource", { resource_type: "SOMETHING_NEVER_MAPPED_ANYWHERE" as RegistrationCandidate["resource_type"] });
    unresolvedCandidateId = candidate.candidate_id;
    const result = runRegistrationPipeline(candidate, store, "corr-d");
    assert(result.status === "UNRESOLVED", `expected UNRESOLVED, got ${result.status}`);
    assert(result.status === "UNRESOLVED" && result.failed_stage === "CLASSIFICATION", "expected the UNRESOLVED to come from CLASSIFICATION");
    assert(result.status === "UNRESOLVED" && result.candidate_id === unresolvedCandidateId, "known_facts/result carry the real candidate_id");
    if (result.status === "UNRESOLVED") unresolvedTaskId = result.work_item_task_id;
  });

  // E. UNRESOLVED -> creates a real EXPLAIN_RESOURCE work item
  check("E. UNRESOLVED creates a real EXPLAIN_RESOURCE Work Item (Task + Evidence)", () => {
    assert(unresolvedTaskId !== null, "expected test D to have produced a work_item_task_id");
    const task = getTask(unresolvedTaskId!);
    assert(task !== undefined, "expected a real, persisted Task for the EXPLAIN_RESOURCE work item");
    assert(task!.output_lane === "WORK_ITEM", `expected output_lane=WORK_ITEM, got ${task!.output_lane}`);
    assert(task!.status === "EXECUTING", `expected status=EXECUTING (ready for an Agent), got ${task!.status}`);
    assert(task!.intent_text.includes("EXPLAIN_RESOURCE"), "expected the task's intent_text to name the EXPLAIN_RESOURCE action");
    const evidence = loadEvidenceForTask(unresolvedTaskId!);
    const explainEvidence = evidence.find((e) => e.kind === "explain_resource_request");
    assert(explainEvidence !== undefined, "expected a real Evidence row of kind=explain_resource_request");
    const payload = explainEvidence!.payload as any;
    assert(payload.action === "EXPLAIN_RESOURCE", "expected the evidence payload to carry action=EXPLAIN_RESOURCE");
    assert(payload.candidate_id === unresolvedCandidateId, "expected the evidence payload to carry the real candidate_id");
    assert(Array.isArray(payload.missing_information) && payload.missing_information.length > 0, "expected missing_information to be populated for an UNRESOLVED classification");
    assert(payload.correlation_id === "corr-d", "expected the evidence payload to carry the real correlation_id from the original request");
  });

  // F. Agent explanation comes back -> re-enters the SAME pipeline (same submit_registration_candidate path)
  check("F. Agent explanation (a resubmitted candidate with a real resource_type) re-enters the exact same pipeline and can now succeed", () => {
    // The Agent never sets a final classification — it only supplies a
    // *proposed* resource_type as ordinary candidate data, cited with
    // evidence. The exact same runRegistrationPipeline() call — the one
    // real entry point — is what decides whether it's accepted.
    const explained = fixtureCandidate("unknown-resource-explained", {
      resource_type: "CAPABILITY",
      evidence_refs: ["control/registration-pipeline/tests/registration-pipeline.test.ts", `agent-explanation-for-task:${unresolvedTaskId}`],
    });
    const result = runRegistrationPipeline(explained, store, "corr-f");
    assert(result.status === "REGISTERED", `expected the re-submitted, now-classifiable candidate to REGISTER, got ${result.status}`);
  });

  // G. Store does not make a semantic decision — two different fresh writes with the SAME content_hash/semantic_fingerprint both persist as separate rows (the store itself never redirects/collapses).
  check("G. Store performs technical idempotency only — never a semantic duplicate decision", () => {
    const rawStore = createLocalFileStore();
    const write: ApprovedCandidateWrite = {
      resource: { resource_id: "resource-store-test-1", resource_type: "capability", owner_id: "test", repository_id: null, source_location: "test-fixtures/store-test/", module: null, version: "1.0.0", content_hash: "same-hash-both-times", status: "REGISTERED" },
      capability: { capability_id: "capability-store-test-1", canonical_name: "store-test", capability_type: "capability", purpose: "test", input_contract: [], output_contract: [], side_effects: [], semantic_fingerprint: "same-fingerprint-both-times", ingress_metadata: null },
      relationships: [], version: { resource_id: "resource-store-test-1", version: "1.0.0", commit_sha: null, hash: "same-hash-both-times", source_location: "test-fixtures/store-test/", evidence_ref: null }, evidence: [],
    };
    const first = rawStore.writeApprovedCandidate(write);
    assert(first.inserted === true, "expected the first write to insert");
    // A SECOND write with the SAME content_hash/semantic_fingerprint but a
    // DIFFERENT resource_id/capability_id (as Duplicate Resolution would
    // never actually allow through in the real pipeline, but which the
    // store itself must not silently redirect) — the store must write it
    // as its own row, never collapse it into the first.
    const secondWrite: ApprovedCandidateWrite = { ...write, resource: { ...write.resource, resource_id: "resource-store-test-2" }, capability: { ...write.capability!, capability_id: "capability-store-test-2" } };
    const second = rawStore.writeApprovedCandidate(secondWrite);
    assert(second.inserted === true, "expected the store to write the second row too — it never redirects based on content_hash/semantic_fingerprint, only real technical idempotency (same id twice) does");
    assert(second.resource_id === "resource-store-test-2" && second.capability_id === "capability-store-test-2", "expected the store to return the ids it was actually given, never a different, pre-existing id");
    assert(rawStore.debugCounts().resources === 2 && rawStore.debugCounts().capabilities === 2, "expected two separate resource/capability rows — the store made no semantic decision");
    // Technical idempotency: submitting the EXACT same write (same resource_id/capability_id) again is a no-op.
    const third = rawStore.writeApprovedCandidate(write);
    assert(third.inserted === false, "expected a literal retry of the exact same resource_id/capability_id to be a no-op (technical idempotency)");
    assert(rawStore.debugCounts().resources === 2, "expected no third resource row from the literal retry");
  });

  // H. Writer does not re-classify — commitRegisteredCandidate (imported only via the software/registry-database contract, exercised here through the pipeline with a business-domain candidate that the pipeline itself never reaches Classification for) — proven structurally: the Writer's own source has no import of classifyRegistrationDomain/classifyCandidate for candidate decisions.
  check("H. Writer never re-classifies — no domain-classification import remains in registry-writer.ts's commit path", () => {
    const source = readFileSync(join(process.cwd(), "software/registry-database/registry-writer.ts"), "utf8");
    const commitFnStart = source.indexOf("export function commitRegisteredCandidate");
    assert(commitFnStart !== -1, "expected commitRegisteredCandidate to exist");
    // Slice only this function's own body — up to the next top-level
    // export (writeApprovedRegistration, a separate, non-live
    // DatabasePort function that legitimately still re-derives domain for
    // its own, unrelated defense-in-depth reasons) — never the whole rest
    // of the file.
    const nextExportStart = source.indexOf("\nexport ", commitFnStart + 1);
    const commitFnBody = source.slice(commitFnStart, nextExportStart === -1 ? undefined : nextExportStart);
    assert(!commitFnBody.includes("classifyRegistrationDomain("), "commitRegisteredCandidate must never call classifyRegistrationDomain — Classification is Classification's job alone, upstream");
    assert(!commitFnBody.includes("validateIngressMetadata("), "commitRegisteredCandidate must never call validateIngressMetadata — that is part of Classification too");
    assert(!commitFnBody.includes("findResourceByContentHash(") && !commitFnBody.includes("findCapabilityBySemanticFingerprint("), "commitRegisteredCandidate must never query duplicate-detection reads — that is Duplicate Resolution's exclusive job");
  });

  // I. Destination does not re-classify or re-check duplicates.
  check("I. Destination Mapping never re-classifies or re-checks duplicates", () => {
    const source = readFileSync(join(process.cwd(), "control/artifact-destination/resolver.ts"), "utf8");
    assert(!source.includes("classifyRegistrationDomain") && !source.includes("classifyCandidate"), "artifact-destination/resolver.ts must never import/call Classification");
    assert(!source.includes("findResourceByContentHash") && !source.includes("findCapabilityBySemanticFingerprint") && !source.includes("resolveDuplicate"), "artifact-destination/resolver.ts must never touch Duplicate Resolution");
    // Behavioral proof: resolving a destination for the same resource_type twice is a pure, stateless table lookup — never affected by any registry/classification state.
    const first = resolveArtifactDestination({ resource_id: "resource-i-test", resource_type: "CAPABILITY", capability_id: null, evidence_ref: "test" });
    const second = resolveArtifactDestination({ resource_id: "resource-i-test", resource_type: "CAPABILITY", capability_id: null, evidence_ref: "test" });
    assert(JSON.stringify(first) === JSON.stringify(second), "expected a pure, deterministic destination lookup unaffected by any other stage's state");
  });

  // J. Policy does not re-run duplicate detection.
  check("J. Permission/Policy Resolution never re-runs duplicate detection", () => {
    const source = readFileSync(join(process.cwd(), "control/permission-policy-resolution/resolver.ts"), "utf8");
    assert(!source.includes("findResourceByContentHash") && !source.includes("findCapabilityBySemanticFingerprint") && !source.includes("resolveDuplicate"), "permission-policy-resolution/resolver.ts must never touch Duplicate Resolution's reads — findResourceById (existence only) is the one real-registry read it's allowed");

    // Behavioral proof: build one real task+handoff+registered artifact, then resolve policy for it twice — the second call must not perform any additional duplicate/registration work, only re-evaluate policy against the same already-registered facts.
    const taskId = `task-registration-pipeline-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const workOrder: WorkOrder = { operation: "MODIFY", target_type: "FILE", target_path: "test-fixtures/registration-pipeline/policy-target.ts", requested_change: "test fixture", content: "// test\n", workspace_scope: "test-fixtures/registration-pipeline/", mode: "sandbox", required_tests: ["sandbox.write"], forbidden_files: [], evidence: [{ source: "registration-pipeline.test.ts", note: "test fixture" }] };
    const task: Task = { task_id: taskId, memory: { user_id: "test-owner", workspace_id: "test-workspace", conversation_id: `conv-${taskId}`, parent_task_id: null, task_id: taskId, created_at: new Date().toISOString() }, intent_text: "registration-pipeline policy test fixture", submitted_by_client: "registration-pipeline.test.ts", status: "EXECUTING", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), work_order: workOrder, output_lane: "WORK_ITEM" };
    saveTask(task);
    const candidate = fixtureCandidate("policy-fixture", { resource_type: "CAPABILITY" });
    const registered = runRegistrationPipeline(candidate, store, "corr-j");
    assert(registered.status === "REGISTERED", `expected the policy fixture artifact to register, got ${registered.status}`);
    const artifactResourceId = (registered as Extract<typeof registered, { status: "REGISTERED" }>).resource_id;
    const artifactCapabilityId = (registered as Extract<typeof registered, { status: "REGISTERED" }>).capability_id;
    // No real handoff exists for this task/worker in this fixture, so
    // policy correctly DENYs on WORKER_TASK_MISMATCH — the point here is
    // only that resolving it twice performs no registry mutation.
    const countsBefore = store.debugCounts();
    resolvePolicy({ artifact_resource_id: artifactResourceId, artifact_resource_type: "CAPABILITY", source_capability_id: artifactCapabilityId, target_capability_id: "software-registry", target_class: "CAPABILITY_GRAPH", task_id: taskId, worker_id: "nonexistent-worker", requested_action: "REGISTER_CAPABILITY", evidence_refs: ["test"], correlation_id: "corr-j-1" }, { store });
    resolvePolicy({ artifact_resource_id: artifactResourceId, artifact_resource_type: "CAPABILITY", source_capability_id: artifactCapabilityId, target_capability_id: "software-registry", target_class: "CAPABILITY_GRAPH", task_id: taskId, worker_id: "nonexistent-worker", requested_action: "REGISTER_CAPABILITY", evidence_refs: ["test"], correlation_id: "corr-j-2" }, { store });
    const countsAfter = store.debugCounts();
    assert(countsAfter.resources === countsBefore.resources && countsAfter.capabilities === countsBefore.capabilities, "expected policy resolution to perform zero registry writes — it only reads and records evidence on the task, never re-registers or re-deduplicates anything");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
