/**
 * หน้าที่: proves `classifyCandidate`/`fingerprintCandidate` in
 * ../registration-contract.ts. STEP "Refactor Registration Pipeline to
 * Single-Owner Sequential Stages" narrowed this file's job to
 * Classification only — it used to also decide duplicates
 * (`evaluateRegistration`, checking a caller-supplied `existing` array)
 * and evidence-shape (`REJECTED_EVIDENCE`); both moved out (duplicate
 * detection to control/registration-pipeline/duplicate-resolution.ts,
 * which queries the real canonical registry instead of a caller snapshot;
 * evidence-shape to control/registration-pipeline/validation.ts). This
 * test proves `classifyCandidate` now does ONLY classification — it never
 * touches duplicate detection or evidence presence at all.
 *
 * How to run: npx tsx control/event-pipeline/tests/registration-contract.test.ts
 */

import { classifyCandidate, fingerprintCandidate, type RegistrationCandidate } from "../contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function baseCandidate(overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return {
    candidate_id: "candidate-base",
    name: "base-capability",
    kind: "capability",
    source_location: "software/capability-registrar/index.ts",
    owner: "software/capability-registrar/",
    input: ["capabilityId: string"],
    output: ["CapabilityMetadata | undefined"],
    side_effects: [],
    dependencies: ["control/command-router/capability-registry.ts"],
    behavior: "look up a capability by id in the in-memory index",
    version: "1.0.0",
    evidence_refs: ["software/capability-registrar/tests/index.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "software_registry",
    ...overrides,
  };
}

function run(): void {
  console.log("=== control/event-pipeline/tests/registration-contract.test.ts ===");

  {
    const candidate = baseCandidate();
    const result = classifyCandidate(candidate);
    assert(result.decision === "ACCEPT", `a real software resource_type is ACCEPT (got ${result.decision})`);
    console.log("PASS: real software resource_type -> ACCEPT");
  }

  {
    // classifyCandidate never touches evidence at all — even with zero
    // evidence_refs, a real, known resource_type still classifies as
    // ACCEPT. Evidence-shape is control/registration-pipeline/validation.ts's
    // job now, upstream, before classification ever runs in the real pipeline.
    const candidate = baseCandidate({ evidence_refs: [] });
    const result = classifyCandidate(candidate);
    assert(result.decision === "ACCEPT", `classifyCandidate ignores evidence_refs entirely — it is not this stage's concern (got ${result.decision})`);
    console.log("PASS: classifyCandidate never rejects on missing evidence — that is Validation's job now");
  }

  {
    // classifyCandidate never touches duplicate detection either — two
    // identical candidates both classify ACCEPT independently; nothing
    // about a caller-supplied "existing" list exists any more.
    const first = classifyCandidate(baseCandidate({ candidate_id: "candidate-existing" }));
    const second = classifyCandidate(baseCandidate({ candidate_id: "candidate-existing" }));
    assert(first.decision === "ACCEPT" && second.decision === "ACCEPT", "classifyCandidate has no concept of duplicates — both calls independently ACCEPT");
    console.log("PASS: classifyCandidate never decides duplicate — that is control/registration-pipeline/duplicate-resolution.ts's exclusive job");
  }

  {
    const existing = baseCandidate({ candidate_id: "candidate-original", name: "original-name", source_location: "software/capability-registrar/index.ts", version: "1.0.0" });
    const renamed = baseCandidate({ candidate_id: "candidate-renamed", name: "renamed-capability", source_location: "software/capability-registrar/index-v2.ts", version: "2.0.0" });
    assert(fingerprintCandidate(existing).semantic === fingerprintCandidate(renamed).semantic, "the two candidates really do share one semantic fingerprint despite differing name/id/source_location/version — the exact property Duplicate Resolution relies on");
    assert(fingerprintCandidate(existing).exact !== fingerprintCandidate(renamed).exact, "their exact fingerprints differ (proves this is a semantic match, not an exact one)");
    console.log("PASS: fingerprintCandidate still produces the exact/semantic split Duplicate Resolution depends on");
  }

  console.log("=== ALL registration-contract.test.ts CASES PASSED ===");
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
