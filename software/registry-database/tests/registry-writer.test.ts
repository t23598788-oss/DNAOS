/**
 * หน้าที่: the required round-trip proof for `software/registry-database/`,
 * against `../adapters/local-file-store.ts` only (no live database this
 * round — see `../migrations/MIGRATION_PLAN.md`). Uses one hand-built
 * `RegistrationCandidate` describing `../../capability-registrar/`'s own
 * real, tested capability lookup logic as evidence — see
 * `../ARCHITECTURE_DECISIONS.md` §TEST_FIXTURE for why this candidate,
 * not the repo's one real (but explicitly FAILED, wrong-shaped) candidate
 * record, is used here.
 *
 * Runs through the full, real, single-owner pipeline
 * (`control/registration-pipeline/contract.ts`'s `runRegistrationPipeline`)
 * end to end — STEP "Refactor Registration Pipeline to Single-Owner
 * Sequential Stages" moved duplicate detection off this file's own
 * `evaluateRegistration`/`registerCandidate` pairing (which compared
 * against a caller-supplied `existing` array) onto
 * `control/registration-pipeline/duplicate-resolution.ts`, which queries
 * this same store's real `findResourceByContentHash`/
 * `findCapabilityBySemanticFingerprint` reads instead.
 *
 * Proves:
 *  1. candidate -> pipeline -> REGISTERED -> persistent (local) registry
 *     -> lookup -> same capability_id/resource_id back.
 *  2. resubmitting the exact same candidate is DUPLICATE (EXACT), no new
 *     row, but the store's own technical-idempotency path is never even
 *     reached (Duplicate Resolution short-circuits before the Writer).
 *  3. a differently-named candidate with an identical semantic
 *     fingerprint is DUPLICATE (SEMANTIC), caught the same way, before
 *     the writer, so no new capability is ever created and
 *     `store.writeApprovedCandidate` is never even called.
 *
 * How to run: npx tsx software/registry-database/tests/registry-writer.test.ts
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/contract";
import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import { findCapability } from "../lookup";
import { createLocalFileStore } from "../adapters/local-file-store";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const CANDIDATE_A: RegistrationCandidate = {
  candidate_id: "candidate-capability-registrar-lookup",
  name: "capability-registrar.find-by-capability-id",
  kind: "capability",
  source_location: "software/capability-registrar/index.ts",
  owner: "software/capability-registrar/",
  input: ["capabilityId: string"],
  output: ["CapabilityMetadata | undefined"],
  side_effects: [],
  dependencies: ["control/command-router/capability-registry.ts"],
  behavior: "look up one capability record by its capability_id in the real, in-memory CAPABILITY_INDEX projection",
  version: "1.0.0",
  evidence_refs: [
    "software/capability-registrar/contract.ts",
    "software/capability-registrar/index.ts",
    "software/capability-registrar/tests/index.test.ts",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "software_registry",
};

function run(): void {
  console.log("=== software/registry-database/tests/registry-writer.test.ts ===");
  const store = createLocalFileStore();

  let testCapabilityId = "";
  let testResourceId = "";

  // 1. fresh candidate -> pipeline -> REGISTERED -> lookup -> same capability back
  {
    const result = runRegistrationPipeline(CANDIDATE_A, store, "corr-fresh");
    assert(result.status === "REGISTERED", `candidate A is REGISTERED on first submission (got ${result.status})`);
    assert(result.status === "REGISTERED" && result.resource_id !== null && result.capability_id !== null, "a capability-kind candidate produces both a resource_id and a capability_id");
    testResourceId = (result as Extract<typeof result, { status: "REGISTERED" }>).resource_id;
    testCapabilityId = (result as Extract<typeof result, { status: "REGISTERED" }>).capability_id!;

    const counts = store.debugCounts();
    assert(counts.resources === 1, `exactly one resource row exists (got ${counts.resources})`);
    assert(counts.capabilities === 1, `exactly one capability row exists (got ${counts.capabilities})`);
    assert(counts.resource_capabilities === 1, `exactly one resource_capabilities join row exists (got ${counts.resource_capabilities})`);
    assert(counts.relationships === 1, `exactly one relationship row exists (got ${counts.relationships})`);
    assert(counts.versions === 1, `exactly one version row exists (got ${counts.versions})`);
    assert(counts.evidence === CANDIDATE_A.evidence_refs.length, `one evidence row per evidence_ref exists (got ${counts.evidence}, expected ${CANDIDATE_A.evidence_refs.length})`);
    assert(counts.registration_events === 1, `exactly one registration_event row exists (got ${counts.registration_events})`);

    const looked_up = findCapability({ capability_id: testCapabilityId }, store);
    assert(looked_up !== null, "findCapability() finds the just-registered capability by capability_id");
    assert(looked_up!.capability_id === testCapabilityId, "the looked-up capability_id matches what the pipeline returned");
    assert(looked_up!.resource_ids.length === 1 && looked_up!.resource_ids[0] === testResourceId, "the looked-up capability's resource_ids includes the same resource_id the pipeline returned");
    assert(looked_up!.source_location.includes(CANDIDATE_A.source_location), "the looked-up source_location matches the candidate's real source_location");
    assert(looked_up!.status === "REGISTERED", `a freshly-registered capability has status REGISTERED (got ${looked_up!.status})`);
    assert(JSON.stringify(looked_up!.input_contract) === JSON.stringify(CANDIDATE_A.input), "input_contract round-trips the candidate's input");
    assert(JSON.stringify(looked_up!.evidence_refs.slice().sort()) === JSON.stringify(CANDIDATE_A.evidence_refs.slice().sort()), "evidence_refs round-trip the candidate's evidence_refs");

    console.log(`PASS: candidate -> pipeline -> REGISTERED -> persistent registry -> lookup -> same capability back (capability_id=${testCapabilityId}, resource_id=${testResourceId})`);
  }

  // 2. resubmit the exact same candidate -> DUPLICATE_EXACT, no new row, writer never called
  {
    const countsBefore = store.debugCounts();
    const callsBefore = store.debugCallCounts();

    const result = runRegistrationPipeline(CANDIDATE_A, store, "corr-exact-resubmit");
    assert(result.status === "DUPLICATE", `resubmitting the exact same candidate is DUPLICATE (got ${result.status})`);
    assert(result.status === "DUPLICATE" && result.reason_code === "DUPLICATE_EXACT", `expected reason_code DUPLICATE_EXACT, got ${result.status === "DUPLICATE" ? result.reason_code : "n/a"}`);
    assert(result.status === "DUPLICATE" && result.duplicate_of.resource_id === testResourceId, "duplicate_of names the real, already-registered resource_id");

    const countsAfter = store.debugCounts();
    assert(countsAfter.resources === countsBefore.resources, "resource row count is unchanged after resubmission");
    assert(countsAfter.capabilities === countsBefore.capabilities, "capability row count is unchanged after resubmission");

    const callsAfter = store.debugCallCounts();
    assert(callsAfter.writeApprovedCandidateCalls === callsBefore.writeApprovedCandidateCalls, "store.writeApprovedCandidate was never called for a DUPLICATE_EXACT result — Duplicate Resolution decided this before the Writer was ever reached");

    console.log("PASS: exact resubmission creates no duplicate resource/capability row, and the Writer is never called");
  }

  // 3. new name, identical semantic fingerprint -> DUPLICATE_SEMANTIC, caught upstream, no new capability
  {
    const renamed: RegistrationCandidate = {
      ...CANDIDATE_A,
      candidate_id: "candidate-capability-registrar-lookup-renamed",
      name: "capability-registrar.lookup-by-id-v2",
      source_location: "software/capability-registrar/index-v2.ts",
      version: "2.0.0",
    };

    const countsBefore = store.debugCounts();
    const callsBefore = store.debugCallCounts();

    const result = runRegistrationPipeline(renamed, store, "corr-renamed");
    assert(result.status === "DUPLICATE", `a renamed candidate with an identical semantic fingerprint is DUPLICATE (got ${result.status})`);
    assert(result.status === "DUPLICATE" && result.reason_code === "DUPLICATE_SEMANTIC", `expected reason_code DUPLICATE_SEMANTIC, got ${result.status === "DUPLICATE" ? result.reason_code : "n/a"}`);
    assert(result.status === "DUPLICATE" && result.duplicate_of.capability_id === testCapabilityId, "duplicate_of names the real, already-registered capability_id, not the renamed candidate_id");

    const countsAfter = store.debugCounts();
    assert(countsAfter.capabilities === countsBefore.capabilities, `no new capability row was created for the renamed candidate (still ${countsAfter.capabilities})`);
    assert(countsAfter.resources === countsBefore.resources, "no new resource row was created for the renamed candidate either");

    const callsAfter = store.debugCallCounts();
    assert(callsAfter.writeApprovedCandidateCalls === callsBefore.writeApprovedCandidateCalls, "store.writeApprovedCandidate was never called for the renamed, semantically-duplicate candidate");

    const stillOneCapability = store.debugCounts().capabilities === 1;
    assert(stillOneCapability, "exactly one capability row exists in the whole registry after all three scenarios");

    console.log("PASS: renamed candidate with identical semantic fingerprint is DUPLICATE_SEMANTIC — no new capability created, Writer never called");
  }

  console.log(`=== ALL registry-writer.test.ts CASES PASSED (TEST_CAPABILITY_ID=${testCapabilityId}, TEST_RESOURCE_ID=${testResourceId}) ===`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
