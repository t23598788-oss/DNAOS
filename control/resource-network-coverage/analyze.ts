/**
 * หน้าที่: measure how much of its own resource network DNA OS can already
 * express and how much it has actually recorded — and separate those two
 * questions, because they are not the same question (Owner, 2026-09-02).
 *
 * THE DISTINCTION THIS WHOLE FILE EXISTS FOR. A schema that CAN express an
 * ownership edge and a graph that HAS one are different facts, and conflating
 * them is how a system comes to believe it knows where its resources came from.
 * Every probe below therefore returns both: `schema_expressible` (is there an
 * entity-type pair and a relationship kind for this?) and `current_real_rows`
 * (how many such rows exist right now). A probe can be expressible with zero
 * rows — that is a MISSING_RELATIONSHIP_INSTANCE. A probe with no kind at all is
 * a SCHEMA_GAP. They need different work and must not be reported as one number.
 *
 * NO SECOND GRAPH. This reads the canonical registry and the cross-system store
 * and writes neither. It creates no entity, no relationship and no lifecycle
 * state; it counts what is there and names what is not.
 *
 * ORPHAN IS A REFUSAL, NOT A VERDICT. `classifyOrphan` can only ever return
 * ORPHAN_CANDIDATE or UNKNOWN. There is no SAFE_TO_DELETE in this file's
 * vocabulary, because the facts that would justify one — no active caller, not
 * a source authority, rollback known — are exactly the facts the measurement
 * below shows are missing.
 *
 * Input: the canonical registry + cross-system store, read-only.
 * Output: probe/coverage/orphan/lineage types and their pure measurements.
 * Dependency ที่อนุญาต: node:fs, node:path.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนลง registry, ห้ามสร้าง relationship, ห้ามสรุปว่า
 * ลบได้, ห้ามเดา lineage ที่ไม่มีหลักฐาน.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Whether the schema can say it, independent of whether anyone has. */
export type SchemaExpressible = "EXPRESSIBLE" | "SCHEMA_GAP";
/** What the measurement concluded for one probe. */
export type ProbeVerdict = "PRESENT" | "MISSING_RELATIONSHIP_INSTANCE" | "SCHEMA_GAP";

export interface RelationshipProbe {
  /** The question, in the Owner's terms. */
  relationship: string;
  from_entity_type: string;
  to_entity_type: string;
  /** The kind that would carry it, if one exists. */
  candidate_kind: string | null;
}

export interface ProbeResult extends RelationshipProbe {
  schema_expressible: SchemaExpressible;
  existing_relationship_kind: string | null;
  type_pair_supported: boolean;
  current_real_rows: number;
  verdict: ProbeVerdict;
  gap: string | null;
}

export interface GraphSnapshot {
  canonical_kinds: readonly string[];
  canonical_entity_types: readonly string[];
  cross_system_kinds: readonly string[];
  cross_system_entity_types: readonly string[];
  relationships: readonly Record<string, unknown>[];
  cross_relationships: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  capabilities: readonly Record<string, unknown>[];
  registration_events: readonly Record<string, unknown>[];
}

const readJsonl = (root: string, rel: string): Record<string, unknown>[] => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>) : [];
};

/** Extracts a closed union's members from source. Reading the type is how the vocabulary is measured, not a hand-copied list. */
function unionMembers(root: string, file: string, typeName: string): readonly string[] {
  const p = join(root, file);
  if (!existsSync(p)) return [];
  const m = new RegExp(`export type ${typeName} =([\\s\\S]*?);`).exec(readFileSync(p, "utf8"));
  return m ? (m[1]!.match(/"[A-Z_]+"/g) ?? []).map((s) => s.replace(/"/g, "")) : [];
}

export function readGraph(root: string = process.cwd()): GraphSnapshot {
  return {
    canonical_kinds: unionMembers(root, "software/registry-database/types.ts", "RelationshipKind"),
    canonical_entity_types: unionMembers(root, "software/registry-database/types.ts", "RelationshipEntityType"),
    cross_system_kinds: unionMembers(root, "software/registry-database/cross-system-types.ts", "CrossSystemRelationshipKind"),
    cross_system_entity_types: unionMembers(root, "software/registry-database/cross-system-types.ts", "CrossSystemEntityType"),
    relationships: readJsonl(root, "software/registry-database/data/canonical/relationships.jsonl"),
    cross_relationships: readJsonl(root, "software/registry-database/data/cross-system/relationships.jsonl"),
    resources: readJsonl(root, "software/registry-database/data/canonical/resources.jsonl"),
    capabilities: readJsonl(root, "software/registry-database/data/canonical/capabilities.jsonl"),
    registration_events: readJsonl(root, "software/registry-database/data/canonical/registration_events.jsonl"),
  };
}

const field = (r: Record<string, unknown>, ...names: string[]): string | null => {
  for (const n of names) if (typeof r[n] === "string" && (r[n] as string).length > 0) return r[n] as string;
  return null;
};

/**
 * Measures one probe. Pure over the snapshot: a kind that exists in neither
 * union is a SCHEMA_GAP; a kind that exists with zero rows is a missing
 * instance. Row counting is exact-kind matching — never a substring, so a
 * similarly-named kind cannot be mistaken for the one asked about.
 */
export function measureProbe(probe: RelationshipProbe, graph: GraphSnapshot): ProbeResult {
  const allKinds = [...graph.canonical_kinds, ...graph.cross_system_kinds];
  const allTypes = [...graph.canonical_entity_types, ...graph.cross_system_entity_types];
  const kind = probe.candidate_kind !== null && allKinds.includes(probe.candidate_kind) ? probe.candidate_kind : null;
  const typePairSupported = allTypes.includes(probe.from_entity_type) && allTypes.includes(probe.to_entity_type);

  const rows = kind === null ? 0
    : [...graph.relationships, ...graph.cross_relationships]
      .filter((r) => field(r, "relationship_kind", "kind") === kind).length;

  if (kind === null || !typePairSupported) {
    const missing: string[] = [];
    if (kind === null) missing.push(`no relationship kind for ${probe.relationship}`);
    if (!allTypes.includes(probe.from_entity_type)) missing.push(`no entity type ${probe.from_entity_type}`);
    if (!allTypes.includes(probe.to_entity_type)) missing.push(`no entity type ${probe.to_entity_type}`);
    return { ...probe, schema_expressible: "SCHEMA_GAP", existing_relationship_kind: kind, type_pair_supported: typePairSupported, current_real_rows: rows, verdict: "SCHEMA_GAP", gap: missing.join("; ") };
  }
  return {
    ...probe, schema_expressible: "EXPRESSIBLE", existing_relationship_kind: kind,
    type_pair_supported: true, current_real_rows: rows,
    verdict: rows > 0 ? "PRESENT" : "MISSING_RELATIONSHIP_INSTANCE",
    gap: rows > 0 ? null : `kind ${kind} exists; zero rows recorded`,
  };
}

/** Only two outcomes, and neither authorises anything. */
export type OrphanState = "ORPHAN_CANDIDATE" | "UNKNOWN";

export interface OrphanAssessment {
  resource_id: string;
  resource_kind: string | null;
  identity_source: string;
  created_for: string | null;
  owned_by: string | null;
  used_by: readonly string[];
  depends_on: readonly string[];
  source_authority: string | null;
  runtime_references: number;
  last_observed: string | null;
  last_verified: string | null;
  lifecycle_state: string | null;
  evidence_refs: readonly string[];
  orphan_state: OrphanState;
  /** Why the state is what it is — finite, never prose about the resource itself. */
  reason: "NO_SUPPORTED_RELATIONSHIP_FOUND" | "INSUFFICIENT_FACTS_TO_DECIDE" | "RELATIONSHIPS_PRESENT";
}

/**
 * Classifies one resource. Deliberately conservative: an absence of edges is
 * ORPHAN_CANDIDATE only when the facts needed to decide were actually
 * available; when they were not, the answer is UNKNOWN. "Not referenced in one
 * registry" is never sufficient on its own.
 */
export function classifyOrphan(resourceId: string, graph: GraphSnapshot): OrphanAssessment {
  const resource = graph.resources.find((r) => field(r, "resource_id") === resourceId);
  const edges = [...graph.relationships, ...graph.cross_relationships].filter((r) =>
    field(r, "from_id", "from_identity", "source_id") === resourceId || field(r, "to_id", "to_identity", "target_id") === resourceId);
  const usedBy = edges.filter((r) => field(r, "to_id", "to_identity", "target_id") === resourceId)
    .map((r) => field(r, "from_id", "from_identity", "source_id") ?? "").filter(Boolean);
  const dependsOn = edges.filter((r) => field(r, "from_id", "from_identity", "source_id") === resourceId)
    .map((r) => field(r, "to_id", "to_identity", "target_id") ?? "").filter(Boolean);
  const created = graph.registration_events.filter((e) => JSON.stringify(e).includes(resourceId));

  const hasFacts = resource !== undefined;
  return {
    resource_id: resourceId,
    resource_kind: resource ? field(resource, "resource_type") : null,
    identity_source: "software/registry-database/data/canonical/resources.jsonl",
    // A registration event says a row was written; it does not say why anyone
    // wanted it. That distinction is the whole of Phase 7.
    created_for: null,
    owned_by: resource ? field(resource, "owner_id") : null,
    used_by: usedBy, depends_on: dependsOn,
    source_authority: resource ? field(resource, "repository_id") : null,
    runtime_references: 0,
    last_observed: resource ? field(resource, "updated_at") : null,
    last_verified: null,
    lifecycle_state: resource ? field(resource, "status") : null,
    evidence_refs: created.map((e) => field(e, "event_id", "registration_event_id") ?? "").filter(Boolean).slice(0, 3),
    orphan_state: !hasFacts ? "UNKNOWN" : edges.length === 0 ? "ORPHAN_CANDIDATE" : "UNKNOWN",
    reason: !hasFacts ? "INSUFFICIENT_FACTS_TO_DECIDE" : edges.length === 0 ? "NO_SUPPORTED_RELATIONSHIP_FOUND" : "RELATIONSHIPS_PRESENT",
  };
}

/** One fact a deletion would need. Every one is a question about evidence, not about intent. */
export interface SafeDeleteRequirement {
  requirement: string;
  provable_today: boolean;
  proving_source: string | null;
  missing: string | null;
}

/**
 * The ten facts that would have to hold before anything could be called safe to
 * delete, each measured against what the graph can actually show. Nothing here
 * deletes, proposes a deletion, or scores one.
 */
export function safeDeleteRequirements(graph: GraphSnapshot): readonly SafeDeleteRequirement[] {
  const has = (kind: string) => [...graph.relationships, ...graph.cross_relationships].some((r) => field(r, "relationship_kind", "kind") === kind);
  const kinds = [...graph.canonical_kinds, ...graph.cross_system_kinds];
  return [
    { requirement: "resource identity known", provable_today: graph.resources.length > 0, proving_source: "canonical/resources.jsonl", missing: null },
    { requirement: "canonical source known", provable_today: graph.resources.some((r) => field(r, "source_location") !== null), proving_source: "resources.source_location", missing: null },
    { requirement: "no active caller", provable_today: false, proving_source: null, missing: "no runtime caller edge kind exists; USED_BY is inferred from static relationship rows only" },
    { requirement: "no active dependency", provable_today: has("CAPABILITY_TO_DEPENDENCY"), proving_source: "CAPABILITY_TO_DEPENDENCY rows", missing: has("CAPABILITY_TO_DEPENDENCY") ? null : "no dependency rows recorded" },
    { requirement: "not source authority", provable_today: kinds.includes("REPOSITORY_HAS_SOURCE_FILE"), proving_source: "cross-system REPOSITORY_HAS_SOURCE_FILE", missing: null },
    { requirement: "not active runtime", provable_today: has("RUNTIME_EXECUTES_RESOURCE"), proving_source: "RUNTIME_EXECUTES_RESOURCE rows", missing: has("RUNTIME_EXECUTES_RESOURCE") ? null : "kind exists but zero rows recorded" },
    { requirement: "not required by a registered capability", provable_today: has("CAPABILITY_PROVIDED_BY_RESOURCE"), proving_source: "CAPABILITY_PROVIDED_BY_RESOURCE rows", missing: has("CAPABILITY_PROVIDED_BY_RESOURCE") ? null : "kind exists but zero rows recorded" },
    // SOURCE_FILE_DUPLICATE_OF exists but covers only source files, and has zero
    // rows; there is no supersession kind for resources generally. Reporting
    // this as provable because a narrower kind exists would be the exact
    // schema-vs-instance conflation this file was written to prevent.
    { requirement: "replacement/supersession known", provable_today: false, proving_source: null, missing: "SOURCE_FILE_DUPLICATE_OF covers source files only and has zero rows; no SUPERSEDES/REPLACES kind exists for resources generally" },
    { requirement: "required evidence retained", provable_today: graph.registration_events.length > 0, proving_source: "canonical/registration_events.jsonl", missing: null },
    { requirement: "rollback/recovery path known", provable_today: false, proving_source: null, missing: "no rollback or recovery relationship kind exists in either vocabulary" },
  ];
}

/** Whether a resource can be traced to why anyone wanted it. */
export type CreationReasonState = "KNOWN" | "REGISTRATION_EVENT_ONLY" | "UNKNOWN";

export interface CreationReasonAssessment {
  resource_id: string;
  creation_reason_state: CreationReasonState;
  /** The strongest origin reference found, if any. */
  origin_reference: string | null;
  evidence: readonly string[];
  /** The first edge that would have to exist for the answer to become KNOWN. */
  first_missing_edge: string | null;
}

/**
 * Measures Phase 7 for one resource. The distinction that matters: a
 * registration event proves a ROW WAS WRITTEN, which is not the same as knowing
 * why the thing was wanted. Only an edge to an owner intent, work order or
 * incident would make the reason KNOWN, and no such kind exists — so
 * REGISTRATION_EVENT_ONLY is the ceiling this graph can currently reach.
 */
export function assessCreationReason(resourceId: string, graph: GraphSnapshot): CreationReasonAssessment {
  const events = graph.registration_events.filter((e) => JSON.stringify(e).includes(resourceId));
  const kinds = [...graph.canonical_kinds, ...graph.cross_system_kinds];
  const intentKind = kinds.find((k) => /OWNER_INTENT|CREATED_FOR|WORK_ORDER|INCIDENT|REQUESTED_BY/.test(k)) ?? null;
  const originEdge = [...graph.relationships, ...graph.cross_relationships].find((r) =>
    intentKind !== null && field(r, "relationship_kind", "kind") === intentKind
    && (field(r, "from_id", "from_identity", "source_id") === resourceId || field(r, "to_id", "to_identity", "target_id") === resourceId));

  if (originEdge) {
    return { resource_id: resourceId, creation_reason_state: "KNOWN", origin_reference: intentKind, evidence: [String(field(originEdge, "relationship_id") ?? "")], first_missing_edge: null };
  }
  if (events.length > 0) {
    return {
      resource_id: resourceId, creation_reason_state: "REGISTRATION_EVENT_ONLY",
      origin_reference: String(field(events[0]!, "event_id", "registration_event_id") ?? "registration_event"),
      evidence: ["software/registry-database/data/canonical/registration_events.jsonl"],
      first_missing_edge: "RESOURCE_CREATED_FOR (no relationship kind links a resource to an owner intent, work order or incident)",
    };
  }
  return { resource_id: resourceId, creation_reason_state: "UNKNOWN", origin_reference: null, evidence: [], first_missing_edge: "RESOURCE_CREATED_FOR" };
}
