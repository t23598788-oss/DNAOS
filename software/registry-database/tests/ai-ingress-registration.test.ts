/**
 * หน้าที่: proves the AI_INGRESS schema extension end to end — the real,
 * single-owner pipeline (`control/registration-pipeline/contract.ts`'s
 * `runRegistrationPipeline`) + local file store, no mocks. Uses a
 * clearly-marked TEST FIXTURE identity ("test-fixture-ai-ingress"), never
 * the real "dna-os-mcp" candidate — actual MCP self-registration is a
 * separate, already-completed round; this file proves only that the
 * schema/pipeline extension itself works.
 *
 * Every scenario here uses a distinct `behavior`/`source_location` so
 * unrelated scenarios never collide as DUPLICATE_SEMANTIC against each
 * other in the one shared store this file uses — STEP "Refactor
 * Registration Pipeline to Single-Owner Sequential Stages" made Duplicate
 * Resolution query the real store directly (not a caller-supplied
 * `existing` snapshot scoped per call), so this file's own fixtures must
 * now be genuinely semantically distinct from each other, the same way
 * real candidates would be.
 *
 * How to run: npx tsx software/registry-database/tests/ai-ingress-registration.test.ts
 */

import type { IngressMetadata, RegistrationCandidate } from "../../../control/event-pipeline/contract";
import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import { findCapability } from "../lookup";
import { createLocalFileStore } from "../adapters/local-file-store";

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

const VALID_INGRESS_METADATA: IngressMetadata = {
  canonical_name: "test-fixture-ai-ingress",
  audience: "MACHINE_AGENT_ONLY",
  human_facing: false,
  transport: "MCP",
  endpoint: "http://127.0.0.1:9999/test-fixture-mcp",
  accepted_callers: ["coding_agent", "verifier_agent", "scout_agent", "builder_agent", "tester_agent", "external_ai_worker"],
  purpose: "test_fixture_backend_agent_gateway",
};

const SIX_INGRESS_RELATIONSHIPS = [
  { to_type: "SYSTEM_COMPONENT", to_id: "command_ingress", relationship_kind: "COMMAND_INGRESS" },
  { to_type: "SYSTEM_COMPONENT", to_id: "registration_ingress", relationship_kind: "REGISTRATION_INGRESS" },
  { to_type: "SYSTEM_COMPONENT", to_id: "task_lookup", relationship_kind: "TASK_LOOKUP" },
  { to_type: "SYSTEM_COMPONENT", to_id: "capability_lookup", relationship_kind: "CAPABILITY_LOOKUP" },
  { to_type: "SYSTEM_COMPONENT", to_id: "work_result_return", relationship_kind: "WORK_RESULT_RETURN" },
  { to_type: "SYSTEM_COMPONENT", to_id: "system_status_read", relationship_kind: "SYSTEM_STATUS_READ" },
];

function fixtureCandidate(scenario: string, overrides: Partial<RegistrationCandidate> = {}): RegistrationCandidate {
  return {
    candidate_id: `test-fixture-ai-ingress-candidate-${scenario}-${Math.random().toString(36).slice(2)}`,
    name: `test-fixture-ai-ingress-${scenario}`,
    kind: "capability",
    source_location: `test-fixtures/ai-ingress/${scenario}/`,
    owner: "software/registry-database/tests/ai-ingress-registration.test.ts",
    input: [],
    output: [],
    side_effects: [],
    dependencies: [],
    behavior: `test_fixture_backend_agent_gateway_${scenario}`,
    version: "1.0.0",
    evidence_refs: ["software/registry-database/tests/ai-ingress-registration.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "AI_INGRESS",
    data_classification: "INTERNAL",
    source_system: "dna-os-infrastructure",
    scope: "machine_agent_ingress",
    ingress_metadata: VALID_INGRESS_METADATA,
    relationships: SIX_INGRESS_RELATIONSHIPS,
    ...overrides,
  };
}

function main(): void {
  const store = createLocalFileStore();

  // 1. AI_INGRESS -> REGISTERED
  let acceptedCapabilityId = "";
  check("1. AI_INGRESS with valid ingress_metadata -> REGISTERED", () => {
    const candidate = fixtureCandidate("accept");
    const result = runRegistrationPipeline(candidate, store, "corr-accept");
    assert(result.status === "REGISTERED", `expected REGISTERED, got ${result.status}`);
    assert(result.status === "REGISTERED" && result.capability_id !== null, "expected a real capability_id");
    acceptedCapabilityId = (result as Extract<typeof result, { status: "REGISTERED" }>).capability_id!;
  });

  // 2. INVOICE -> REJECT (unchanged regression check)
  check("2. INVOICE (business data) -> REJECTED at CLASSIFICATION, unchanged by this schema extension", () => {
    const candidate = fixtureCandidate("invoice", { candidate_id: "test-fixture-invoice", resource_type: "INVOICE" as RegistrationCandidate["resource_type"], domain: "BUSINESS_OPERATIONAL_DATA" as RegistrationCandidate["domain"], ingress_metadata: undefined, relationships: undefined });
    const result = runRegistrationPipeline(candidate, store, "corr-invoice");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.status === "REJECTED" && result.failed_stage === "CLASSIFICATION", "expected the rejection to come from CLASSIFICATION");
  });

  // 3. audience=MACHINE_AGENT_ONLY passes (already proven by check 1, asserted explicitly again with a fresh, semantically-distinct candidate)
  check("3. audience=MACHINE_AGENT_ONLY passes Type Validation", () => {
    const candidate = fixtureCandidate("audience-ok");
    const result = runRegistrationPipeline(candidate, store, "corr-audience-ok");
    assert(result.status === "REGISTERED", `expected REGISTERED for audience=MACHINE_AGENT_ONLY, got ${result.status}`);
  });

  // 4. human_facing=true for AI_INGRESS -> REJECT
  check("4. human_facing=true for AI_INGRESS -> REJECTED at CLASSIFICATION, never written", () => {
    const candidate = fixtureCandidate("human-facing", { ingress_metadata: { ...VALID_INGRESS_METADATA, human_facing: true } });
    const result = runRegistrationPipeline(candidate, store, "corr-human-facing");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.status === "REJECTED" && result.failed_stage === "CLASSIFICATION", "expected the rejection to come from CLASSIFICATION (Type Validation is part of that stage)");
    assert(result.status === "REJECTED" && result.reason_code === "HUMAN_FACING_NOT_ALLOWED_FOR_AI_INGRESS", `expected the specific reason, got ${result.status === "REJECTED" ? result.reason_code : "n/a"}`);
  });

  // 5. all six relationship kinds persist and read back
  check("5. all six ingress relationship kinds persist and read back via findCapability()", () => {
    const looked_up = findCapability({ capability_id: acceptedCapabilityId }, store);
    assert(looked_up !== null, "expected the just-registered AI_INGRESS capability to be found");
    assert(looked_up!.ingress_metadata !== null, "expected ingress_metadata to read back non-null");
    assert(looked_up!.ingress_metadata!.audience === "MACHINE_AGENT_ONLY", "expected audience to round-trip correctly");
    assert(looked_up!.ingress_metadata!.human_facing === false, "expected human_facing to round-trip correctly");
    const kinds: string[] = looked_up!.relationships.map((r) => r.relationship_kind).sort();
    const expectedKinds = ["CAPABILITY_LOOKUP", "COMMAND_INGRESS", "REGISTRATION_INGRESS", "SYSTEM_STATUS_READ", "TASK_LOOKUP", "WORK_RESULT_RETURN"].sort();
    for (const kind of expectedKinds) assert(kinds.includes(kind), `expected relationship kind ${kind} to be persisted and read back, got ${JSON.stringify(kinds)}`);
    for (const rel of looked_up!.relationships) {
      if (expectedKinds.includes(rel.relationship_kind)) {
        assert(rel.to_type === "SYSTEM_COMPONENT", `expected to_type SYSTEM_COMPONENT for ${rel.relationship_kind}, got ${rel.to_type}`);
      }
    }
  });

  // 6. invalid relationship -> REJECT
  check("6. an invalid relationship (unknown kind) rejects the whole registration, no partial write", () => {
    const candidate = fixtureCandidate("invalid-relationship", {
      relationships: [{ to_type: "SYSTEM_COMPONENT", to_id: "command_ingress", relationship_kind: "TOTALLY_MADE_UP_KIND" }],
    });
    const countsBefore = store.debugCounts();
    const result = runRegistrationPipeline(candidate, store, "corr-invalid-relationship");
    assert(result.status === "REJECTED", `expected REJECTED, got ${result.status}`);
    assert(result.status === "REJECTED" && result.failed_stage === "REGISTRY_WRITER", `expected the rejection to come from REGISTRY_WRITER (the relationship itself is what's invalid — domain/type validation passes), got ${result.status === "REJECTED" ? result.failed_stage : "n/a"}`);
    assert(result.status === "REJECTED" && result.reason_code.startsWith("RELATIONSHIP_INVALID"), `expected a RELATIONSHIP_INVALID reason_code, got ${result.status === "REJECTED" ? result.reason_code : "n/a"}`);
    const countsAfter = store.debugCounts();
    assert(countsAfter.resources === countsBefore.resources && countsAfter.capabilities === countsBefore.capabilities, "expected zero rows written — fail-closed, no partial write");

    const mismatchedTarget = fixtureCandidate("mismatched-relationship", {
      relationships: [{ to_type: "SYSTEM_COMPONENT", to_id: "task_lookup", relationship_kind: "COMMAND_INGRESS" }],
    });
    const mismatchedResult = runRegistrationPipeline(mismatchedTarget, store, "corr-mismatched-relationship");
    assert(mismatchedResult.status === "REJECTED" && mismatchedResult.failed_stage === "REGISTRY_WRITER", "expected a mismatched SYSTEM_COMPONENT target (right kind, wrong to_id) to also be rejected at REGISTRY_WRITER");
  });

  // 7. existing resource types unaffected (non-AI_INGRESS candidate, no ingress_metadata/relationships)
  check("7. an existing resource_type (CAPABILITY) with no ingress_metadata/relationships still registers exactly as before", () => {
    const candidate = fixtureCandidate("plain-capability", {
      resource_type: "CAPABILITY",
      ingress_metadata: undefined,
      relationships: undefined,
    });
    const result = runRegistrationPipeline(candidate, store, "corr-plain-capability");
    assert(result.status === "REGISTERED", `expected a plain CAPABILITY candidate to still register successfully, got ${result.status}`);
    const looked_up = findCapability({ capability_id: (result as Extract<typeof result, { status: "REGISTERED" }>).capability_id! }, store);
    assert(looked_up!.ingress_metadata === null, "expected ingress_metadata to be null for a non-AI_INGRESS capability");
    // relationships (as read back) lists edges FROM this capability outward
    // (CAPABILITY_TO_WORKER, the six ingress kinds, etc.) — the pre-existing
    // FILE->CAPABILITY edge points the other way (from the resource TO this
    // capability), so it correctly does not appear here; that edge's own
    // existence is already proven by registry-writer.test.ts. What matters
    // for regression safety is that this plain candidate carries none of
    // the new ingress-only relationship kinds.
    assert(looked_up!.relationships.length === 0, `expected zero outgoing relationships for a plain CAPABILITY candidate, got ${JSON.stringify(looked_up!.relationships)}`);
  });

  // 8. duplicate AI_INGRESS candidate is deterministic
  check("8. resubmitting the exact same AI_INGRESS candidate is deterministic (DUPLICATE_EXACT), not written twice", () => {
    const candidate = fixtureCandidate("duplicate-check");
    const first = runRegistrationPipeline(candidate, store, "corr-duplicate-check-1");
    assert(first.status === "REGISTERED", `expected first submission REGISTERED, got ${first.status}`);
    const countsBefore = store.debugCounts();
    const second = runRegistrationPipeline(candidate, store, "corr-duplicate-check-2");
    assert(second.status === "DUPLICATE", `expected DUPLICATE on resubmission, got ${second.status}`);
    assert(second.status === "DUPLICATE" && second.reason_code === "DUPLICATE_EXACT", `expected DUPLICATE_EXACT, got ${second.status === "DUPLICATE" ? second.reason_code : "n/a"}`);
    const countsAfter = store.debugCounts();
    assert(countsAfter.capabilities === countsBefore.capabilities, "capability count must be unchanged after a duplicate resubmission");
  });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
