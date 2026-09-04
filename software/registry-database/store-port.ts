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

import type { CapabilityLookupResult, CapabilityRow, EvidenceRow, IngressMetadataRow, RelationshipRow, ResourceRow, VersionRow } from "./types";

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
  /**
   * Read-only enumeration of every registered capability (Owner, 2026-08-31).
   * Added because the Owner Command path had no way to ASK the canonical store
   * "what capabilities exist" — the port only supported point lookups — so it
   * answered from a hardcoded 12-entry routing table in
   * control/command-router/capability-registry.ts while 113 canonical rows went
   * unread. This is a read path only: it grants no ability to write, and adds
   * no second identity namespace — capability_id remains the identity.
   */
  listCapabilities(): readonly CapabilityLookupResult[];
  findResourceByContentHash(content_hash: string): ResourceRow | null;
  findResourceById(resource_id: string): ResourceRow | null;
  /**
   * The missing path lookup (Owner, 2026-08-26): a real filesystem path back to
   * the resource identity that already exists for it. OPTIONAL on the port so
   * adapters that cannot index by source_location keep working unchanged — a
   * caller that gets `undefined` here must report the lookup as unavailable,
   * never mint a second identity for a resource that already has one.
   */
  findResourceBySourceLocation?(source_location: string): ResourceRow | null;

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
  /**
   * เปลี่ยนสถานะของ capability ที่ลงทะเบียนแล้ว — เพิ่มภายใต้ OWNER UNLOCK 2026-09-04
   * ใช้เมื่อรายการในทะเบียนไม่ตรงกับความจริง (เช่น source_location ชี้ไปที่ที่ไม่มีอยู่)
   * ไม่ลบแถว ไม่แก้ตัวตน — เปลี่ยนเฉพาะ status เท่านั้น เพื่อให้ประวัติยังตรวจสอบได้
   */
  setCapabilityStatus(capability_id: string, status: "RETIRED" | "SUPERSEDED", reason: string): { changed: boolean };

  /**
   * ENUMERATION (Owner, 2026-08-26). Optional on the port for exactly the
   * same reason `findResourceBySourceLocation?` is: an adapter that cannot
   * enumerate keeps working unchanged, and a caller that gets `undefined`
   * must report enumeration as UNAVAILABLE rather than pretend the registry
   * is empty.
   *
   * WHY THIS EXISTS: without it the read surface is lookup-by-exact-key
   * only, so a registry miss can never mean "not present" — only "that
   * exact name is not present". Deterministic resolution
   * (`control/work-resolution/`) had to fall back to scanning every repo on
   * disk to find things the registry already knew about. These make
   * REGISTRY_MISS mean "not found after enumeration".
   *
   * Read-only, returns the canonical rows as-is. Never a query language —
   * ranking/filtering belongs to the caller, not to the store.
   */
  listCapabilityRows?(): readonly CapabilityRow[];
  listResourceRows?(): readonly ResourceRow[];
  listResourceCapabilityLinks?(): readonly { resource_id: string; capability_id: string }[];
  listRelationshipRows?(): readonly RelationshipRow[];
  listEvidenceRows?(): readonly EvidenceRow[];

  /** Row counts, for tests only — never part of the production Lookup API surface (not re-exported from contract.ts). */
  debugCounts(): { resources: number; capabilities: number; resource_capabilities: number; relationships: number; versions: number; evidence: number; registration_events: number };
  debugCallCounts(): { writeApprovedCandidateCalls: number; appendRegistrationEventCalls: number };
}

/**
 * หน้าที่: the same port as `RegistryStore`, Promise-returning throughout
 * (2026-08-24, Railway migration — a real `pg.Pool` round trip is
 * inherently async; see `adapters/postgres-store.ts`'s own header on why
 * it was deliberately never shaped as a synchronous `RegistryStore`).
 * Every orchestration function that needs to run against a real Postgres
 * store (`./lookup.ts`, `control/registration-pipeline/duplicate-resolution.ts`,
 * `./registry-writer.ts`, `control/registration-pipeline/pipeline.ts`,
 * `control/registration-update/mutation.ts`) takes this instead of
 * `RegistryStore` directly. `wrapAsAsyncStore` lets every existing
 * synchronous store (`local-file-store.ts` for tests,
 * `persistent-file-store.ts` for today's real Mac-local usage) satisfy
 * this port unchanged — a sync value awaited through `Promise.resolve()`
 * resolves immediately, so this is a zero-behavior-change wrapper for
 * every caller that isn't using Postgres. The *other* ~40 files across
 * this repo that consume plain `RegistryStore` for unrelated flows
 * (admission, duplicate-reservation, permission-policy-resolution, etc.)
 * are deliberately untouched by this — this port exists only for the live
 * registration-candidate/lookup/update HTTP request path that actually
 * needs Postgres durability, not as a repo-wide interface change.
 */
export interface AsyncRegistryStore {
  writeApprovedCandidate(input: ApprovedCandidateWrite): Promise<WriteOutcome>;
  appendRegistrationEvent(event: { candidate_id: string; decision: string; duplicate_result: string | null; evidence_ref: readonly string[] }): Promise<void>;
  findCapabilityById(capability_id: string): Promise<CapabilityLookupResult | null>;
  findCapabilityBySemanticFingerprint(semantic_fingerprint: string): Promise<CapabilityLookupResult | null>;
  findCapabilityByCanonicalName(canonical_name: string): Promise<CapabilityLookupResult | null>;
  listCapabilities(): Promise<readonly CapabilityLookupResult[]>;
  findResourceByContentHash(content_hash: string): Promise<ResourceRow | null>;
  findResourceById(resource_id: string): Promise<ResourceRow | null>;
  addRelationship(row: Omit<RelationshipRow, "relationship_id" | "created_at">): Promise<{ added: boolean }>;
  removeRelationship(from_id: string, to_id: string, relationship_kind: string): Promise<{ removed: boolean }>;
  addEvidence(row: Omit<EvidenceRow, "evidence_id" | "created_at">): Promise<{ added: boolean }>;
  addVersion(row: Omit<VersionRow, "version_id" | "created_at">): Promise<{ added: boolean }>;
}

/** Adapts any synchronous `RegistryStore` (local-file-store, persistent-file-store) to `AsyncRegistryStore` — every method just resolves immediately with the same value the sync call already produced. */
export function wrapAsAsyncStore(store: RegistryStore): AsyncRegistryStore {
  return {
    writeApprovedCandidate: async (input) => store.writeApprovedCandidate(input),
    appendRegistrationEvent: async (event) => store.appendRegistrationEvent(event),
    findCapabilityById: async (capability_id) => store.findCapabilityById(capability_id),
    findCapabilityBySemanticFingerprint: async (semantic_fingerprint) => store.findCapabilityBySemanticFingerprint(semantic_fingerprint),
    findCapabilityByCanonicalName: async (canonical_name) => store.findCapabilityByCanonicalName(canonical_name),
    listCapabilities: async () => store.listCapabilities(),
    findResourceByContentHash: async (content_hash) => store.findResourceByContentHash(content_hash),
    findResourceById: async (resource_id) => store.findResourceById(resource_id),
    addRelationship: async (row) => store.addRelationship(row),
    removeRelationship: async (from_id, to_id, relationship_kind) => store.removeRelationship(from_id, to_id, relationship_kind),
    addEvidence: async (row) => store.addEvidence(row),
    addVersion: async (row) => store.addVersion(row),
  };
}
