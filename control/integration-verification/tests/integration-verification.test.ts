/**
 * หน้าที่: proves Integration Verification re-checks relationship edges
 * and evidence files for real, never trusting a caller's claim.
 *
 * How to run: npx tsx control/integration-verification/tests/integration-verification.test.ts
 */

import type { RegistrationCandidate } from "../../event-pipeline/contract";
import { runRegistrationPipeline } from "../../registration-pipeline/contract";
import { applyMutation } from "../../registration-update/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import { verifyIntegration } from "../contract";

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

function fixtureCandidate(name: string): RegistrationCandidate {
  return {
    candidate_id: `candidate-integration-verify-${name}-${Math.random().toString(36).slice(2)}`,
    name: `test-integration-verify-${name}`,
    kind: "capability",
    source_location: `control/integration-verification/tests/fixtures/${name}/`,
    owner: "control/integration-verification/tests/integration-verification.test.ts",
    input: [], output: [], side_effects: [], dependencies: [],
    behavior: name === "target" ? "a fixture capability standing in for the real dependency target under test" : "a fixture capability standing in for the real consumer under test in this suite",
    version: "1.0.0",
    evidence_refs: ["control/integration-verification/tests/integration-verification.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "test",
  };
}

const store = createLocalFileStore();
const target = runRegistrationPipeline(fixtureCandidate("target"), store, "corr-target");
assert(target.status === "REGISTERED", "fixture target must register");
const targetCapabilityId = target.status === "REGISTERED" ? target.capability_id! : "";

const consumer = runRegistrationPipeline(fixtureCandidate("consumer"), store, "corr-consumer");
assert(consumer.status === "REGISTERED", "fixture consumer must register");
const consumerCapabilityId = consumer.status === "REGISTERED" ? consumer.capability_id! : "";

check("A. no proofs supplied -> UNRESOLVED", () => {
  const result = verifyIntegration({ capability_id: targetCapabilityId, proofs: [], correlation_id: "c1" }, store);
  assert(result.status === "UNRESOLVED", `expected UNRESOLVED, got ${result.status}`);
});

check("B. proof citing a relationship that was never added -> NOT_INTEGRATED", () => {
  const result = verifyIntegration({ capability_id: targetCapabilityId, proofs: [{ consumer_capability_id: consumerCapabilityId, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: "control/integration-verification/tests/integration-verification.test.ts" }], correlation_id: "c2" }, store);
  assert(result.status === "NOT_INTEGRATED", `expected NOT_INTEGRATED, got ${result.status}`);
  assert(result.verified_consumers[0].relationship_found === false, "relationship_found must be false — never fabricated");
});

check("C. real relationship added via registration-update, real evidence file exists -> INTEGRATED", () => {
  const update = applyMutation(
    { resource_id: consumer.status === "REGISTERED" ? consumer.resource_id : "", capability_id: consumerCapabilityId, expected_current_version: "1.0.0", mutation_type: "ADD_RELATIONSHIP", mutation_payload: { to_type: "DEPENDENCY", to_id: targetCapabilityId, relationship_kind: "CAPABILITY_TO_DEPENDENCY" }, evidence_refs: [], correlation_id: "c3" },
    store,
  );
  assert(update.status === "APPLIED", `expected relationship APPLIED, got ${update.status}`);
  const result = verifyIntegration({ capability_id: targetCapabilityId, proofs: [{ consumer_capability_id: consumerCapabilityId, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: "control/integration-verification/tests/integration-verification.test.ts" }], correlation_id: "c4" }, store);
  assert(result.status === "INTEGRATED", `expected INTEGRATED, got ${result.status}: ${result.reason}`);
});

check("D. real relationship exists but cited evidence file does not exist -> NOT_INTEGRATED", () => {
  const result = verifyIntegration({ capability_id: targetCapabilityId, proofs: [{ consumer_capability_id: consumerCapabilityId, relationship_kind: "CAPABILITY_TO_DEPENDENCY", test_evidence_ref: "control/integration-verification/tests/no-such-file.test.ts" }], correlation_id: "c5" }, store);
  assert(result.status === "NOT_INTEGRATED", `expected NOT_INTEGRATED, got ${result.status}`);
  assert(result.verified_consumers[0].evidence_file_exists === false, "evidence_file_exists must be false");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
