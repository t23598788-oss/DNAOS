/**
 * หน้าที่: the persistence boundary the cross-system model was missing.
 *
 * `./cross-system-relationships.ts` deliberately performs no I/O — it owns
 * identity and validation, and says so in its own header. Nothing owned the
 * writing. That is why `APPLICATION_RECORD_READBACK` was the one Phase-1 lock
 * that could not pass while capabilities, relationships, evidence, revision
 * identity and technical debt all read back cleanly: an APPLICATION could be
 * pointed at but never registered.
 *
 * ADDITIVE ONLY. This store writes to its own directory
 * (`data/cross-system/`) and never opens, migrates or rewrites any of the
 * eight legacy canonical stores. The ~200 existing relationship rows keep
 * their ids, kinds and created_at untouched and their existing readers keep
 * working, because nothing here reads or writes `data/canonical/`.
 *
 * IDENTITY, NOT EVIDENCE. An entity row carries pointers into the existing
 * evidence store, never copies of what proved it.
 *
 * Input: entity/relationship rows from a caller.
 * Output: registerEntity, getEntity, listEntities, linkEntities,
 * relationshipsFrom, resolveApplication.
 * Dependency ที่อนุญาต: ./cross-system-types.ts, ./cross-system-relationships.ts,
 * node:fs, node:path, node:url.
 * สิ่งที่ห้ามแตะ: ห้ามเขียนลง data/canonical/ จากไฟล์นี้เด็ดขาด, ห้ามคัดลอกเนื้อ
 * evidence มาเก็บไว้ในแถว entity, และห้ามแก้ logicalRelationshipId.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CrossSystemEntityRow, CrossSystemEntityType, CrossSystemRelationshipRow, ExtendedRelationshipEntityType, ExtendedRelationshipKind, SourceAuthority } from "./cross-system-types";
import { logicalRelationshipId, validateCrossSystemRelationship } from "./cross-system-relationships";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const CROSS_SYSTEM_DIR: string = join(MODULE_DIR, "data", "cross-system");
export const ENTITY_FILE: string = join(CROSS_SYSTEM_DIR, "entities.jsonl");
export const RELATIONSHIP_FILE: string = join(CROSS_SYSTEM_DIR, "relationships.jsonl");

/**
 * Fixture separation. Tests point at their own throwaway directory instead of
 * writing probe rows into the canonical store — the same discipline the rest of
 * this repo keeps between real records and fixtures. Production callers pass
 * nothing and get the canonical location.
 */
let activeDir: string = CROSS_SYSTEM_DIR;
export function useStoreDirectory(directory: string): void { activeDir = directory; }
export function resetStoreDirectory(): void { activeDir = CROSS_SYSTEM_DIR; }
const entityFile = (): string => join(activeDir, "entities.jsonl");
const relationshipFile = (): string => join(activeDir, "relationships.jsonl");

export type WriteStatus = "REGISTERED" | "REUSED" | "REJECTED";

export interface EntityWriteResult {
  status: WriteStatus;
  reason: string | null;
  entity: CrossSystemEntityRow | null;
}

export interface RelationshipWriteResult {
  status: WriteStatus;
  reason: string | null;
  relationship: CrossSystemRelationshipRow | null;
}

function readLines<T>(file: string): readonly T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as T);
}

/** Append-only: a superseded state is a new row, never an edit of the old one, so history stays readable. */
function append(file: string, row: unknown): void {
  mkdirSync(activeDir, { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

export function currentEntityFile(): string { return entityFile(); }

export function listEntities(): readonly CrossSystemEntityRow[] {
  // Last row wins for a given entity_id — the append-only log's current view.
  const latest = new Map<string, CrossSystemEntityRow>();
  for (const row of readLines<CrossSystemEntityRow>(entityFile())) latest.set(row.entity_id, row);
  return [...latest.values()];
}

export function getEntity(entity_id: string): CrossSystemEntityRow | null {
  return listEntities().find((row) => row.entity_id === entity_id) ?? null;
}

const ENTITY_ID_SHAPE = /^[a-z_]+:\/\/[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export interface RegisterEntityInput {
  entity_id: string;
  entity_type: CrossSystemEntityType;
  canonical_name: string;
  state: string;
  source_authority: SourceAuthority;
  evidence_refs: readonly string[];
}

/**
 * Fail-closed on every missing or malformed field. A duplicate registration of
 * the SAME identity returns the existing row (REUSED) and writes nothing; a
 * same-id registration whose type or name disagrees is REJECTED rather than
 * silently overwriting an identity someone else already established.
 */
export function registerEntity(input: RegisterEntityInput, now: string = new Date().toISOString()): EntityWriteResult {
  if (typeof input?.entity_id !== "string" || !ENTITY_ID_SHAPE.test(input.entity_id)) {
    return { status: "REJECTED", reason: "INVALID_ENTITY_ID", entity: null };
  }
  if (typeof input.canonical_name !== "string" || input.canonical_name.trim().length === 0) {
    return { status: "REJECTED", reason: "MISSING_CANONICAL_NAME", entity: null };
  }
  if (typeof input.state !== "string" || input.state.trim().length === 0) {
    return { status: "REJECTED", reason: "MISSING_STATE", entity: null };
  }
  if (!Array.isArray(input.evidence_refs) || input.evidence_refs.length === 0) {
    return { status: "REJECTED", reason: "MISSING_EVIDENCE_REFS", entity: null };
  }

  const existing = getEntity(input.entity_id);
  if (existing) {
    if (existing.entity_type !== input.entity_type || existing.canonical_name !== input.canonical_name) {
      return { status: "REJECTED", reason: "IDENTITY_CONFLICT", entity: existing };
    }
    if (existing.state === input.state && existing.evidence_refs.length >= input.evidence_refs.length) {
      return { status: "REUSED", reason: null, entity: existing };
    }
    const updated: CrossSystemEntityRow = { ...existing, state: input.state, evidence_refs: [...new Set([...existing.evidence_refs, ...input.evidence_refs])], updated_at: now };
    append(entityFile(), updated);
    return { status: "REGISTERED", reason: null, entity: updated };
  }

  const row: CrossSystemEntityRow = {
    entity_id: input.entity_id,
    entity_type: input.entity_type,
    canonical_name: input.canonical_name,
    state: input.state,
    source_authority: input.source_authority,
    evidence_refs: [...input.evidence_refs],
    created_at: now,
    updated_at: now,
  };
  append(entityFile(), row);
  return { status: "REGISTERED", reason: null, entity: row };
}

export function listRelationships(): readonly CrossSystemRelationshipRow[] {
  const latest = new Map<string, CrossSystemRelationshipRow>();
  for (const row of readLines<CrossSystemRelationshipRow>(relationshipFile())) latest.set(row.relationship_id, row);
  return [...latest.values()];
}

export function relationshipsFrom(entity_id: string): readonly CrossSystemRelationshipRow[] {
  return listRelationships().filter((row) => row.from_id === entity_id);
}

export interface LinkInput {
  from_type: ExtendedRelationshipEntityType;
  from_id: string;
  to_type: ExtendedRelationshipEntityType;
  to_id: string;
  relationship_kind: ExtendedRelationshipKind;
  source_authority: SourceAuthority;
  evidence_refs: readonly string[];
  scope?: string | null;
}

/**
 * The edge's id comes from `logicalRelationshipId`, so writing the same logical
 * edge twice is idempotent by construction rather than by a lookup this file
 * invents. Validation is the existing `validateCrossSystemRelationship` — this
 * store adds no second opinion about what a legal edge is.
 */
export function linkEntities(input: LinkInput, now: string = new Date().toISOString()): RelationshipWriteResult {
  const candidate: CrossSystemRelationshipRow = {
    relationship_id: "",
    from_type: input.from_type,
    from_id: input.from_id,
    to_type: input.to_type,
    to_id: input.to_id,
    relationship_kind: input.relationship_kind,
    created_at: now,
    scope: input.scope ?? null,
    state: "ACTIVE",
    last_confirmed_at: now,
    source_authority: input.source_authority,
    evidence_refs: [...input.evidence_refs],
  };
  candidate.relationship_id = logicalRelationshipId(candidate as never);

  const verdict = validateCrossSystemRelationship(candidate as never, {});
  if (!verdict.valid) {
    return { status: "REJECTED", reason: verdict.errors?.join(", ") ?? "INVALID_RELATIONSHIP", relationship: null };
  }

  const existing = listRelationships().find((row) => row.relationship_id === candidate.relationship_id);
  if (existing) return { status: "REUSED", reason: null, relationship: existing };

  append(relationshipFile(), candidate);
  return { status: "REGISTERED", reason: null, relationship: candidate };
}

export interface ApplicationResolution {
  entity: CrossSystemEntityRow | null;
  relationships: readonly CrossSystemRelationshipRow[];
  capabilities: readonly string[];
  repositories: readonly string[];
  versions: readonly string[];
  work: readonly string[];
  executions: readonly string[];
}

/** One read that answers "what is this application, and what does it resolve to". */
export function resolveApplication(entity_id: string): ApplicationResolution {
  const entity = getEntity(entity_id);
  const direct = relationshipsFrom(entity_id);
  const all = listRelationships();
  const repositories = direct.filter((r) => r.to_type === "REPOSITORY").map((r) => r.to_id);
  const versions = all.filter((r) => repositories.includes(r.from_id) && r.to_type === "VERSION").map((r) => r.to_id);
  const work = all.filter((r) => r.from_type === "WORK").map((r) => r.from_id);
  const executions = all.filter((r) => r.relationship_kind === "EXECUTION_OF_WORK" && work.includes(r.to_id)).map((r) => r.from_id);
  return {
    entity,
    relationships: [...direct],
    capabilities: direct.filter((r) => r.to_type === "CAPABILITY").map((r) => r.to_id),
    repositories,
    versions,
    work: [...new Set(work)],
    executions: [...new Set(executions)],
  };
}
