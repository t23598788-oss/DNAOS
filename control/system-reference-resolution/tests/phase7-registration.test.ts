/**
 * หน้าที่: Phase 7 (Registration) proof — this round's one MATERIAL new
 * capability (`resolveSystemReference`, this folder) goes through the
 * real, current pipeline: Candidate -> Duplicate Gate ->
 * Registry Writer -> Persistent Software Registry -> read-back
 * verification, via `control/registration-pipeline/contract.ts`'s
 * `runRegistrationPipeline` — never a hand-written insert.
 *
 * Runs against `software/registry-database/adapters/local-file-store.ts`,
 * the same non-durable-across-restart store every other registration in
 * this repo runs against today — no live Postgres/Supabase connection
 * exists yet (see `../../../software/registry-database/migrations/
 * MIGRATION_PLAN.md`: NOT EXECUTED). This is the same honest constraint
 * already documented there, not a new gap introduced by this round.
 *
 * The small `connections/os-ui/adapter-contract.ts` extension
 * (`resolveOsUiTargetLocator`) is NOT separately registered here: os-ui
 * is tracked in `control/command-router/`'s static, hand-edited
 * `CAPABILITY_REGISTRY`, not in `software/registry-database/` — there is
 * no existing resource_id/capability_id for it in THIS registry to
 * ADD_VERSION against. Reported honestly rather than forcing a fabricated
 * registration into the wrong registry.
 *
 * How to run: npx tsx control/system-reference-resolution/tests/phase7-registration.test.ts
 */

import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import { findCapability } from "../../../software/registry-database/contract";
import { createLocalFileStore } from "../../../software/registry-database/adapters/local-file-store";
import type { RegistrationCandidate } from "../../../control/event-pipeline/contract";
import type { RegistryStore } from "../../../software/registry-database/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-system-reference-resolution-v1",
  name: "system-reference-resolution.resolve-system-reference",
  kind: "capability",
  source_location: "control/system-reference-resolution/resolver.ts",
  owner: "control/system-reference-resolution/",
  input: ["request: SystemReferenceRequest", "context: SystemReferenceContext"],
  output: ["SystemReferenceResolution"],
  side_effects: [],
  dependencies: [
    "control/command-router/contract.ts#listCapabilities",
    "software/registry-database/contract.ts#findCapability",
    "software/repository-registry/contract.ts#listRepositories",
    "connections/os-ui/adapter-contract.ts#resolveOsUiTargetLocator",
  ],
  behavior: "deterministic lookup: turns a plain Owner-facing target name into existing registered ids (capability_id/resource_id/repository_id/ui_ref/action_ref) by querying four existing registries; never guesses, never creates a new record, never reads source code",
  version: "1.0.0",
  evidence_refs: [
    "control/system-reference-resolution/contract.ts",
    "control/system-reference-resolution/resolver.ts",
    "control/system-reference-resolution/types.ts",
    "control/system-reference-resolution/tests/resolve-system-reference.test.ts",
    "control/system-reference-resolution/tests/direct-action-proof.test.ts",
    "control/system-reference-resolution/tests/stale-reference-protection.test.ts",
  ],
  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "software_registry",
};

function run(): void {
  console.log("=== control/system-reference-resolution/tests/phase7-registration.test.ts ===");
  const store: RegistryStore = createLocalFileStore();

  let registeredCapabilityId = "";
  let registeredResourceId = "";

  // 1. Candidate -> Duplicate Gate -> Registry Writer -> Persistent Software Registry
  {
    const result = runRegistrationPipeline(CANDIDATE, store, "corr-phase7-system-reference-resolution");
    assert(result.status === "REGISTERED", `the real candidate registers cleanly through the real pipeline (got ${result.status})`);
    assert(result.status === "REGISTERED" && result.resource_id !== "" && result.capability_id !== null, "a real resource_id and capability_id were produced");
    registeredResourceId = (result as Extract<typeof result, { status: "REGISTERED" }>).resource_id;
    registeredCapabilityId = (result as Extract<typeof result, { status: "REGISTERED" }>).capability_id!;
    console.log(`PASS: Candidate -> Duplicate Gate -> Registry Writer -> Persistent Software Registry (resource_id=${registeredResourceId}, capability_id=${registeredCapabilityId})`);
  }

  // 2. Read-back verification
  {
    const readBack = findCapability({ capability_id: registeredCapabilityId }, store);
    assert(readBack !== null, "findCapability() finds the just-registered capability by capability_id");
    assert(readBack!.capability_id === registeredCapabilityId, "read-back capability_id matches what the pipeline returned");
    assert(readBack!.resource_ids.includes(registeredResourceId), "read-back resource_ids includes the same resource_id the pipeline returned");
    assert(readBack!.source_location.includes(CANDIDATE.source_location), "read-back source_location matches the real file this capability lives in");
    console.log("PASS: read-back verification — same capability returned from the persistent registry");
  }

  // 3. Resubmission is caught by the real Duplicate Gate, never re-registered
  {
    const resubmit = runRegistrationPipeline(CANDIDATE, store, "corr-phase7-resubmit");
    assert(resubmit.status === "DUPLICATE", `resubmitting the identical candidate is caught as DUPLICATE, not registered again (got ${resubmit.status})`);
    console.log(`PASS: resubmission -> DUPLICATE (${resubmit.status === "DUPLICATE" ? resubmit.reason_code : "n/a"}), no second row created`);
  }

  console.log(`=== ALL phase7-registration.test.ts CASES PASSED (REGISTERED_CAPABILITY_ID=${registeredCapabilityId}, REGISTERED_RESOURCE_ID=${registeredResourceId}) ===`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exitCode = 1;
}
