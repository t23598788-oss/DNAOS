/**
 * หน้าที่: `RegistryStore` — the storage port every write/read path in this
 * capability goes through. `./registry-writer.ts` and `./lookup.ts` depend
 * only on this interface, never on `./adapters/*` directly, so the same
 * logic runs against `adapters/local-file-store.ts` (tests, no live DB) or
 * `adapters/postgres-store.ts` (real Supabase/Postgres, not invoked this
 * round) without change.
 *
 * Input: none (pure interface + row-mapping types).
 * Output: `RegistryStore`, `ApprovedCandidateWrite`, `WriteOutcome`.
 * Dependency ที่อนุญาต: ./types.ts.
 * สิ่งที่ห้ามแตะ: never let an implementation of `writeApprovedCandidate`
 * skip the uniqueness check on `content_hash`/`semantic_fingerprint` — that
 * check is what makes resubmission idempotent regardless of whether the
 * caller's upstream `existing` snapshot (see
 * `../../control/event-pipeline/registration-contract.ts`) was complete or
 * stale. Never let `appendRegistrationEvent` be conditional — it is called
 * for every decision, approved or not (the append-only audit trail).
 */

import type { CapabilityLookupResult, EvidenceRow, IngressMetadataRow, RelationshipRow, ResourceRow, VersionRow } from "./types";

/** Everything `registerCandidate()` derives from one APPROVED_FOR_REGISTRATION candidate, ready to persist atomically. */
export interface ApprovedCandidateWrite {
  resource: Omit<ResourceRow, "created_at" | "updated_at">;
  capability: {
    capability_id: string;
    canonical_name: string;
    capability_type: string;
    purpose: string;
    input_contract: readonly string[];
    output_contract: readonly string[];
    side_effects: readonly string[];
    semantic_fingerprint: string;
    ingress_metadata: IngressMetadataRow | null;
  } | null;
  relationships: readonly Omit<RelationshipRow, "relationship_id" | "created_at">[];
  version: Omit<VersionRow, "version_id" | "created_at">;
  evidence: readonly Omit<EvidenceRow, "evidence_id" | "created_at">[];
}

export interface WriteOutcome {
  resource_id: string;
  capability_id: string | null;
  /** true only when this call actually inserted new resource/capability rows; false when it collapsed into an already-existing row by content_hash/semantic_fingerprint. */
  inserted: boolean;
}

export interface RegistryStore {
  /** Atomic, idempotent. Never called unless the upstream decision was APPROVED_FOR_REGISTRATION — see registry-writer.ts. */
  writeApprovedCandidate(input: ApprovedCandidateWrite): WriteOutcome;

  /** Append-only. Called for every registerCandidate() invocation regardless of decision outcome. */
  appendRegistrationEvent(event: { candidate_id: string; decision: string; duplicate_result: string | null; evidence_ref: readonly string[] }): void;

  findCapabilityById(capability_id: string): CapabilityLookupResult | null;
  findCapabilityBySemanticFingerprint(semantic_fingerprint: string): CapabilityLookupResult | null;
  findCapabilityByCanonicalName(canonical_name: string): CapabilityLookupResult | null;
  findResourceByContentHash(content_hash: string): ResourceRow | null;
  findResourceById(resource_id: string): ResourceRow | null;

  /**
   * Targeted, in-place mutations of an ALREADY-registered capability —
   * see control/registration-update/, the only caller. Never a
   * classification or duplicate decision (that stays exclusively
   * Registration Pipeline's), never an identity change (canonical_name/
   * resource_type/domain/semantic_fingerprint/content_hash are never
   * touched by any of these) — purely additive/subtractive graph and
   * evidence edits on a row that already exists. Each returns whether it
   * actually changed anything (idempotent — applying the same mutation
   * twice is a safe no-op the second time).
   */
  addRelationship(row: Omit<RelationshipRow, "relationship_id" | "created_at">): { added: boolean };
  removeRelationship(from_id: string, to_id: string, relationship_kind: string): { removed: boolean };
  addEvidence(row: Omit<EvidenceRow, "evidence_id" | "created_at">): { added: boolean };
  addVersion(row: Omit<VersionRow, "version_id" | "created_at">): { added: boolean };

  /** Row counts, for tests only — never part of the production Lookup API surface (not re-exported from contract.ts). */
  debugCounts(): { resources: number; capabilities: number; resource_capabilities: number; relationships: number; versions: number; evidence: number; registration_events: number };
  debugCallCounts(): { writeApprovedCandidateCalls: number; appendRegistrationEventCalls: number };
}
