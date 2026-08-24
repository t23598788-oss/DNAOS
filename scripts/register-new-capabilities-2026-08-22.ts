/**
 * หน้าที่: one-off registration of the two new capabilities built in the
 * 2026-08-22 "DIGITALOCEAN ARCHITECTURE REBUILD" round —
 * `control/connector-execution-boundary/` and
 * `providers/_shared/source-registry/` — through the real, unmodified
 * `control/registration-pipeline/` -> Persistent Software Registry.
 * Section 14: "ทุก capability/module/source/connection ที่ VERIFIED แล้ว
 * ต้องผ่าน Candidate -> Duplicate Gate -> Registry Writer -> Persistent
 * Software Registry ก่อนถือว่างานจบ."
 *
 * How to run: npx tsx scripts/register-new-capabilities-2026-08-22.ts
 */

import { randomUUID } from "node:crypto";
import { runRegistrationPipeline } from "../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../control/event-pipeline/contract";
import { createPersistentFileStore } from "../software/registry-database/adapters/persistent-file-store";

const store = createPersistentFileStore();

const candidates: RegistrationCandidate[] = [
  {
    candidate_id: `candidate-${randomUUID()}`,
    name: "connector-execution-boundary",
    kind: "capability",
    source_location: "control/connector-execution-boundary/contract.ts",
    owner: "dna-os-infrastructure",
    input: ["CommandEnvelope", "capability_id"],
    output: ["ConnectorBoundaryOutcome"],
    side_effects: ["calls a real provider adapter over the network (read-only, provider-defined)"],
    dependencies: ["control/command-router/router.ts", "connections/digitalocean/router-invoker.ts"],
    behavior: "Generic, provider-agnostic dependency-injection seam between the command router and any provider connector whose real entry point needs extra deps (AccountBindingProvider/CredentialProvider) beyond a bare CommandEnvelope.",
    version: "1",
    evidence_refs: ["control/command-router/tests/digitalocean-connector-routing.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "internal",
    source_system: "dna-os-infrastructure",
    scope: "router-to-connector-dependency-injection",
  },
  {
    candidate_id: `candidate-${randomUUID()}`,
    name: "external-source-registry",
    kind: "capability",
    source_location: "providers/_shared/source-registry/",
    owner: "dna-os-infrastructure",
    input: ["SourcePointer"],
    output: ["CurrentStateResult", "ContractDiffResult", "ChangeLogEntry"],
    side_effects: ["fetches a public official provider source over HTTPS (read-only)"],
    dependencies: ["control/registration-pipeline/contract.ts", "software/registry-database/adapters/persistent-file-store.ts"],
    behavior: "Generic, provider-agnostic SourcePointer identity registration + transient replaceable Current-State resolution + generic OpenAPI Contract Diff Engine. Never persists dynamic external content permanently; change-log stores fingerprint metadata only.",
    version: "1",
    evidence_refs: ["providers/_shared/source-registry/tests/current-state.test.ts", "providers/_shared/source-registry/tests/contract-diff.test.ts"],
    domain: "SOFTWARE_CONTROL_PLANE",
    resource_type: "CAPABILITY",
    data_classification: "internal",
    source_system: "dna-os-infrastructure",
    scope: "external-provider-source-tracking",
  },
];

for (const candidate of candidates) {
  const result = runRegistrationPipeline(candidate, store, `capability-registration-${candidate.name}`);
  console.log(JSON.stringify({ name: candidate.name, result }));
}
