/**
 * หน้าที่: proves the Existing Registration Update path — real registry,
 * real store, no mocks. Registers two real capabilities via the real
 * CREATE path first (control/registration-pipeline/), then exercises
 * every mutation type and every fail-closed reason against them.
 *
 * How to run: npx tsx control/registration-update/tests/registration-update.test.ts
 */

import type { RegistrationCandidate } from "../../event-pipeline/contract";
import { runRegistrationPipeline } from "../../registration-pipeline/contract";
import { applyMutation } from "../contract";
import type { UpdateRequest } from "../contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { findCapability, findResourceById } from "../../../software/registry-database/contract";

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

function fixtureCandidate(scenario: string, overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return {
    candidate_id: `candidate-update-${scenario}-${Math.random().toString(36).slice(2)}`,
    name: `test-update-${scenario}`,
    kind: "capability",
    source_location: `test-fixtures/registration-update/${scenario}/`,
    owner: "control/registration-update/tests/registration-update.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: "test_update_scenario_fixture",
    version: "1.0.0",
    evidence_refs: ["control/registration-update/tests/registration-update.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: `registration-update-test-${scenario}`,
    ...overrides,
  };
}

function main(): void {
  const store = createLocalFileStore();

  const sourceReg = runRegistrationPipeline(fixtureCandidate("source"), store, "corr-setup-source");
  const targetReg = runRegistrationPipeline(fixtureCandidate("target"), store, "corr-setup-target");
  assert(sourceReg.status === "REGISTERED" && targetReg.status === "REGISTERED", "fixture setup: both source and target capabilities must register cleanly via the real CREATE path");
  const source = sourceReg as Extract<typeof sourceReg, { status: "REGISTERED" }>;
  const target = targetReg as Extract<typeof targetReg, { status: "REGISTERED" }>;

  function baseRequest(overrides: Partial<UpdateRequest> = {}): UpdateRequest {
    return {
      resource_id: source.resource_id,
      capability_id: source.capability_id!,
      expected_current_version: "1.0.0",
      mutation_type: "ADD_RELATIONSHIP",
      mutation_payload: { to_type: "CAPABILITY", to_id: target.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY" },
      evidence_refs: ["control/registration-update/tests/registration-update.test.ts"],
      correlation_id: "corr-test",
      ...overrides,
    };
  }

  check("ADD_RELATIONSHIP applies, read-back shows the real edge, capability_id unchanged", () => {
    const before = findCapability({ capability_id: source.capability_id! }, store)!;
    const result = applyMutation(baseRequest(), store);
    assert(result.status === "APPLIED", `expected APPLIED, got ${result.status} (${result.reason_code})`);
    assert(result.capability_id === source.capability_id, "capability_id must never change through an update");
    assert(result.resource_id === source.resource_id, "resource_id must never change through an update");
    const rel = result.capability!.relationships.find((r) => r.relationship_kind === "CAPABILITY_TO_DEPENDENCY" && r.to_id === target.capability_id);
    assert(rel !== undefined, "expected the new relationship to read back on the capability");
    assert(result.capability!.relationships.length === before.relationships.length + 1, "expected exactly one new relationship row");
  });

  check("ADD_RELATIONSHIP is idempotent — applying the identical mutation twice adds no duplicate edge", () => {
    const countBefore = findCapability({ capability_id: source.capability_id! }, store)!.relationships.length;
    applyMutation(baseRequest(), store);
    const countAfter = findCapability({ capability_id: source.capability_id! }, store)!.relationships.length;
    assert(countAfter === countBefore, "expected no new relationship row from a repeated, identical mutation");
  });

  check("REMOVE_RELATIONSHIP removes the real edge and it stays removed on read-back", () => {
    const before = findCapability({ capability_id: source.capability_id! }, store)!;
    assert(before.relationships.some((r) => r.relationship_kind === "CAPABILITY_TO_DEPENDENCY"), "precondition: the relationship must exist before removal");
    const result = applyMutation(baseRequest({ mutation_type: "REMOVE_RELATIONSHIP", mutation_payload: { to_type: "CAPABILITY", to_id: target.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY" } }), store);
    assert(result.status === "APPLIED", `expected APPLIED, got ${result.status} (${result.reason_code})`);
    assert(!result.capability!.relationships.some((r) => r.relationship_kind === "CAPABILITY_TO_DEPENDENCY"), "expected the relationship to be gone from the real read-back");
  });

  check("ADD_EVIDENCE appends a real evidence row, read back on the capability", () => {
    const before = findCapability({ capability_id: source.capability_id! }, store)!.evidence_refs.length;
    const result = applyMutation(baseRequest({ mutation_type: "ADD_EVIDENCE", mutation_payload: { evidence_ref: "control/registration-update/tests/registration-update.test.ts#new-evidence" } }), store);
    assert(result.status === "APPLIED", `expected APPLIED, got ${result.status} (${result.reason_code})`);
    assert(result.capability!.evidence_refs.includes("control/registration-update/tests/registration-update.test.ts#new-evidence"), "expected the new evidence_ref to read back");
    assert(result.capability!.evidence_refs.length > before, "expected evidence_refs to grow");
  });

  check("UNKNOWN_CAPABILITY — a capability_id that was never registered is rejected, fail-closed", () => {
    const result = applyMutation(baseRequest({ capability_id: "capability-never-registered-anywhere" }), store);
    assert(result.status === "REJECTED" && result.reason_code === "UNKNOWN_CAPABILITY", `expected REJECTED/UNKNOWN_CAPABILITY, got ${result.status}/${result.reason_code}`);
  });

  check("STALE_VERSION — a caller citing a version that was never real for this capability is rejected", () => {
    const result = applyMutation(baseRequest({ expected_current_version: "99.99.99" }), store);
    assert(result.status === "REJECTED" && result.reason_code === "STALE_VERSION", `expected REJECTED/STALE_VERSION, got ${result.status}/${result.reason_code}`);
  });

  check("INVALID_RELATIONSHIP — an unknown relationship_kind is rejected, no partial write", () => {
    const result = applyMutation(baseRequest({ mutation_payload: { to_type: "CAPABILITY", to_id: target.capability_id, relationship_kind: "TOTALLY_MADE_UP_KIND" } }), store);
    assert(result.status === "REJECTED" && result.reason_code === "INVALID_RELATIONSHIP", `expected REJECTED/INVALID_RELATIONSHIP, got ${result.status}/${result.reason_code}`);
  });

  check("TARGET_NOT_REGISTERED — a chain-style relationship kind pointing at a capability_id that doesn't exist is rejected", () => {
    const result = applyMutation(baseRequest({ mutation_payload: { to_type: "CAPABILITY", to_id: "capability-never-registered-anywhere", relationship_kind: "ARTIFACT_DESTINATION_TO_TARGET_RESOLUTION" } }), store);
    assert(result.status === "REJECTED" && result.reason_code === "TARGET_NOT_REGISTERED", `expected REJECTED/TARGET_NOT_REGISTERED, got ${result.status}/${result.reason_code}`);
  });

  check("IDENTITY_MUTATION_FORBIDDEN — an identity-looking key in the payload is rejected, regardless of mutation_type", () => {
    const result = applyMutation(baseRequest({ mutation_payload: { to_type: "CAPABILITY", to_id: target.capability_id, relationship_kind: "CAPABILITY_TO_DEPENDENCY", canonical_name: "sneaky-rename-attempt" } }), store);
    assert(result.status === "REJECTED" && result.reason_code === "IDENTITY_MUTATION_FORBIDDEN", `expected REJECTED/IDENTITY_MUTATION_FORBIDDEN, got ${result.status}/${result.reason_code}`);
  });

  check("IDENTITY_MUTATION_FORBIDDEN — an unknown mutation_type is rejected, fail-closed, never guessed", () => {
    const result = applyMutation(baseRequest({ mutation_type: "DELETE_EVERYTHING" }), store);
    assert(result.status === "REJECTED" && result.reason_code === "IDENTITY_MUTATION_FORBIDDEN", `expected REJECTED/IDENTITY_MUTATION_FORBIDDEN, got ${result.status}/${result.reason_code}`);
  });

  check("ADD_VERSION bumps the version, read back, and becomes the new expected_current_version", () => {
    const result = applyMutation(baseRequest({ mutation_type: "ADD_VERSION", mutation_payload: { version: "1.1.0" } }), store);
    assert(result.status === "APPLIED", `expected APPLIED, got ${result.status} (${result.reason_code})`);
    assert(result.capability!.version.includes("1.1.0"), `expected version 1.1.0 to read back, got ${JSON.stringify(result.capability!.version)}`);
    const followUp = applyMutation(baseRequest({ expected_current_version: "1.1.0", mutation_type: "ADD_EVIDENCE", mutation_payload: { evidence_ref: "control/registration-update/tests/registration-update.test.ts#after-version-bump" } }), store);
    assert(followUp.status === "APPLIED", `expected the bumped version to be usable as expected_current_version, got ${followUp.status} (${followUp.reason_code})`);
  });

  check("resource-only row (capability_id=\"\" sentinel, kind=resource, e.g. a real SOURCE_REFERENCE) supports ADD_EVIDENCE and ADD_VERSION", () => {
    const sourceCandidate: RegistrationCandidate = {
      candidate_id: `candidate-update-source-${Math.random().toString(36).slice(2)}`,
      name: "test-fixtures/registration-update/source-only/a.ts",
      kind: "resource",
      source_location: "test-fixtures/registration-update/source-only/a.ts",
      owner: "control/registration-update/tests/registration-update.test.ts",
      input: [], output: [], side_effects: [], dependencies: [],
      behavior: "file changed by test fixture",
      version: "1.0.0",
      evidence_refs: ["control/registration-update/tests/registration-update.test.ts"],
      domain: "SOFTWARE_CONTROL_PLANE",
      resource_type: "SOURCE_REFERENCE",
      data_classification: "INTERNAL",
      source_system: "dna-os-infrastructure",
      scope: "registration-update-test-source-only",
    };
    const sourceReg = runRegistrationPipeline(sourceCandidate, store, "corr-setup-source-only");
    assert(sourceReg.status === "REGISTERED", `fixture setup: expected REGISTERED, got ${sourceReg.status}`);
    const sourceResourceId = (sourceReg as Extract<typeof sourceReg, { status: "REGISTERED" }>).resource_id;

    const evidenceResult = applyMutation({
      resource_id: sourceResourceId, capability_id: "", expected_current_version: "1.0.0",
      mutation_type: "ADD_EVIDENCE", mutation_payload: { evidence_ref: "github-commit-sha:deadbeef" },
      evidence_refs: [], correlation_id: "corr-source-only-evidence",
    }, store);
    assert(evidenceResult.status === "APPLIED", `expected APPLIED, got ${evidenceResult.status} (${evidenceResult.reason_code})`);
    assert(evidenceResult.capability === null, "expected no CapabilityLookupResult for a resource-only mutation");

    const versionResult = applyMutation({
      resource_id: sourceResourceId, capability_id: "", expected_current_version: "1.0.0",
      mutation_type: "ADD_VERSION", mutation_payload: { version: "1.0.1" },
      evidence_refs: [], correlation_id: "corr-source-only-version",
    }, store);
    assert(versionResult.status === "APPLIED", `expected APPLIED, got ${versionResult.status} (${versionResult.reason_code})`);
    const updatedResource = findResourceById(sourceResourceId, store);
    assert(updatedResource!.version === "1.0.1", `expected the resource's own version to bump to 1.0.1, got ${updatedResource!.version}`);
  });

  check("identity fields never change across every mutation applied in this suite", () => {
    const finalState = findCapability({ capability_id: source.capability_id! }, store)!;
    assert(finalState.capability_id === source.capability_id, "capability_id is stable");
    assert(finalState.source_location.includes("test-fixtures/registration-update/source/"), "source_location is stable — never touched by any update");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
