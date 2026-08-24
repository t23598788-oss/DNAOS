/**
 * หน้าที่: Phase 10 — runs every VERIFIED/PARTIAL Hostinger source pointer
 * in `./sources/source-map.ts` through the real, existing
 * `control/registration-pipeline/` (Candidate -> Validation ->
 * Classification -> Duplicate Resolution -> Registration Decision ->
 * Repository Resolution -> Registry Writer -> Persistent Software
 * Registry) exactly as `reports/SYSTEM_ADDRESSABILITY_REPORT.md` and
 * `control/system-reference-resolution/tests/phase7-registration.test.ts`
 * already document that chain. No new registry, no new database — this
 * reuses the one real persistent store
 * (`software/registry-database/adapters/persistent-file-store.ts`), the
 * same construction `transport/owner-command-http/server.ts` already
 * uses.
 *
 * Classification: resource_type=PROVIDER_REFERENCE (an existing,
 * pre-registered enum value in
 * `control/event-pipeline/domain-classification.ts` — never invented for
 * this task) resolves to domain=INFRASTRUCTURE_CONTROL. No
 * requested_owner/requested_repository is set, so Repository Resolution
 * correctly returns NOT_APPLICABLE for every one of these (an external
 * documentation/repository pointer is not a claim on this repo's own git
 * ownership).
 *
 * Input: none (reads ./sources/source-map.ts).
 * Output: prints one line per candidate with the real PipelineResult.
 * Dependency ที่อนุญาต: node:crypto, ../../control/registration-pipeline/contract,
 * ../../software/registry-database/adapters/persistent-file-store,
 * ./sources/source-map, ./sources/types.
 * สิ่งที่ห้ามแตะ: never set candidate.requested_owner/requested_repository
 * for these rows — they are not a git ownership claim.
 */

import { randomUUID } from "node:crypto";
import { runRegistrationPipeline } from "../../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../../control/event-pipeline/contract";
import { createPersistentFileStore } from "../../software/registry-database/adapters/persistent-file-store";
import { HOSTINGER_SOURCE_POINTERS } from "./sources/source-map";

function toCandidate(source: (typeof HOSTINGER_SOURCE_POINTERS)[number]): RegistrationCandidate {
  return {
    candidate_id: `candidate-${randomUUID()}`,
    name: source.source_name,
    kind: "resource",
    source_location: source.official_url,
    owner: "hostinger",
    input: [],
    output: [source.content_category],
    side_effects: [],
    dependencies: [],
    behavior: `External live intelligence source pointer: ${source.capability_scope}`,
    version: "1",
    evidence_refs: [source.official_url, source.documentation_pointer],
    domain: "INFRASTRUCTURE_CONTROL",
    resource_type: "PROVIDER_REFERENCE",
    data_classification: "public",
    source_system: "hostinger",
    scope: source.relationship,
  };
}

async function main(): Promise<void> {
  const store = createPersistentFileStore();
  for (const source of HOSTINGER_SOURCE_POINTERS) {
    const candidate = toCandidate(source);
    const result = runRegistrationPipeline(candidate, store, `hostinger-source-registration-${source.source_id}`);
    console.log(JSON.stringify({ source_id: source.source_id, result }));
  }
}

void main();
