/**
 * หน้าที่: the real, reviewable Postgres implementation of the Registry
 * Writer's write path and the Lookup API's read queries against
 * `software_registry`, using the `pg` package (this repo's first-ever
 * runtime database dependency — see `../ARCHITECTURE_DECISIONS.md`).
 * Chosen over `@supabase/supabase-js` specifically because
 * `../migrations/0001_create_software_registry_roles.sql` requires real
 * Postgres ROLE-based GRANT/REVOKE separation (business_runtime /
 * software_registry_runtime / registry_writer), which has no clean
 * equivalent in Supabase's client-key+RLS model.
 *
 * INVOKED FOR REAL as of 2026-08-24 (Railway migration — real Postgres
 * provisioned, schema/roles migrated, verified against the live
 * database). Every raw function here still takes an already-built
 * `pg.Pool` as a parameter — this file never reads an env var or resolves
 * a credential itself; `transport/owner-command-http/server.ts` builds
 * the real `Pool` from a Railway-injected connection string and passes it
 * in, same discipline as `WriteGateContext`/`ExecutionPolicyContext`.
 *
 * `PostgresAsyncRegistryStore` (below) is the real, live-used
 * implementation of `AsyncRegistryStore` (`../store-port.ts`) — NOT
 * `RegistryStore`: that interface's methods are synchronous, matching
 * `../adapters/local-file-store.ts`/`persistent-file-store.ts`, and a
 * genuine `pg` round trip is inherently async. Rather than force this
 * behind a sync interface, `AsyncRegistryStore` is a distinct,
 * Promise-returning port that only the live registration-candidate/
 * lookup/update HTTP request path uses — everything else in this repo
 * keeps using plain synchronous `RegistryStore`, untouched.
 *
 * Input: a `pg.Pool` + the same row-shaped inputs `store-port.ts` defines.
 * Output: `writeApprovedCandidateAsync`, `findCapabilityByIdAsync`,
 * `findCapabilityBySemanticFingerprintAsync`,
 * `findCapabilityByCanonicalNameAsync`, `findResourceByContentHashAsync`.
 * Dependency ที่อนุญาต: ../store-port.ts, ../types.ts, the `pg` package.
 * สิ่งที่ห้ามแตะ: never construct a `Pool` inside this file. Never accept a
 * raw connection string / credential value as a parameter here — only an
 * already-built `Pool`. Every query must be parameterized ($1, $2, ...) —
 * never string-interpolate a value into SQL.
 */

import type { Pool } from "pg";
import type { ApprovedCandidateWrite, AsyncRegistryStore, WriteOutcome } from "../store-port";
import type { CapabilityLookupResult, CapabilityRow, EvidenceRow, IngressMetadataRow, RelationshipEdge, RelationshipRow, ResourceRow, VersionRow } from "../types";

interface CapabilityLookupRow {
  capability_id: string;
  status: CapabilityRow["status"];
  input_contract: readonly string[];
  output_contract: readonly string[];
  resource_ids: readonly string[] | null;
  source_locations: readonly string[] | null;
  versions: readonly string[] | null;
  dependencies: readonly string[] | null;
  eligible_workers: readonly string[] | null;
  evidence_refs: readonly string[] | null;
  ingress_metadata: IngressMetadataRow | null;
  relationships: readonly RelationshipEdge[] | null;
}

function toLookupResult(row: CapabilityLookupRow): CapabilityLookupResult {
  return {
    capability_id: row.capability_id,
    status: row.status,
    input_contract: row.input_contract,
    output_contract: row.output_contract,
    resource_ids: row.resource_ids ?? [],
    source_location: row.source_locations ?? [],
    version: row.versions ?? [],
    dependencies: row.dependencies ?? [],
    eligible_workers: row.eligible_workers ?? [],
    evidence_refs: row.evidence_refs ?? [],
    ingress_metadata: row.ingress_metadata ?? null,
    relationships: row.relationships ?? [],
  };
}

/** One capability + its joined resources/relationships/evidence, aggregated in SQL so a lookup is one round trip. `%WHERE%` is substituted with a literal column-name clause below — never with a caller-supplied string. */
const CAPABILITY_LOOKUP_QUERY_TEMPLATE = `
  select
    c.capability_id,
    c.status,
    c.input_contract,
    c.output_contract,
    c.ingress_metadata,
    array_remove(array_agg(distinct rc.resource_id), null) as resource_ids,
    array_remove(array_agg(distinct r.source_location), null) as source_locations,
    array_remove(array_agg(distinct v.version), null) as versions,
    array_remove(array_agg(distinct case when rel.relationship_kind = 'CAPABILITY_TO_DEPENDENCY' then rel.to_id end), null) as dependencies,
    array_remove(array_agg(distinct case when rel.relationship_kind = 'CAPABILITY_TO_WORKER' then rel.to_id end), null) as eligible_workers,
    array_remove(array_agg(distinct e.evidence_ref), null) as evidence_refs,
    coalesce(jsonb_agg(distinct jsonb_build_object('to_type', rel.to_type, 'to_id', rel.to_id, 'relationship_kind', rel.relationship_kind)) filter (where rel.to_id is not null), '[]'::jsonb) as relationships
  from software_registry.capabilities c
  left join software_registry.resource_capabilities rc on rc.capability_id = c.capability_id
  left join software_registry.resources r on r.resource_id = rc.resource_id
  left join software_registry.versions v on v.resource_id = r.resource_id
  left join software_registry.relationships rel on rel.from_id = c.capability_id
    left join software_registry.evidence e on e.capability_id = c.capability_id
  where %WHERE%
  group by c.capability_id, c.status, c.input_contract, c.output_contract, c.ingress_metadata
`;

async function runLookup(pool: Pool, whereColumn: "c.capability_id" | "c.semantic_fingerprint" | "c.canonical_name", value: string): Promise<CapabilityLookupResult | null> {
  const sql = CAPABILITY_LOOKUP_QUERY_TEMPLATE.replace("%WHERE%", `${whereColumn} = $1`);
  const { rows } = await pool.query<CapabilityLookupRow>(sql, [value]);
  return rows.length > 0 ? toLookupResult(rows[0]) : null;
}

export function findCapabilityByIdAsync(pool: Pool, capability_id: string): Promise<CapabilityLookupResult | null> {
  return runLookup(pool, "c.capability_id", capability_id);
}

export function findCapabilityBySemanticFingerprintAsync(pool: Pool, semantic_fingerprint: string): Promise<CapabilityLookupResult | null> {
  return runLookup(pool, "c.semantic_fingerprint", semantic_fingerprint);
}

export function findCapabilityByCanonicalNameAsync(pool: Pool, canonical_name: string): Promise<CapabilityLookupResult | null> {
  return runLookup(pool, "c.canonical_name", canonical_name);
}

/**
 * Real column mapping, not `select *` (2026-08-24 fix — verified live
 * against the actual applied schema before this file was ever invoked for
 * real): `resources` has NO `version` column — every other adapter
 * (`local-file-store.ts`, `persistent-file-store.ts`) treats
 * `ResourceRow.version` as the resource's current version, sourced from
 * its most recent `versions` row, so this subquery reproduces that.
 * `ResourceRow.content_hash` is, everywhere else in this codebase
 * (`registry-writer.ts#commitRegisteredCandidate` sets it to
 * `fingerprint.exact`), the EXACT-match fingerprint — the real,
 * unique-constrained SQL column for that is `exact_fingerprint`, not the
 * separate, never-written `content_hash` column, so it is read from
 * there. The real `content_hash` SQL column is left alone (part of the
 * reviewed migration; not this file's decision to add/drop).
 */
const RESOURCE_ROW_QUERY = `
  select r.resource_id, r.resource_type, r.owner_id, r.repository_id, r.source_location, r.module,
         coalesce((select v.version from software_registry.versions v where v.resource_id = r.resource_id order by v.created_at desc limit 1), '') as version,
         r.exact_fingerprint as content_hash,
         r.status, r.created_at, r.updated_at
  from software_registry.resources r
  where %WHERE%
`;

export async function findResourceByContentHashAsync(pool: Pool, content_hash: string): Promise<ResourceRow | null> {
  const { rows } = await pool.query<ResourceRow>(RESOURCE_ROW_QUERY.replace("%WHERE%", "r.exact_fingerprint = $1"), [content_hash]);
  return rows.length > 0 ? rows[0] : null;
}

export async function findResourceByExactFingerprintAsync(pool: Pool, exact_fingerprint: string): Promise<ResourceRow | null> {
  const { rows } = await pool.query<ResourceRow>(RESOURCE_ROW_QUERY.replace("%WHERE%", "r.exact_fingerprint = $1"), [exact_fingerprint]);
  return rows.length > 0 ? rows[0] : null;
}

export async function findResourceByIdAsync(pool: Pool, resource_id: string): Promise<ResourceRow | null> {
  const { rows } = await pool.query<ResourceRow>(RESOURCE_ROW_QUERY.replace("%WHERE%", "r.resource_id = $1"), [resource_id]);
  return rows.length > 0 ? rows[0] : null;
}

export async function addRelationshipAsync(pool: Pool, row: Omit<RelationshipRow, "relationship_id" | "created_at">): Promise<{ added: boolean }> {
  const { rows } = await pool.query<{ inserted: boolean }>(
    `insert into software_registry.relationships (relationship_id, from_type, from_id, to_type, to_id, relationship_kind)
     values (gen_random_uuid(), $1, $2, $3, $4, $5)
     on conflict (from_type, from_id, to_type, to_id, relationship_kind) do nothing
     returning true as inserted`,
    [row.from_type, row.from_id, row.to_type, row.to_id, row.relationship_kind],
  );
  return { added: rows.length > 0 };
}

export async function removeRelationshipAsync(pool: Pool, from_id: string, to_id: string, relationship_kind: string): Promise<{ removed: boolean }> {
  const { rowCount } = await pool.query(
    `delete from software_registry.relationships where from_id = $1 and to_id = $2 and relationship_kind = $3`,
    [from_id, to_id, relationship_kind],
  );
  return { removed: (rowCount ?? 0) > 0 };
}

export async function addEvidenceAsync(pool: Pool, row: Omit<EvidenceRow, "evidence_id" | "created_at">): Promise<{ added: boolean }> {
  const { rows } = await pool.query<{ inserted: boolean }>(
    `insert into software_registry.evidence (evidence_id, resource_id, capability_id, evidence_type, evidence_ref)
     values (gen_random_uuid(), $1, $2, $3, $4)
     on conflict (evidence_ref, resource_id, capability_id) do nothing
     returning true as inserted`,
    [row.related_resource_id, row.related_capability_id, row.evidence_type, row.evidence_ref],
  );
  return { added: rows.length > 0 };
}

/** Also advances the resource's own current version, same real behavior as `persistent-file-store.ts#addVersion` — reproduced here via `RESOURCE_ROW_QUERY`'s latest-version subquery rather than a write, since `resources` has no `version` column to update. */
export async function addVersionAsync(pool: Pool, row: Omit<VersionRow, "version_id" | "created_at">): Promise<{ added: boolean }> {
  const { rows } = await pool.query<{ inserted: boolean }>(
    `insert into software_registry.versions (version_id, resource_id, version, commit_sha, content_hash, source_location)
     values (gen_random_uuid(), $1, $2, $3, $4, $5)
     on conflict (resource_id, version) do nothing
     returning true as inserted`,
    [row.resource_id, row.version, row.commit_sha, row.hash, row.source_location],
  );
  return { added: rows.length > 0 };
}

export async function appendRegistrationEventAsync(pool: Pool, event: { candidate_id: string; decision: string; duplicate_result: string | null; evidence_ref: readonly string[] }): Promise<void> {
  await pool.query(
    `insert into software_registry.registration_events (event_id, request_id, candidate_id, decision, duplicate_result, evidence_ref)
     values (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [event.candidate_id, event.candidate_id, event.decision, event.duplicate_result, event.evidence_ref[0] ?? null],
  );
}

export async function writeApprovedCandidateAsync(pool: Pool, input: ApprovedCandidateWrite): Promise<WriteOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const resourceResult = await client.query(
      `insert into software_registry.resources
         (resource_id, resource_type, owner_id, repository_id, source_location, module, exact_fingerprint, content_hash, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (exact_fingerprint) do update set updated_at = now()
       returning resource_id, (xmax = 0) as inserted`,
      [input.resource.resource_id, input.resource.resource_type, input.resource.owner_id, input.resource.repository_id, input.resource.source_location, input.resource.module, input.resource.content_hash, null, input.resource.status],
    );
    const resource_id: string = resourceResult.rows[0].resource_id;
    const insertedResource: boolean = resourceResult.rows[0].inserted;

    let capability_id: string | null = null;
    let insertedCapability = false;
    if (input.capability) {
      const existingCapability = await client.query<{ capability_id: string }>(
        `select capability_id from software_registry.capabilities where semantic_fingerprint = $1 limit 1`,
        [input.capability.semantic_fingerprint],
      );
      const capabilityResult = existingCapability.rows.length > 0 ? { rows: [{ capability_id: existingCapability.rows[0].capability_id, inserted: false }] } : await client.query(
        `insert into software_registry.capabilities
           (capability_id, canonical_name, capability_type, purpose, input_contract, output_contract, side_effects, semantic_fingerprint, status, ingress_metadata)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, 'REGISTERED', $9::jsonb)
         returning capability_id, (xmax = 0) as inserted`,
        [input.capability.capability_id, input.capability.canonical_name, input.capability.capability_type, input.capability.purpose, JSON.stringify(input.capability.input_contract), JSON.stringify(input.capability.output_contract), JSON.stringify(input.capability.side_effects), input.capability.semantic_fingerprint, input.capability.ingress_metadata ? JSON.stringify(input.capability.ingress_metadata) : null],
      );
      capability_id = capabilityResult.rows[0].capability_id;
      insertedCapability = capabilityResult.rows[0].inserted;

      await client.query(`insert into software_registry.resource_capabilities (resource_id, capability_id) values ($1, $2) on conflict do nothing`, [resource_id, capability_id]);
    }

    for (const rel of input.relationships) {
      const from_id = rel.from_id === input.resource.resource_id ? resource_id : rel.from_id;
      const to_id = capability_id && rel.to_id === input.capability?.capability_id ? capability_id : rel.to_id;
      await client.query(
        `insert into software_registry.relationships (relationship_id, from_type, from_id, to_type, to_id, relationship_kind)
         values (gen_random_uuid(), $1, $2, $3, $4, $5)
         on conflict (from_type, from_id, to_type, to_id, relationship_kind) do nothing`,
        [rel.from_type, from_id, rel.to_type, to_id, rel.relationship_kind],
      );
    }

    await client.query(
      `insert into software_registry.versions (version_id, resource_id, version, commit_sha, content_hash, source_location)
       values (gen_random_uuid(), $1, $2, $3, $4, $5)
       on conflict (resource_id, version) do nothing`,
      [resource_id, input.version.version, input.version.commit_sha, null, input.version.source_location],
    );

    for (const ev of input.evidence) {
      const resource_id_for_evidence = ev.related_resource_id === input.resource.resource_id ? resource_id : ev.related_resource_id;
      const capability_id_for_evidence = capability_id && ev.related_capability_id === input.capability?.capability_id ? capability_id : ev.related_capability_id;
      await client.query(
        `insert into software_registry.evidence (evidence_id, resource_id, capability_id, evidence_type, evidence_ref)
         values (gen_random_uuid(), $1, $2, $3, $4)
         on conflict (evidence_ref, resource_id, capability_id) do nothing`,
        [resource_id_for_evidence, capability_id_for_evidence, ev.evidence_type, ev.evidence_ref],
      );
    }

    await client.query("COMMIT");
    return { resource_id, capability_id, inserted: insertedResource || insertedCapability };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The real, live `AsyncRegistryStore` implementation — one thin object
 * bundling every function above around a single already-built `Pool`.
 * Never constructs the `Pool` itself (see file header) — the caller
 * (`transport/owner-command-http/server.ts`) builds it from a real
 * Railway-injected connection string and passes it in here.
 */
export class PostgresAsyncRegistryStore implements AsyncRegistryStore {
  constructor(private readonly pool: Pool) {}

  writeApprovedCandidate(input: ApprovedCandidateWrite): Promise<WriteOutcome> {
    return writeApprovedCandidateAsync(this.pool, input);
  }
  appendRegistrationEvent(event: { candidate_id: string; decision: string; duplicate_result: string | null; evidence_ref: readonly string[] }): Promise<void> {
    return appendRegistrationEventAsync(this.pool, event);
  }
  findCapabilityById(capability_id: string): Promise<CapabilityLookupResult | null> {
    return findCapabilityByIdAsync(this.pool, capability_id);
  }
  findCapabilityBySemanticFingerprint(semantic_fingerprint: string): Promise<CapabilityLookupResult | null> {
    return findCapabilityBySemanticFingerprintAsync(this.pool, semantic_fingerprint);
  }
  findCapabilityByCanonicalName(canonical_name: string): Promise<CapabilityLookupResult | null> {
    return findCapabilityByCanonicalNameAsync(this.pool, canonical_name);
  }
  /** Routed to the real, unique-constrained `exact_fingerprint` column — see `RESOURCE_ROW_QUERY`'s own doc comment on why the separate `content_hash` column would silently break duplicate detection. */
  findResourceByContentHash(content_hash: string): Promise<ResourceRow | null> {
    return findResourceByExactFingerprintAsync(this.pool, content_hash);
  }
  findResourceById(resource_id: string): Promise<ResourceRow | null> {
    return findResourceByIdAsync(this.pool, resource_id);
  }
  addRelationship(row: Omit<RelationshipRow, "relationship_id" | "created_at">): Promise<{ added: boolean }> {
    return addRelationshipAsync(this.pool, row);
  }
  removeRelationship(from_id: string, to_id: string, relationship_kind: string): Promise<{ removed: boolean }> {
    return removeRelationshipAsync(this.pool, from_id, to_id, relationship_kind);
  }
  addEvidence(row: Omit<EvidenceRow, "evidence_id" | "created_at">): Promise<{ added: boolean }> {
    return addEvidenceAsync(this.pool, row);
  }
  addVersion(row: Omit<VersionRow, "version_id" | "created_at">): Promise<{ added: boolean }> {
    return addVersionAsync(this.pool, row);
  }
}
