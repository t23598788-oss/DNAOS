/**
 * หน้าที่: `createPersistentFileStore()` — the same `RegistryStore` port as
 * `./local-file-store.ts`, but backed by one fixed canonical directory
 * instead of a fresh timestamp+random run directory per process. On
 * construction it rehydrates every in-memory Map/array by reading back
 * whatever `*.jsonl` rows already exist on disk, so a process restart never
 * loses a canonical registration — disk is the source of truth, the
 * in-memory Maps are a cache rebuilt from it on every startup. This is the
 * live server's real registrationStore (see
 * transport/owner-command-http/server.ts); `./local-file-store.ts` remains
 * the test-only, deliberately-ephemeral adapter used by this folder's own
 * tests.
 *
 * Input: optional `{ dataDir }` (default:
 * `software/registry-database/data/canonical/`).
 * Output: `createPersistentFileStore`.
 * Dependency ที่อนุญาต: ../store-port.ts, ../types.ts, ../host-runtime.ts.
 * สิ่งที่ห้ามแตะ: `writeApprovedCandidate` performs technical idempotency
 * only (the same resource_id/capability_id twice is a no-op) — it never
 * decides whether two candidates are the same by content_hash/
 * semantic_fingerprint; that decision belongs exclusively to
 * `control/registration-pipeline/duplicate-resolution.ts`, upstream of
 * every write (STEP "Refactor Registration Pipeline to Single-Owner
 * Sequential Stages"). The content_hash/semantic_fingerprint/
 * canonical_name indexes stay real and accurate for reads
 * (`findResourceByContentHash`, `findCapabilityBySemanticFingerprint`,
 * `findCapabilityByCanonicalName`) — that stage's only source of truth.
 * Never point this at a live production database — it is a local JSONL
 * directory only, no network, no Supabase.
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { verifiedReadJsonl } from "../../../control/observation-integrity/verified-read";
import { join } from "node:path";
import type { ApprovedCandidateWrite, RegistryStore, WriteOutcome } from "../store-port";
import type { CapabilityLookupResult, CapabilityRow, EvidenceRow, RegistrationEventRow, RelationshipRow, ResourceRow, VersionRow } from "../types";
import { newId, nowIso } from "../host-runtime";

export interface PersistentFileStoreOptions {
  dataDir?: string;
}

const DEFAULT_CANONICAL_DIR = join(process.cwd(), "software/registry-database/data/canonical");

/**
 * Rehydrates one canonical store through the observation-integrity boundary
 * rather than a single read.
 *
 * WHY THIS ONE LINE MATTERED. This function is how every capability, resource
 * and relationship in DNA OS is loaded. A bare `readFileSync` here can return
 * zero bytes without raising — and on 2026-09-02 it did: `findCapability("os-ui")`
 * reported `source_location: []`, which read as "this capability has no
 * implementation" when the join row was present the whole time. One unguarded
 * read at the bottom of the registry silently became a missing relationship at
 * the top of it.
 *
 * A conflicted read now THROWS rather than returning an empty array. An empty
 * array is indistinguishable from a real empty store, and it is precisely that
 * ambiguity that let a measurement failure masquerade as a fact. A caller may
 * handle an exception; it cannot handle a lie.
 */
/**
 * Re-observation, bounded, and only for the failures that are re-observable.
 *
 * WHY THIS EXISTS. Refusing an uncorroborated read is right; making a
 * re-observable failure permanent is not. On 2026-09-02 the live Owner command
 * path died at store construction with
 * `REGISTRY_READ_READ_FAILED: versions.jsonl (INSUFFICIENT/ALL_METHODS_ERRORED)`
 * carrying `errno -11` (EAGAIN) from the `read` syscall — on a 243,667-byte
 * file that then read CONSISTENT eight times in a row. The read was momentarily
 * impossible, not wrong, and a single-shot throw turned that instant into an
 * outage of every Owner command.
 *
 * WHAT IS NOT RETRIED. `CONFLICTING` is never retried. A conflict means two
 * independent methods disagreed about the same bytes — the incident shape this
 * whole boundary exists to surface — and re-reading until the disagreement
 * disappears is exactly the "retry until you like the answer" the contract
 * forbids. Only INSUFFICIENT is re-observed: there the methods agreed that
 * nothing could be read at that instant, which is the transient class.
 *
 * The retry adds observations; it deletes none, and it cannot manufacture a
 * success. If every attempt fails the original refusal still throws.
 */
const READ_ATTEMPTS = 3;

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  let verified = verifiedReadJsonl<T>(path);
  for (let attempt = 2; attempt <= READ_ATTEMPTS
    && verified.outcome !== "READ_SUCCEEDED"
    && verified.integrity.consistency_state === "INSUFFICIENT"; attempt += 1) {
    verified = verifiedReadJsonl<T>(path);
  }
  if (verified.outcome !== "READ_SUCCEEDED") {
    throw new Error(`REGISTRY_READ_${verified.outcome}: ${path} (${verified.integrity.consistency_state}/${verified.integrity.reason}) — refusing to rehydrate the canonical store from an uncorroborated read`);
  }
  if (verified.parse_error !== null) throw new Error(`REGISTRY_ROW_UNPARSEABLE: ${path} — ${verified.parse_error}`);
  return [...(verified.rows ?? [])];
}

export function createPersistentFileStore(options: PersistentFileStoreOptions = {}): RegistryStore {
  const canonicalDir = options.dataDir ?? DEFAULT_CANONICAL_DIR;
  if (!existsSync(canonicalDir)) mkdirSync(canonicalDir, { recursive: true });

  // Rehydrate from disk — the canonical, restart-surviving source of truth.
  const resourceRows = readJsonl<ResourceRow>(join(canonicalDir, "resources.jsonl"));
  const capabilityRows = readJsonl<CapabilityRow>(join(canonicalDir, "capabilities.jsonl"));
  const resourceCapabilityRows = readJsonl<{ resource_id: string; capability_id: string }>(join(canonicalDir, "resource_capabilities.jsonl"));
  const relationshipRows = readJsonl<RelationshipRow>(join(canonicalDir, "relationships.jsonl"));
  // relationships_removed.jsonl is an append-only tombstone log —
  // relationships.jsonl itself is never rewritten (matching this store's
  // append-only-disk discipline everywhere else), so a removeRelationship()
  // call must be replayed here on every rehydration too.
  const removedRelationshipRows = readJsonl<{ from_id: string; to_id: string; relationship_kind: string }>(join(canonicalDir, "relationships_removed.jsonl"));
  const versionRows = readJsonl<VersionRow>(join(canonicalDir, "versions.jsonl"));
  const evidenceRows = readJsonl<EvidenceRow>(join(canonicalDir, "evidence.jsonl"));
  const registrationEventRows = readJsonl<RegistrationEventRow>(join(canonicalDir, "registration_events.jsonl"));

  const resources = new Map<string, ResourceRow>(resourceRows.map((r) => [r.resource_id, r]));
  const resourceIdByContentHash = new Map<string, string>(resourceRows.map((r) => [r.content_hash, r.resource_id]));
  const capabilities = new Map<string, CapabilityRow>(capabilityRows.map((c) => [c.capability_id, c]));
  const capabilityIdBySemanticFingerprint = new Map<string, string>(capabilityRows.map((c) => [c.semantic_fingerprint, c.capability_id]));
  const capabilityIdByCanonicalName = new Map<string, string>(capabilityRows.map((c) => [c.canonical_name, c.capability_id]));
  const resourceCapabilities: { resource_id: string; capability_id: string }[] = [...resourceCapabilityRows];
  const relationships: RelationshipRow[] = relationshipRows.filter(
    (r) => !removedRelationshipRows.some((removed) => removed.from_id === r.from_id && removed.to_id === r.to_id && removed.relationship_kind === r.relationship_kind),
  );
  const versions: VersionRow[] = [...versionRows];
  const evidence: EvidenceRow[] = [...evidenceRows];
  const registrationEvents: RegistrationEventRow[] = [...registrationEventRows];

  let writeApprovedCandidateCalls = 0;
  let appendRegistrationEventCalls = 0;

  function persist(table: string, row: unknown): void {
    appendFileSync(join(canonicalDir, `${table}.jsonl`), `${JSON.stringify(row)}\n`);
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
  // Single-Owner Sequential Stages"): this store never decides whether
  // two candidates are the "same" resource/capability by content — that
  // semantic-duplicate decision belongs exclusively to
  // control/registration-pipeline/duplicate-resolution.ts, upstream of
  // every call here. By the time writeApprovedCandidate runs, the caller
  // has already confirmed this content is UNIQUE and generated a fresh
  // resource_id/capability_id for it. The only thing this store still
  // protects against is a literal retry of the exact same operation (the
  // exact same resource_id/capability_id submitted twice) — a mechanical
  // concurrency/retry concern, never a business decision. The
  // content_hash/semantic_fingerprint/canonical_name indexes below are
  // still maintained for READS (`findResourceByContentHash`,
  // `findCapabilityBySemanticFingerprint`, `findCapabilityByCanonicalName`
  // — what Duplicate Resolution itself queries), never consulted here to
  // redirect a write onto a different, pre-existing row.
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
  // RegistryStore doc comment. control/registration-update/ is the only
  // caller; never a classification/duplicate decision, purely additive/
  // subtractive, idempotent.
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
    persist("relationships_removed", { from_id, to_id, relationship_kind, removed_at: nowIso() });
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
    // The resource's own "current version" (what CapabilityLookupResult.version
    // reads back) also advances — a second resources.jsonl row for the same
    // resource_id, which rehydration's Map construction correctly resolves
    // to the latest occurrence.
    const resource = resources.get(row.resource_id);
    if (resource) {
      const updated: ResourceRow = { ...resource, version: row.version, updated_at: nowIso() };
      resources.set(row.resource_id, updated);
      persist("resources", updated);
    }
    return { added: true };
  }

    // เปลี่ยนสถานะของ capability — เพิ่มภายใต้ OWNER UNLOCK 2026-09-04
    // ไม่ลบแถวออกจากทะเบียน เพราะประวัติต้องตรวจสอบย้อนหลังได้เสมอ
    function setCapabilityStatus(capability_id: string, status: "RETIRED" | "SUPERSEDED", reason: string): { changed: boolean } {
      const cap = capabilities.get(capability_id);
      if (cap === undefined) return { changed: false };
      if (cap.status === status) return { changed: false };
      const updated = { ...cap, status };
      capabilities.set(capability_id, updated);
      persist("capabilities", updated);
      addEvidence({ evidence_ref: `status:${status} reason:${reason}`, evidence_type: "update",
                    related_resource_id: null, related_capability_id: capability_id });
      return { changed: true };
    }

  return {
    writeApprovedCandidate,
      setCapabilityStatus,
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
    // Path -> existing resource identity (Owner, 2026-08-26). Reads the same
    // `resources` map every other lookup here reads, so it can never return a
    // different identity than findResourceById would for the same row. Exact
    // source_location match only: a near-miss is not a resource.
    findResourceBySourceLocation(source_location: string) {
      for (const row of resources.values()) {
        if (row.source_location === source_location) return row;
      }
      return null;
    },
    // ENUMERATION — see store-port.ts. Returns copies so a caller can
    // never mutate the store's in-memory canonical rows.
    listCapabilityRows: () => [...capabilities.values()],
    listResourceRows: () => [...resources.values()],
    listResourceCapabilityLinks: () => [...resourceCapabilities],
    listRelationshipRows: () => [...relationships],
    listEvidenceRows: () => [...evidence],

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
