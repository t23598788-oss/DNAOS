/**
 * หน้าที่: proves the Registration Data Domain Isolation boundary —
 * ../domain-classification.ts, wired into ../registration-contract.ts's
 * classifyCandidate() (Classification, stage 2 of
 * control/registration-pipeline/) and run through the full real pipeline
 * (control/registration-pipeline/contract.ts's runRegistrationPipeline).
 * Every scenario runs the whole real path — classifier -> pipeline ->
 * writer — never asserting against the classifier in isolation for the
 * accept/reject cases, so a bypass at any one layer would still be
 * caught by this test. STEP "Refactor Registration Pipeline to
 * Single-Owner Sequential Stages" moved domain classification to run
 * exactly once, inside the pipeline — this test now proves that single
 * real path, not a hand-assembled decision object.
 *
 * How to run: npx tsx control/event-pipeline/tests/domain-classification.test.ts
 */

import { classifyRegistrationDomain, classifyRegistrationBatch, type DomainClassificationInput } from "../domain-classification";
import type { RegistrationCandidate } from "../contract";
import { runRegistrationPipeline } from "../../registration-pipeline/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";

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

function baseCandidate(overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return {
    candidate_id: `candidate-${Math.random().toString(36).slice(2)}`,
    name: `test-candidate-${Math.random().toString(36).slice(2)}`,
    kind: "capability",
    source_location: "software/some-module/index.ts",
    owner: "software/some-module/",
    input: ["x: string"],
    output: ["y: string"],
    side_effects: [],
    dependencies: [],
    behavior: "does something software-shaped",
    version: "1.0.0",
    evidence_refs: ["software/some-module/tests/index.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "software_registry",
    ...overrides,
  };
}

function main(): void {
  const store = createLocalFileStore();

  // UI_SURFACE -> ACCEPT
  check("UI_SURFACE -> ACCEPT (classifier and pipeline agree)", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-ui-surface", resource_type: "UI_SURFACE" });
    const classified = classifyRegistrationDomain({ domain: candidate.domain, resource_type: candidate.resource_type, source_system: candidate.source_system });
    assert(classified.routing_result === "ACCEPT_SOFTWARE_REGISTRATION", `expected ACCEPT_SOFTWARE_REGISTRATION, got ${classified.routing_result}`);
    const result = runRegistrationPipeline(candidate, store, "corr-ui-surface");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}`);
  });

  // CAPABILITY -> ACCEPT
  check("CAPABILITY -> ACCEPT", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-capability", resource_type: "CAPABILITY" });
    const result = runRegistrationPipeline(candidate, store, "corr-capability");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}`);
  });

  // TEST_RESULT -> ACCEPT (ENGINEERING_EVIDENCE domain)
  check("TEST_RESULT -> ACCEPT (ENGINEERING_EVIDENCE domain)", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-test-result", resource_type: "TEST_RESULT", domain: "ENGINEERING_EVIDENCE" });
    const result = runRegistrationPipeline(candidate, store, "corr-test-result");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}`);
  });

  // INVOICE -> REJECT_BUSINESS_DATA
  check("INVOICE -> REJECTED at CLASSIFICATION, never reaches the writer's entity-table write path", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-invoice", resource_type: "INVOICE" as RegistrationCandidate["resource_type"], domain: "BUSINESS_OPERATIONAL_DATA" as RegistrationCandidate["domain"] });
    const result = runRegistrationPipeline(candidate, store, "corr-invoice");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.status === "REJECTED" && result.failed_stage === "CLASSIFICATION", `expected failed_stage=CLASSIFICATION, got ${result.status === "REJECTED" ? result.failed_stage : "n/a"}`);
    assert(result.status === "REJECTED" && result.reason_code === "BUSINESS_DATA_NOT_ALLOWED", "expected reason_code BUSINESS_DATA_NOT_ALLOWED");
  });

  // CUSTOMER -> REJECT_BUSINESS_DATA
  check("CUSTOMER -> REJECTED", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-customer", resource_type: "CUSTOMER" as RegistrationCandidate["resource_type"], domain: "BUSINESS_OPERATIONAL_DATA" as RegistrationCandidate["domain"] });
    const result = runRegistrationPipeline(candidate, store, "corr-customer");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
  });

  // PAYMENT -> REJECT_BUSINESS_DATA
  check("PAYMENT -> REJECTED", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-payment", resource_type: "PAYMENT" as RegistrationCandidate["resource_type"], domain: "BUSINESS_OPERATIONAL_DATA" as RegistrationCandidate["domain"] });
    const result = runRegistrationPipeline(candidate, store, "corr-payment");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
  });

  // Spoofed candidate: domain=SOFTWARE_CONTROL_PLANE but resource_type=INVOICE -> REJECT
  check("spoofed candidate (domain=SOFTWARE_CONTROL_PLANE, resource_type=INVOICE) is rejected, never trusting the declared domain", () => {
    const candidate = baseCandidate({ candidate_id: "candidate-spoofed", resource_type: "INVOICE" as RegistrationCandidate["resource_type"], domain: "SOFTWARE_CONTROL_PLANE" });
    const classified = classifyRegistrationDomain({ domain: candidate.domain, resource_type: candidate.resource_type, source_system: candidate.source_system });
    assert(classified.routing_result === "REJECT_BUSINESS_DATA", `expected the resource_type ground truth to win regardless of declared domain, got ${classified.routing_result}`);
    // There is no decision object left to forge under the single-owner
    // pipeline — classifyCandidate is the only place domain is ever
    // decided, called exactly once, always from the candidate's own
    // resource_type. The real protection is architectural now: this IS
    // the only path, and it still refuses.
    const result = runRegistrationPipeline(candidate, store, "corr-spoofed");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.status === "REJECTED" && result.failed_stage === "CLASSIFICATION", "expected the rejection to come from CLASSIFICATION, not some later stage");
  });

  // Mixed payload: software + invoice in one batch -> REJECT / SPLIT_REQUIRED
  check("mixed payload (software + invoice) -> REJECT_BUSINESS_DATA with MIXED_DOMAIN_SPLIT_REQUIRED", () => {
    const inputs: DomainClassificationInput[] = [
      { domain: "SOFTWARE_CONTROL_PLANE", resource_type: "MODULE", source_system: "dna-os-infrastructure" },
      { domain: "BUSINESS_OPERATIONAL_DATA", resource_type: "INVOICE", source_system: "dna-os-infrastructure" },
    ];
    const batch = classifyRegistrationBatch(inputs);
    assert(batch.routing_result === "REJECT_BUSINESS_DATA", `expected REJECT_BUSINESS_DATA for a mixed batch, got ${batch.routing_result}`);
    assert(batch.reason_code === "MIXED_DOMAIN_SPLIT_REQUIRED", `expected MIXED_DOMAIN_SPLIT_REQUIRED, got ${batch.reason_code}`);
    assert(batch.items.length === 2, "expected one classification result per item, so the caller can identify what to split");
  });

  // Registry Writer is only ever called with an accepted software domain in this suite's ACCEPT cases —
  // proven by every ACCEPT check above actually calling runRegistrationPipeline() and asserting REGISTERED,
  // and every REJECT check above asserting REJECTED. This final check confirms no business row
  // ever landed in the store across the whole suite.
  check("Registry Writer never wrote a business-domain row across this entire suite", () => {
    const counts = store.debugCounts();
    // Exactly 3 ACCEPT cases (UI_SURFACE, CAPABILITY, TEST_RESULT) should have written; each is capability-kind so each produces one resource + one capability.
    assert(counts.resources === 3, `expected exactly 3 resource rows (one per ACCEPT case), got ${counts.resources}`);
    assert(counts.capabilities === 3, `expected exactly 3 capability rows (one per ACCEPT case), got ${counts.capabilities}`);
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
