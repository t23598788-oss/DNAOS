/**
 * หน้าที่: the GENERIC candidate builder that turns any provider's
 * `SourcePointer` into a real `RegistrationCandidate` and runs it through
 * the existing, unmodified `control/registration-pipeline/` (Candidate ->
 * Validation -> Classification -> Duplicate Resolution -> Registration
 * Decision -> Repository Resolution -> Registry Writer -> Persistent
 * Software Registry) — the exact same real pipeline
 * `providers/hostinger/register-candidates.ts` already proved works
 * (8/8 REGISTERED, then 8/8 DUPLICATE on re-run). This file is what makes
 * that pattern reusable by DigitalOcean and every future provider without
 * writing a second registration script that duplicates the same logic —
 * Section 12's "GLOBAL PROVIDER RULE."
 *
 * `resource_type: PROVIDER_REFERENCE` (domain INFRASTRUCTURE_CONTROL) is
 * the same pre-existing enum value used for Hostinger — never invented
 * for this task. No `requested_owner`/`requested_repository` is set, so
 * Repository Resolution correctly returns NOT_APPLICABLE for every
 * SourcePointer — an external documentation/repository pointer is not a
 * claim on this repo's own git ownership.
 *
 * Input: a `SourcePointer`.
 * Output: `registerSourcePointer` -> the real `PipelineResult`.
 * Dependency ที่อนุญาต: node:crypto, ../../../control/registration-pipeline/contract,
 * ../../../software/registry-database/adapters/persistent-file-store,
 * ./types.ts.
 * สิ่งที่ห้ามแตะ: never set candidate.requested_owner/requested_repository
 * for a SourcePointer — it is not a git ownership claim. Never embed a
 * dynamic current-state value (price/product/tool-list) into any
 * candidate field — only identity/contract facts belong here (matches
 * `./types.ts`'s own rule).
 */

import { randomUUID } from "node:crypto";
import { runRegistrationPipeline } from "../../../control/registration-pipeline/contract";
import type { RegistrationCandidate } from "../../../control/event-pipeline/contract";
import type { RegistryStore } from "../../../software/registry-database/contract";
import { createPersistentFileStore } from "../../../software/registry-database/adapters/persistent-file-store";
import type { SourcePointer } from "./types";

export function sourcePointerToCandidate(source: SourcePointer): RegistrationCandidate {
  return {
    candidate_id: `candidate-${randomUUID()}`,
    name: `${source.provider_id}:${source.source_id}`,
    kind: "resource",
    source_location: source.official_location,
    owner: source.provider_id,
    input: [],
    output: [source.source_type],
    side_effects: [],
    dependencies: source.relationships.map((r) => `${r.to_type}:${r.to_id}`),
    behavior: `External official source pointer (${source.access_method}, freshness=${source.freshness_mode}, verification=${source.verification_method}) — identity/contract only, no dynamic content persisted`,
    version: "1",
    evidence_refs: [source.official_location],
    domain: "INFRASTRUCTURE_CONTROL",
    resource_type: "PROVIDER_REFERENCE",
    data_classification: "public",
    source_system: source.provider_id,
    scope: source.current_state_reference,
  };
}

let defaultStore: RegistryStore | undefined;
function getDefaultStore(): RegistryStore {
  if (!defaultStore) defaultStore = createPersistentFileStore();
  return defaultStore;
}

export function registerSourcePointer(source: SourcePointer, store: RegistryStore = getDefaultStore(), correlationIdPrefix = "source-pointer-registration") {
  const candidate = sourcePointerToCandidate(source);
  return runRegistrationPipeline(candidate, store, `${correlationIdPrefix}-${source.provider_id}-${source.source_id}`);
}

export function registerAllSourcePointers(sources: readonly SourcePointer[], store: RegistryStore = getDefaultStore()) {
  return sources.map((source) => ({ source_id: source.source_id, result: registerSourcePointer(source, store) }));
}
