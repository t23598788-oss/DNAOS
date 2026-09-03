/** Deterministic, isolated proof for the shared canonical Resource read contract. */
import { createPersistentFileStore } from "../adapters/persistent-file-store";
import { resolveCanonicalResource } from "../contract";
import type { ApprovedCandidateWrite, RegistryStore } from "../store-port";
import { resolveWriteIntent } from "../../../control/work-resolution/contract";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.error(`FAIL ${name}`, detail === undefined ? "" : JSON.stringify(detail)); }
}

function addResource(store: RegistryStore, suffix: string, capabilityId: string, repositoryId: string | null = null): string {
  const resourceId = `resource-canonical-resolution-${suffix}`;
  const input: ApprovedCandidateWrite = {
    resource: { resource_id: resourceId, resource_type: "capability", owner_id: "canonical-resolution-test", repository_id: repositoryId, source_location: `test-fixtures/canonical-resolution/${suffix}.ts`, module: null, version: "1.0.0", content_hash: `hash-${suffix}`, status: "REGISTERED" },
    capability: { capability_id: capabilityId, canonical_name: `canonical-resolution-${suffix}`, capability_type: "capability", purpose: "canonical resource resolution test", input_contract: [], output_contract: [], side_effects: [], semantic_fingerprint: `semantic-${suffix}`, ingress_metadata: null },
    relationships: [],
    version: { resource_id: resourceId, version: "1.0.0", commit_sha: null, hash: `hash-${suffix}`, source_location: `test-fixtures/canonical-resolution/${suffix}.ts`, evidence_ref: "canonical-resource-resolution.test.ts" },
    evidence: [],
  };
  store.writeApprovedCandidate(input);
  return resourceId;
}

function run(): void {
  const one = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-one-${Date.now()}` });
  const oneId = addResource(one, "one", "cap-one");
  const resolved = resolveCanonicalResource({ capability_id: "cap-one" }, one);
  check("1. one eligible Resource resolves to its exact ID", resolved.status === "RESOLVED" && resolved.resource_id === oneId, resolved);

  const two = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-two-${Date.now()}` });
  const first = addResource(two, "first", "cap-two");
  const second = addResource(two, "second", "cap-two");
  const ambiguous = resolveCanonicalResource({ capability_id: "cap-two" }, two);
  check("2. two eligible Resources are AMBIGUOUS", ambiguous.status === "AMBIGUOUS", ambiguous);
  check("3. ambiguity names sorted candidate IDs, never first array element", ambiguous.status === "AMBIGUOUS" && JSON.stringify(ambiguous.candidate_resource_ids) === JSON.stringify([first, second].sort()));

  const reversed = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-reversed-${Date.now()}` });
  addResource(reversed, "second", "cap-two");
  addResource(reversed, "first", "cap-two");
  const reversedResult = resolveCanonicalResource({ capability_id: "cap-two" }, reversed);
  check("4. reversing insertion order keeps the same AMBIGUOUS result", reversedResult.status === "AMBIGUOUS" && JSON.stringify(reversedResult.candidate_resource_ids) === JSON.stringify(ambiguous.status === "AMBIGUOUS" ? ambiguous.candidate_resource_ids : []));

  const missing = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-missing-${Date.now()}` });
  const noMatch = resolveCanonicalResource({ capability_id: "missing-capability" }, missing);
  check("5. missing capability returns deterministic UNRESOLVED", noMatch.status === "UNRESOLVED" && noMatch.reason_code === "CAPABILITY_NOT_FOUND");

  const explicit = resolveCanonicalResource({ explicit_resource_id: oneId }, one);
  check("6. explicit resource ID returns exact historical identity", explicit.status === "RESOLVED" && explicit.resource_id === oneId);
  const explicitMissing = resolveCanonicalResource({ explicit_resource_id: "resource-does-not-exist" }, one);
  check("7. missing explicit resource ID fails closed", explicitMissing.status === "UNRESOLVED" && explicitMissing.reason_code === "NO_RESOURCE_MATCH");

  const mismatch = resolveCanonicalResource({ explicit_resource_id: oneId, expected_repository_id: "repository://not-this-resource" }, one);
  check("8. repository mismatch never falls back", mismatch.status === "INELIGIBLE" && mismatch.reason_code === "REPOSITORY_MISMATCH");

  const unprovenRepository = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-repository-${Date.now()}` });
  const boundId = addResource(unprovenRepository, "bound", "cap-bound", "repository://missing/active-repository");
  const missingRepository = resolveCanonicalResource({ explicit_resource_id: boundId, expected_repository_id: "repository://missing/active-repository" }, unprovenRepository);
  check("9. missing repository provenance fails closed", missingRepository.status === "UNRESOLVED" && missingRepository.reason_code === "REPOSITORY_NOT_FOUND");
  const world = resolveCanonicalResource({ explicit_resource_id: boundId, expected_world: "CONTROL_PLANE" }, unprovenRepository);
  check("10. world is not inferred without authoritative repository", world.status === "UNRESOLVED");

  const workOne = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-work-one-${Date.now()}` });
  const workName = `canonical-resolution-work-one-${Date.now()}`;
  const workCap = `cap-${workName}`;
  addResource(workOne, "work-one", workCap);
  const workResolved = resolveWriteIntent({ requested_function: workName, requested_change: "x", target_domain: "control/work-resolution", owner_intent: "x", current_work_id: "work-canonical-one" }, workOne);
  check("11. work-resolution can consume one canonical Resource", workResolved.existing_capability_id === UNKNOWN_CAPABILITY_SENTINEL ? false : true, workResolved);

  const workTwo = createPersistentFileStore({ dataDir: `tests/__sandbox__/canonical-resource-resolution-work-two-${Date.now()}` });
  const ambiguousWorkName = `canonical-resolution-work-two-${Date.now()}`;
  const ambiguousWorkCap = `cap-${ambiguousWorkName}`;
  addResource(workTwo, "work-two-a", ambiguousWorkCap);
  addResource(workTwo, "work-two-b", ambiguousWorkCap);
  const workAmbiguous = resolveWriteIntent({ requested_function: ambiguousWorkName, requested_change: "x", target_domain: "control/work-resolution", owner_intent: "x", current_work_id: "work-canonical-two" }, workTwo);
  check("12. work-resolution records canonical Resource ambiguity", workAmbiguous.resolution_path.some((probe) => probe.source === "CANONICAL_RESOURCE_RESOLUTION" && /AMBIGUOUS/.test(probe.detail)), workAmbiguous.resolution_path);
  check("13. work-resolution does not dispatch with resource_ids[0]", workAmbiguous.existing_resource_id === "UNKNOWN" && workAmbiguous.dispatchable === false, workAmbiguous);

  const purposeUnproven = resolveCanonicalResource({ capability_id: "cap-one", purpose: "unmapped-purpose" }, one);
  check("14. unproven purpose compatibility fails closed", purposeUnproven.status === "UNRESOLVED" && purposeUnproven.reason_code === "PURPOSE_COMPATIBILITY_UNPROVEN");

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

const UNKNOWN_CAPABILITY_SENTINEL = "UNKNOWN";

run();
