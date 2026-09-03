/**
 * หน้าที่: `createLocalFileStore()` — a `RegistryStore` implementation used
 * ONLY by `../tests/registry-writer.test.ts` (no live database this
 * round). In-memory Maps/arrays are the source of truth for every read;
 * each call also appends a JSONL line per table to a fresh,
 * timestamp+random-scoped run directory under `../data/runs/` (matching
 * this repo's existing `control/event-pipeline/data/*.jsonl` convention)
 * purely as inspectable evidence — reads never touch disk, so repeated
 * test runs stay deterministic instead of accumulating cross-run state.
 *
 * Input: optional `{ dataDir }`.
 * Output: `createLocalFileStore`.
 * Dependency ที่อนุญาต: ../store-port.ts, ../types.ts, ../host-runtime.ts.
 * สิ่งที่ห้ามแตะ: never let this file be imported by `../contract.ts` or by
 * anything outside `../tests/` — it exists to prove the schema/logic
 * without a live database, not as a production storage backend.
 * `writeApprovedCandidate` performs technical idempotency only (same
 * resource_id/capability_id twice is a no-op) — it never decides whether
 * two candidates are the same by content_hash/semantic_fingerprint; that
 * decision belongs exclusively to
 * `control/registration-pipeline/duplicate-resolution.ts`, upstream of
 * every write (STEP "Refactor Registration Pipeline to Single-Owner
 * Sequential Stages"). `findResourceByContentHash`/
 * `findCapabilityBySemanticFingerprint` remain real, accurate READS —
 * that stage's only source of truth for what already exists.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ApprovedCandidateWrite, RegistryStore, WriteOutcome } from "../store-port";
import type { CapabilityLookupResult, CapabilityRow, EvidenceRow, RegistrationEventRow, RelationshipRow, ResourceRow, VersionRow } from "../types";
import { newId, nowIso } from "../host-runtime";

export interface LocalFileStoreOptions {
  dataDir?: string;
}

export function createLocalFileStore(options: LocalFileStoreOptions = {}): RegistryStore {
  const resources = new Map<string, ResourceRow>();
  const resourceIdByContentHash = new Map<string, string>();
  const capabilities = new Map<string, CapabilityRow>();
  const capabilityIdBySemanticFingerprint = new Map<string, string>();
  const capabilityIdByCanonicalName = new Map<string, string>();
  const resourceCapabilities: { resource_id: string; capability_id: string }[] = [];
  const relationships: RelationshipRow[] = [];
  const versions: VersionRow[] = [];
  const evidence: EvidenceRow[] = [];
  const registrationEvents: RegistrationEventRow[] = [];

  let writeApprovedCandidateCalls = 0;
  let appendRegistrationEventCalls = 0;

  const runDir = options.dataDir ?? join(process.cwd(), "software/registry-database/data/runs", `${nowIso().replace(/[:.]/g, "-")}-${newId()}`);

  function persist(table: string, row: unknown): void {
    if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
    appendFileSync(join(runDir, `${table}.jsonl`), `${JSON.stringify(row)}\n`);
  }

  function resourceIdsForCapability(capability_id: string): string[] {
    return resourceCapabilities.filter((rc) => rc.capability_id === capability_id).map((rc) => rc.resource_id);
  }

  function toLookupResult(capability: CapabilityRow): CapabilityLookupResult {
    const resourceIds = resourceIdsForCapability(capability.capability_id);
    const relatedResources = resourceIds.map((id) => resources.get(id)).filter((r): r is ResourceRow => r !== undefined);
    const eligibleWorkers = relationships.filter((r) => r.relationship_kind === "CAPABILITY_TO_WORKER" && r.from_id === capability.capability_id).map((r) => r.to_id);
    const dependencies = relationships.filter((r) => r.relationship_kind === "CAPABILITY_TO_DEPENDENCY" && r.from_id === capability.capability_id).map((r) => r.to_id);
    const evidenceRefs = evidence.filter((e) => e.related_capability_id === capability.capability_id).map((e) => e.evidence_ref);
    const ownRelationships = relationships.filter((r) => r.from_id === capability.capability_id).map((r) => ({ to_type: r.to_type, to_id: r.to_id, relationship_kind: r.relationship_kind }));
    return {
      capability_id: capability.capability_id,
      canonical_name: capability.canonical_name,
      resource_ids: resourceIds,
      source_location: relatedResources.map((r) => r.source_location),
      version: relatedResources.map((r) => r.version),
      status: capability.status,
      input_contract: capability.input_contract,
      output_contract: capability.output_contract,
      dependencies,
      eligible_workers: eligibleWorkers,
      evidence_refs: evidenceRefs,
      ingress_metadata: capability.ingress_metadata,
      relationships: ownRelationships,
    };
  }

  // TECHNICAL IDEMPOTENCY ONLY (STEP "Refactor Registration Pipeline to
  // Single-Owner Sequential Stages"): matches
  // ../adapters/persistent-file-store.ts — this store never decides
  // whether two candidates are the "same" resource/capability by content;
  // that belongs exclusively to
  // control/registration-pipeline/duplicate-resolution.ts. Only a literal
  // retry of the exact same resource_id/capability_id is deduped here.
  function writeApprovedCandidate(input: ApprovedCandidateWrite): WriteOutcome {
    writeApprovedCandidateCalls += 1;
    const now = nowIso();

    const resource_id = input.resource.resource_id;
    let insertedResource = false;
    if (!resources.has(resource_id)) {
      const row: ResourceRow = { ...input.resource, resource_id, created_at: now, updated_at: now };
      resources.set(resource_id, row);
      resourceIdByContentHash.set(input.resource.content_hash, resource_id);
      persist("resources", row);
      insertedResource = true;
    }

    let capability_id: string | null = null;
    let insertedCapability = false;
    if (input.capability) {
      capability_id = input.capability.capability_id;
      if (!capabilities.has(capability_id)) {
        const row: CapabilityRow = { ...input.capability, status: "REGISTERED", verified_at: null };
        capabilities.set(capability_id, row);
        capabilityIdBySemanticFingerprint.set(input.capability.semantic_fingerprint, capability_id);
        capabilityIdByCanonicalName.set(input.capability.canonical_name, capability_id);
        persist("capabilities", row);
        insertedCapability = true;
      }

      const alreadyJoined = resourceCapabilities.some((rc) => rc.resource_id === resource_id && rc.capability_id === capability_id);
      if (!alreadyJoined) {
        const join = { resource_id, capability_id };
        resourceCapabilities.push(join);
        persist("resource_capabilities", join);
      }
    }

    for (const rel of input.relationships) {
      const already = relationships.some((r) => r.from_type === rel.from_type && r.from_id === rel.from_id && r.to_type === rel.to_type && r.to_id === rel.to_id && r.relationship_kind === rel.relationship_kind);
      if (!already) {
        const row: RelationshipRow = { ...rel, relationship_id: newId(), created_at: now };
        relationships.push(row);
        persist("relationships", row);
      }
    }

    const alreadyVersion = versions.some((v) => v.resource_id === resource_id && v.version === input.version.version);
    if (!alreadyVersion) {
      const row: VersionRow = { ...input.version, resource_id, version_id: newId(), created_at: now };
      versions.push(row);
      persist("versions", row);
    }

    for (const ev of input.evidence) {
      const already = evidence.some((e) => e.evidence_ref === ev.evidence_ref && e.related_resource_id === ev.related_resource_id && e.related_capability_id === ev.related_capability_id);
      if (!already) {
        const row: EvidenceRow = { ...ev, evidence_id: newId(), created_at: now };
        evidence.push(row);
        persist("evidence", row);
      }
    }

    const inserted = insertedResource || insertedCapability;
    return { resource_id, capability_id, inserted };
  }

  function appendRegistrationEvent(event: { candidate_id: string; decision: string; duplicate_result: string | null; evidence_ref: readonly string[] }): void {
    appendRegistrationEventCalls += 1;
    const row: RegistrationEventRow = { event_id: newId(), created_at: nowIso(), ...event };
    registrationEvents.push(row);
    persist("registration_events", row);
  }

  // Targeted mutations on an already-registered row — see store-port.ts's
  // RegistryStore doc comment. Test-only store: no rehydration ever
  // happens (a fresh run dir every process), so a removed relationship
  // simply never reappears — no tombstone log needed here, unlike
  // ../adapters/persistent-file-store.ts.
  function addRelationship(row: Omit<RelationshipRow, "relationship_id" | "created_at">): { added: boolean } {
    const already = relationships.some((r) => r.from_type === row.from_type && r.from_id === row.from_id && r.to_type === row.to_type && r.to_id === row.to_id && r.relationship_kind === row.relationship_kind);
    if (already) return { added: false };
    const full: RelationshipRow = { ...row, relationship_id: newId(), created_at: nowIso() };
    relationships.push(full);
    persist("relationships", full);
    return { added: true };
  }

  function removeRelationship(from_id: string, to_id: string, relationship_kind: string): { removed: boolean } {
    const index = relationships.findIndex((r) => r.from_id === from_id && r.to_id === to_id && r.relationship_kind === relationship_kind);
    if (index === -1) return { removed: false };
    relationships.splice(index, 1);
    return { removed: true };
  }

  function addEvidence(row: Omit<EvidenceRow, "evidence_id" | "created_at">): { added: boolean } {
    const already = evidence.some((e) => e.evidence_ref === row.evidence_ref && e.related_resource_id === row.related_resource_id && e.related_capability_id === row.related_capability_id);
    if (already) return { added: false };
    const full: EvidenceRow = { ...row, evidence_id: newId(), created_at: nowIso() };
    evidence.push(full);
    persist("evidence", full);
    return { added: true };
  }

  function addVersion(row: Omit<VersionRow, "version_id" | "created_at">): { added: boolean } {
    const already = versions.some((v) => v.resource_id === row.resource_id && v.version === row.version);
    if (already) return { added: false };
    const full: VersionRow = { ...row, version_id: newId(), created_at: nowIso() };
    versions.push(full);
    persist("versions", full);
    const resource = resources.get(row.resource_id);
    if (resource) {
      const updated: ResourceRow = { ...resource, version: row.version, updated_at: nowIso() };
      resources.set(row.resource_id, updated);
      persist("resources", updated);
    }
    return { added: true };
  }

  return {
    writeApprovedCandidate,
    appendRegistrationEvent,
    addRelationship,
    removeRelationship,
    addEvidence,
    addVersion,
    findCapabilityById(capability_id: string) {
      const c = capabilities.get(capability_id);
      return c ? toLookupResult(c) : null;
    },
    findCapabilityBySemanticFingerprint(semantic_fingerprint: string) {
      const id = capabilityIdBySemanticFingerprint.get(semantic_fingerprint);
      return id ? toLookupResult(capabilities.get(id)!) : null;
    },
    findCapabilityByCanonicalName(canonical_name: string) {
      const id = capabilityIdByCanonicalName.get(canonical_name);
      return id ? toLookupResult(capabilities.get(id)!) : null;
    },
    listCapabilities() {
      return [...capabilities.values()].map((c) => toLookupResult(c));
    },
    findResourceByContentHash(content_hash: string) {
      const id = resourceIdByContentHash.get(content_hash);
      return id ? (resources.get(id) ?? null) : null;
    },
    findResourceById(resource_id: string) { return resources.get(resource_id) ?? null; },
    /** Test-only read-back projection; production callers use the persistent store's same port. */
    listResourceRows() { return [...resources.values()]; },
    debugCounts() {
      return {
        resources: resources.size,
        capabilities: capabilities.size,
        resource_capabilities: resourceCapabilities.length,
        relationships: relationships.length,
        versions: versions.length,
        evidence: evidence.length,
        registration_events: registrationEvents.length,
      };
    },
    debugCallCounts() {
      return { writeApprovedCandidateCalls, appendRegistrationEventCalls };
    },
  };
}
