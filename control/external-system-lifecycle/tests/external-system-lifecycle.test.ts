/**
 * หน้าที่: end-to-end proof of the canonical External System Lifecycle —
 * a real candidate goes through every real stage this orchestrator wires
 * (registration-pipeline, registration-update, integration-verification,
 * target-resolution, permission-policy-resolution, admission,
 * execution/deploy, runtime-verification), against a real (sandboxed)
 * RegistryStore and a real (sandboxed) persistent LifecycleEventStore.
 *
 * ROOT-CAUSE FIX (2026-08-21): `../../agent-gateway/gateway.ts`'s
 * `matchCapability()` now routes an External-System-Lifecycle
 * registration intent to a real
 * `reports/phase16-world-evidence/capability_index.json` entry — see
 * `../../agent-gateway/tests/capability-routing.test.ts` for the direct
 * proof. `submitTask()`'s own internal adapter-execution loop remains
 * untouched (no AgentAdapter is registered for this intent — this
 * orchestrator is its own executor); the real, already-established
 * mechanism Admission is designed to be handed a task through is
 * `saveTask()` placing it in an active status (see
 * `../../admission/tests/admission.test.ts` and
 * `../../source-execution/tests/source-execution.test.ts`, both of which
 * construct their Task the exact same way) — never a bypass, Policy and
 * Admission both still independently evaluate the real, persisted task.
 * A real candidate now reaches genuine COMPLETE end-to-end (test A).
 *
 * How to run: npx tsx control/external-system-lifecycle/tests/external-system-lifecycle.test.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import type { RegistrationCandidate } from "../../event-pipeline/contract";
import { runRegistrationPipeline } from "../../registration-pipeline/contract";
import { findCapability } from "../../../software/registry-database/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { runExternalSystemLifecycle, createLifecycleEventStore } from "../contract";
import type { ExternalSystemLifecycleInput } from "../contract";

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

const sandboxDataDir = `tests/__sandbox__/external-system-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`;
mkdirSync(sandboxDataDir, { recursive: true });
const evidenceFile = `${sandboxDataDir}/evidence.txt`;
writeFileSync(evidenceFile, "real evidence file for this test run\n");

const registryStore = createLocalFileStore();
const lifecycleStore = createLifecycleEventStore({ dataDir: sandboxDataDir });

// Duplicate Resolution's semantic fingerprint normalizes any single
// identifier-like token to a fixed placeholder, so distinct fixtures need
// `behavior` strings with genuinely different WORD COUNTS, not just
// different words, to avoid colliding as DUPLICATE_SEMANTIC — a counter
// gives each fixture a unique, growing word count deterministically.
let fixtureCounter = 0;

function fixtureCandidate(name: string): RegistrationCandidate {
  fixtureCounter += 1;
  return {
    candidate_id: `candidate-lifecycle-${name}-${Math.random().toString(36).slice(2)}`,
    name: `test-lifecycle-${name}`,
    kind: "capability",
    source_location: `control/external-system-lifecycle/tests/fixtures/${name}/`,
    owner: "control/external-system-lifecycle/tests/external-system-lifecycle.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: `a fixture capability for lifecycle test scenario ${"marker ".repeat(fixtureCounter).trim()}`,
    version: "1.0.0",
    evidence_refs: [evidenceFile],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "test",
  };
}

async function main() {
  // A consumer capability registered up front, so RELATIONSHIP/INTEGRATION have something real to bind and verify against.
  const consumerCandidate = fixtureCandidate("consumer");
  const consumerRegistered = runRegistrationPipeline(consumerCandidate, registryStore, "corr-consumer");
  assert(consumerRegistered.status === "REGISTERED", "fixture consumer must register");
  const consumerCapability = findCapability({ canonical_name: consumerCandidate.name }, registryStore);
  assert(consumerCapability !== null, "consumer must be findable");

  await check("A. real IN_PROCESS_LOCAL candidate reaches genuine COMPLETE end-to-end, every stage really passing", async () => {
    const candidate = fixtureCandidate("happy-path");
    const input: ExternalSystemLifecycleInput = {
      candidate,
      relationships: [{ consumer_canonical_name: consumerCandidate.name, to_type: "DEPENDENCY", relationship_kind: "CAPABILITY_TO_DEPENDENCY" }],
      integration_proofs: [{ consumer_capability_id: consumerCapability!.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: evidenceFile }],
      delivery_target_evidence: { in_process_consumer_file: evidenceFile },
      runtime_evidence_ref: evidenceFile,
      correlation_id: "corr-happy-path",
    };
    const result = await runExternalSystemLifecycle(input, registryStore, lifecycleStore);
    const events = result.run.events.map((e) => `${e.stage}:${e.status}`);
    assert(result.resource_id !== null && result.capability_id !== null, "must have really registered");
    for (const passedStage of ["DISCOVER:PASSED", "BOUNDARY_REPO_DECISION:PASSED", "BUILD:PASSED", "TEST:PASSED", "VERIFY:PASSED", "CLASSIFY:PASSED", "DUPLICATE_CHECK:PASSED", "REGISTRATION_PIPELINE:PASSED", "REGISTRY_WRITER:PASSED", "RELATIONSHIP:PASSED", "INTEGRATION:PASSED", "TARGET_RESOLUTION:PASSED", "PERMISSION_ADMISSION:PASSED", "DEPLOY_INSTALL:NOT_APPLICABLE", "RUNTIME_VERIFY:PASSED", "COMPLETE:PASSED"]) {
      assert(events.includes(passedStage), `expected real event ${passedStage}, got: ${JSON.stringify(events)}`);
    }
    assert(result.final_stage === "COMPLETE", `expected COMPLETE, got ${result.final_stage}. events: ${JSON.stringify(events)}`);
    assert(result.final_status === "PASSED", `expected PASSED, got ${result.final_status}`);
    assert(result.is_complete === true, "must be complete now the real routing gap is closed");
    const admissionEvent = result.run.events.find((e) => e.stage === "PERMISSION_ADMISSION")!;
    assert(admissionEvent.reason.includes("policy=ALLOW"), `expected a real ALLOW policy decision in the reason, got ${admissionEvent.reason}`);
    assert(admissionEvent.reason.includes("admission=ADMITTED"), `expected a real ADMITTED admission decision in the reason, got ${admissionEvent.reason}`);
  });

  await check("B. restart survival — a fresh LifecycleEventStore instance over the same directory reads back the same COMPLETE progress", async () => {
    const candidate = fixtureCandidate("restart-check");
    const input: ExternalSystemLifecycleInput = {
      candidate,
      relationships: [{ consumer_canonical_name: consumerCandidate.name, to_type: "DEPENDENCY", relationship_kind: "CAPABILITY_TO_DEPENDENCY" }],
      integration_proofs: [{ consumer_capability_id: consumerCapability!.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: evidenceFile }],
      delivery_target_evidence: { in_process_consumer_file: evidenceFile },
      runtime_evidence_ref: evidenceFile,
      correlation_id: "corr-restart-check",
    };
    const firstRunResult = await runExternalSystemLifecycle(input, registryStore, lifecycleStore);
    assert(firstRunResult.is_complete === true, "setup run must genuinely complete");

    const restartedStore = createLifecycleEventStore({ dataDir: sandboxDataDir });
    const rebuiltRun = restartedStore.getLifecycleRun(candidate.candidate_id);
    assert(rebuiltRun.is_complete === true, "rebuilt run from a fresh store instance must still be complete");
    assert(rebuiltRun.current_stage === "COMPLETE", `expected COMPLETE, got ${rebuiltRun.current_stage}`);
    assert(rebuiltRun.events.length === firstRunResult.run.events.length, "rebuilt event count must match the original run exactly");
  });

  await check("F. Permission Policy and Admission are never bypassed — a genuinely disallowed action still DENIES/blocks PERMISSION_ADMISSION even after the routing fix", async () => {
    // TEST_RESULT:EVIDENCE_STORE only permits APPEND_EVIDENCE, never
    // REGISTER_CAPABILITY (see control/permission-policy-resolution/policy-registry.ts's
    // real ACTION_RULES table) — a real, independent proof that Policy
    // still genuinely evaluates the (resource_type, target_class, action)
    // triple and can still say no, unrelated to the routing fix.
    fixtureCounter += 1;
    const candidate: RegistrationCandidate = {
      candidate_id: `candidate-lifecycle-no-bypass-${Math.random().toString(36).slice(2)}`,
      name: "test-lifecycle-no-bypass",
      kind: "capability",
      source_location: "control/external-system-lifecycle/tests/fixtures/no-bypass/",
      owner: "control/external-system-lifecycle/tests/external-system-lifecycle.test.ts",
      input: [], output: [], side_effects: [], dependencies: [],
      behavior: `a fixture proving policy still genuinely denies ${"marker ".repeat(fixtureCounter).trim()}`,
      version: "1.0.0",
      evidence_refs: [evidenceFile],
      domain: "ENGINEERING_EVIDENCE",
      resource_type: "TEST_RESULT",
      data_classification: "INTERNAL",
      source_system: "dna-os-infrastructure",
      scope: "test",
    };
    const input: ExternalSystemLifecycleInput = {
      candidate,
      relationships: [{ consumer_canonical_name: consumerCandidate.name, to_type: "DEPENDENCY", relationship_kind: "CAPABILITY_TO_DEPENDENCY" }],
      integration_proofs: [{ consumer_capability_id: consumerCapability!.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: evidenceFile }],
      delivery_target_evidence: {},
      correlation_id: "corr-no-bypass",
    };
    const result = await runExternalSystemLifecycle(input, registryStore, lifecycleStore);
    assert(result.final_stage === "PERMISSION_ADMISSION", `expected to stop at PERMISSION_ADMISSION, got ${result.final_stage}`);
    assert(result.final_status === "FAILED", `expected FAILED (a real DENY), got ${result.final_status}`);
    assert(result.is_complete === false, "a genuinely policy-denied candidate must never complete");
    const admissionEvent = result.run.events.find((e) => e.stage === "PERMISSION_ADMISSION")!;
    assert(admissionEvent.reason.includes("policy=DENY"), `expected a real DENY in the reason, got ${admissionEvent.reason}`);
  });

  await check("C. BOUNDARY_REPO_DECISION rejects a source_location outside every real top-level folder", async () => {
    const candidate = { ...fixtureCandidate("bad-boundary"), source_location: "not-a-real-top-level-folder/whatever/" };
    const input: ExternalSystemLifecycleInput = { candidate, relationships: [], integration_proofs: [], delivery_target_evidence: {}, correlation_id: "corr-bad-boundary" };
    const result = await runExternalSystemLifecycle(input, registryStore, lifecycleStore);
    assert(result.final_stage === "BOUNDARY_REPO_DECISION", `expected to stop at BOUNDARY_REPO_DECISION, got ${result.final_stage}`);
    assert(result.final_status === "FAILED", `expected FAILED, got ${result.final_status}`);
    assert(result.is_complete === false, "must never be complete");
  });

  await check("D. duplicate candidate stops at DUPLICATE_CHECK, never re-registers", async () => {
    const candidate = fixtureCandidate("dup-check");
    const input: ExternalSystemLifecycleInput = { candidate, relationships: [], integration_proofs: [], delivery_target_evidence: {}, correlation_id: "corr-dup-1" };
    const first = await runExternalSystemLifecycle(input, registryStore, lifecycleStore);
    assert(first.final_stage !== "BOUNDARY_REPO_DECISION", "first run must pass boundary check");

    const duplicateCandidate = { ...candidate, candidate_id: `${candidate.candidate_id}-again` };
    const second = await runExternalSystemLifecycle({ ...input, candidate: duplicateCandidate, correlation_id: "corr-dup-2" }, registryStore, lifecycleStore);
    assert(second.final_stage === "DUPLICATE_CHECK", `expected to stop at DUPLICATE_CHECK, got ${second.final_stage}`);
    assert(second.final_status === "FAILED", `expected FAILED, got ${second.final_status}`);
    assert(second.is_complete === false, "a duplicate must never be complete");
  });

  await check("E. TARGET_RESOLUTION genuinely resolves RESOLVED/REGISTRY_ROW for a CAPABILITY-type candidate, never fabricated", async () => {
    const candidate = fixtureCandidate("target-resolution-check");
    const input: ExternalSystemLifecycleInput = {
      candidate,
      relationships: [{ consumer_canonical_name: consumerCandidate.name, to_type: "DEPENDENCY", relationship_kind: "CAPABILITY_TO_DEPENDENCY" }],
      integration_proofs: [{ consumer_capability_id: consumerCapability!.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: evidenceFile }],
      delivery_target_evidence: {},
      correlation_id: "corr-target-resolution-check",
    };
    const result = await runExternalSystemLifecycle(input, registryStore, lifecycleStore);
    const targetEvent = result.run.events.find((e) => e.stage === "TARGET_RESOLUTION");
    assert(targetEvent !== undefined, "TARGET_RESOLUTION event must exist");
    assert(targetEvent!.status === "PASSED", `expected TARGET_RESOLUTION PASSED, got ${targetEvent!.status}: ${targetEvent!.reason}`);
    assert(targetEvent!.evidence_ref !== null && targetEvent!.evidence_ref!.startsWith("software-registry://capability_graph/"), `expected a real registry-row target_ref, got ${targetEvent!.evidence_ref}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FATAL", error);
  process.exitCode = 1;
});
