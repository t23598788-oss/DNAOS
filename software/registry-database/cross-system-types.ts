/**
 * หน้าที่: the CROSS-SYSTEM extension of the canonical relationship model.
 *
 * Why this file exists (measured, not assumed): `types.ts`'s
 * `RelationshipEntityType` admits 9 entity types and `RelationshipKind` a
 * closed union built for module/capability edges inside one repository. A
 * promotion gate run over 9,761 discovered relationships blocked 9,701 of
 * them with exactly one reason — CANONICAL_MODEL_CANNOT_EXPRESS_TYPE — because
 * APPLICATION/REPOSITORY/SOURCE_FILE/BOUNDARY/SERVICE/DEPLOYMENT/
 * DATABASE_PROJECT/DATABASE_OBJECT/RUNTIME simply do not exist in the
 * vocabulary. Zero were blocked for weak evidence.
 *
 * Design rule followed here: ADDITIVE ONLY. This file never edits, migrates or
 * reinterprets `types.ts`. `ExtendedRelationshipEntityType` is a strict
 * superset of `RelationshipEntityType`, and `ExtendedRelationshipKind` a
 * strict superset of `RelationshipKind`, so every one of the existing 180
 * relationship rows remains valid under this model with its id, semantics and
 * created_at unchanged. Nothing in `data/canonical/` is rewritten.
 *
 * สิ่งที่ห้ามแตะ: do not rename or remove any member inherited from types.ts —
 * existing consumers (registry-writer.ts, lookup.ts, adapters/*) read those
 * unions directly.
 */
import type { RelationshipEntityType, RelationshipKind, EvidenceRow } from "./types";

/**
 * Provider-neutral by construction. The Railway project that produced the
 * evidence is PROVIDER_PROJECT, not RAILWAY_PROJECT — provider identity is a
 * pointer, never architecture authority, so swapping deployment provider must
 * not invalidate the vocabulary.
 */
export type CrossSystemEntityType =
  | "APPLICATION"
  | "REPOSITORY"
  | "SOURCE_FILE"
  | "BOUNDARY"
  | "RESOURCE"
  | "SERVICE"
  | "DEPLOYMENT"
  | "VERSION"
  | "PROVIDER_PROJECT"
  | "DATABASE_PROJECT"
  | "DATABASE_OBJECT"
  | "RUNTIME"
  | "PROCESS"
  | "WORK"
  | "EXECUTION"
  | "RESEARCH_RUN"
  | "METRIC"
  | "COST"
  | "DECISION"
  | "EVIDENCE";

export type ExtendedRelationshipEntityType = RelationshipEntityType | CrossSystemEntityType;

/** Every kind below is required by the real gap inventory or by an explicitly requested type-pair. */
export type CrossSystemRelationshipKind =
  | "APPLICATION_HAS_REPOSITORY"
  | "APPLICATION_HAS_SOURCE_FILE"
  | "APPLICATION_HAS_BOUNDARY"
  | "APPLICATION_USES_RESOURCE"
  | "APPLICATION_USES_CAPABILITY"
  | "APPLICATION_USES_DATABASE_PROJECT"
  | "REPOSITORY_HAS_SOURCE_FILE"
  | "REPOSITORY_HAS_BOUNDARY"
  | "REPOSITORY_DEPLOYS_TO_SERVICE"
  | "REPOSITORY_HAS_VERSION"
  | "SOURCE_FILE_BELONGS_TO_BOUNDARY"
  | "SOURCE_FILE_DUPLICATE_OF"
  | "SOURCE_REFERENCES_DATABASE_OBJECT"
  | "RESOURCE_IMPLEMENTED_BY_SOURCE_FILE"
  | "RESOURCE_IMPLEMENTED_BY_BOUNDARY"
  | "RESOURCE_HAS_VERSION"
  | "CAPABILITY_PROVIDED_BY_RESOURCE"
  | "PROVIDER_PROJECT_HAS_SERVICE"
  | "SERVICE_HAS_DEPLOYMENT"
  | "DEPLOYMENT_RUNS_VERSION"
  | "DEPLOYMENT_USES_DATABASE_PROJECT"
  | "DATABASE_PROJECT_HAS_OBJECT"
  | "RUNTIME_EXECUTES_RESOURCE"
  | "PROCESS_OBSERVES_RUNTIME"
  | "WORK_TARGETS_RESOURCE"
  | "WORK_TARGETS_CAPABILITY"
  | "EXECUTION_OF_WORK"
  | "EXECUTION_RUNS_PROCESS"
  | "EXECUTION_HAS_RESEARCH_RUN"
  | "RESEARCH_RUN_HAS_METRIC"
  | "RESEARCH_RUN_HAS_COST"
  | "RESEARCH_RUN_HAS_DECISION"
  | "METRIC_HAS_EVIDENCE"
  | "COST_HAS_EVIDENCE"
  | "DECISION_HAS_EVIDENCE"
  | "PROCESS_HAS_EVIDENCE";

export type ExtendedRelationshipKind = RelationshipKind | CrossSystemRelationshipKind;

/**
 * Lifecycle. A relationship is never deleted because the world moved on: a
 * deployment that stopped running still historically belonged to its service,
 * so that edge becomes STALE or REVOKED, never absent.
 */
export type RelationshipState = "ACTIVE" | "STALE" | "CONFLICT" | "REVOKED" | "UNKNOWN";

/** Which producer was authoritative for the fact behind this edge. */
export type SourceAuthority =
  | "MAC_SOURCE" | "GITHUB" | "RAILWAY" | "SUPABASE"
  | "DNA_OS_REGISTRY" | "RUNTIME" | "AGENT_REPORT" | "DERIVED";

/**
 * The cross-system relationship row.
 *
 * Every field beyond the seven in `RelationshipRow` is OPTIONAL, which is what
 * makes the 180 existing rows readable here without migration: absent fields
 * read as undefined and are reported as UNKNOWN rather than being back-filled
 * with invented values.
 */
export interface CrossSystemRelationshipRow {
  relationship_id: string;
  from_type: ExtendedRelationshipEntityType;
  from_id: string;
  to_type: ExtendedRelationshipEntityType;
  to_id: string;
  relationship_kind: ExtendedRelationshipKind;
  created_at: string;

  /** Disambiguates otherwise-identical edges (e.g. same file in two environments). Part of logical identity. */
  scope?: string | null;
  state?: RelationshipState;
  last_confirmed_at?: string | null;
  source_authority?: SourceAuthority;
  /** Pointers into evidence.jsonl — never copies of the underlying source or log. */
  evidence_refs?: readonly string[];
  /** Set only when the edge was derived rather than directly observed. */
  rule_id?: string | null;
  observation_refs?: readonly string[];
  revision?: number;
}

/**
 * Closes the second measured structural gap: `EvidenceRow` could only point at
 * a resource or a capability, so no relationship could ever carry evidence
 * lineage — not even the 180 that already exist. `related_relationship_id` is
 * additive and nullable; existing evidence rows remain valid unchanged.
 */
export interface CrossSystemEvidenceRow extends EvidenceRow {
  related_relationship_id?: string | null;
}

/**
 * The entity row the vocabulary above always implied but never had.
 *
 * `CrossSystemRelationshipRow` can only name entities as `from_id`/`to_id`
 * strings, so an APPLICATION could be pointed at but never registered: it had
 * no canonical name, no state, and no provenance of its own. That is the one
 * thing that made `APPLICATION_RECORD_READBACK` impossible while every other
 * lock passed. This row closes exactly that gap and nothing else — it adds no
 * entity type and no relationship kind, so the vocabulary is unchanged.
 *
 * It is identity, not evidence. `evidence_refs` are pointers into the existing
 * canonical evidence store; an entity never carries copies of what proved it.
 */
export interface CrossSystemEntityRow {
  /** Deterministic and human-readable, e.g. `application://dna-os/software-delivery` — the same identity-as-id discipline software/repository-registry/ and software/provider-project-registry/ already use. */
  entity_id: string;
  entity_type: CrossSystemEntityType;
  canonical_name: string;
  /** The entity's own state. Deliberately a free-form canonical string rather than a fixed union: proof levels (DECLARED / RUNTIME_PROVEN / END_TO_END_PROVEN / BROKEN / BLOCKED) belong to the domain that owns the entity, and flattening them here is exactly the collapse the Owner forbade. */
  state: string;
  source_authority: SourceAuthority;
  /** Pointers into the existing canonical evidence — never copies. */
  evidence_refs: readonly string[];
  created_at: string;
  updated_at: string;
}
