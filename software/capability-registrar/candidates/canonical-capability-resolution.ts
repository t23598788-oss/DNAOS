/**
 * หน้าที่: the `RegistrationCandidate` for registry-driven capability
 * resolution — the four-tier matcher that answers "which capability is this
 * task for" from registry rows instead of from words in a sentence.
 *
 * WHY IT IS A CAPABILITY AND NOT JUST AN EDIT TO THE GATEWAY: the same answer
 * is needed by two independent callers — `connections/n8n/event-router.ts`
 * before it dispatches, and `control/agent-gateway/` when a task arrives —
 * and both now resolve through one shared contract
 * (`contracts/command/route-group-capabilities.ts`) and one resolver. A
 * behaviour with two consumers, its own contract and its own tests is a
 * capability; leaving it unregistered would mean the thing that decides
 * ownership is itself unowned.
 *
 * WHAT IT IS NOT: it is not authority. Resolving a capability answers "who is
 * this for", never "may it run". Policy, Admission, the write gate and the
 * execution gate all run afterwards, unchanged, and a resolution that reaches
 * one and is refused is a correct outcome.
 *
 * Input: none (one const value).
 * Output: `CANONICAL_CAPABILITY_RESOLUTION_CANDIDATE`.
 * Dependency ที่อนุญาต: `../../../control/event-pipeline/registration-contract.ts` (type only).
 * สิ่งที่ห้ามแตะ: never edit `evidence_refs` to name a run that did not
 * happen — Duplicate Resolution fingerprints normalized content, so an edit
 * to an already-registered record creates a SECOND resource rather than
 * updating the first.
 */

import type { RegistrationCandidate } from "../../../control/event-pipeline/registration-contract";

export const CANONICAL_CAPABILITY_RESOLUTION_CANDIDATE: RegistrationCandidate = {
  candidate_id: "candidate-canonical-capability-resolution-v1",
  name: "canonical-capability-resolution",
  kind: "capability",
  source_location: "control/agent-gateway/capability-resolver.ts + contracts/command/route-group-capabilities.ts",
  owner: "DNA-OS-INFRASTRUCTURE/software/capability-registrar/candidates/canonical-capability-resolution.ts",

  input: [
    "CapabilityMatchRequest: intent_text, route_group, target_capability_id, target_capability_name, event_type, error_code, work_id, trace_id, evidence_ref",
  ],
  output: [
    "CapabilityMatchResult: MATCH_METHOD (EXACT_CAPABILITY_ID | EXACT_CANONICAL_NAME | REGISTRY_ROUTE_GROUP | LEGACY_SUBSTRING | NO_EXISTING_CAPABILITY), MATCHED_CAPABILITY_ID, REGISTRY_REF, REASON, EVIDENCE_REF",
    "the gateway capability-index row when one exists, and null when the resolving registry carries no execution_method",
    "every candidate considered, which registry was asked, and why it was or was not taken",
  ],
  side_effects: [
    "reads only: the gateway capability index, control/command-router CAPABILITY_REGISTRY, and the persistent software registry",
    "writes nothing; the calling gateway records the match as capability_lookup evidence",
  ],
  dependencies: [
    "contracts/command/route-group-capabilities (the shared ten-group search order)",
    "control/command-router (routable capability registry)",
    "software/registry-database (persistent software registry)",
    "reports/phase16-world-evidence/capability_index.json (the gateway's executable index)",
  ],

  behavior:
    "resolve_capability_from_registry_evidence_in_four_tiers: matches an exact capability id, then an exact canonical name, then a route group through the shared search order, and only then falls back to the pre-existing three-substring matcher kept for backward compatibility. Every match names the registry row that answered and records every candidate that did not; a resolution that no registry supports returns NO_EXISTING_CAPABILITY rather than a guess. A capability resolved from a registry that carries no execution_method is reported as the owner with the gateway explicitly declining to execute on its behalf.",

  version: "1.0.0",

  evidence_refs: [
    "control/agent-gateway/capability-resolver.ts",
    "contracts/command/route-group-capabilities.ts",
    "control/agent-gateway/tests/route-group-matching.test.ts (9 tests, passing)",
    "all ten canonical route groups resolve to a real registry row via REGISTRY_ROUTE_GROUP",
    "the three legacy substring intents still resolve to file_duplicate_or_orphan_detection, server_hang_or_timeout and external_system_lifecycle_registration unchanged",
    "a registry tier provably wins over the substring matcher for the same sentence",
    "live replay: 10 n8n-classified events reached the gateway and were matched EXACT_CAPABILITY_ID with a citable REGISTRY_REF, replacing 213 recorded NO_EXISTING_CAPABILITY blocks",
    "live acceptance: task-aa864d0a-0d94-441a-8bc3-c86f86d75817 matched REGISTRY_ROUTE_GROUP -> file_duplicate_or_orphan_detection, passed the policy gate (NOT_A_WRITE_INTENT) and reached the dispatch boundary",
    "regression: handoff, capability-routing, router, registration-pipeline, external-system-lifecycle, registry-writer, automation-loop e2e, completion-lifecycle and canonical-flow-trace all pass",
  ],

  domain: "SOFTWARE_CONTROL_PLANE",
  resource_type: "CAPABILITY",
  data_classification: "INTERNAL",
  source_system: "dna-os-infrastructure",
  scope: "routing/capability-resolution",
};
