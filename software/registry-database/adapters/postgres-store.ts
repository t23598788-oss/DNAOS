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
 * NOT INVOKED ANYWHERE THIS ROUND. Nothing in this repo constructs a
 * `pg.Pool`, loads a connection string, or contacts a real database. Every
 * function here takes an already-built `pg.Pool` as a parameter — exactly
 * like `WriteGateContext`/`ExecutionPolicyContext` consume already-resolved
 * context rather than looking anything up themselves. A connection pool
 * would be constructed by a future transport from a
 * `SoftwareRegistryConnectionRef` (a `vault://`-style reference, same
 * discipline as `../../../credentials/provider-accounts/digitalocean/
 * credential-reference.ts`'s `VaultReference`) — that resolution step is
 * NOT_YET_BUILT and out of scope this round; this file never reads an env
 * var or a secret itself.
 *
 * Deliberately NOT shaped as a `RegistryStore` (see `../store-port.ts`):
 * `RegistryStore`'s methods are synchronous, matching
 * `../adapters/local-file-store.ts` (this round's only real caller,
 * exercised by `../tests/registry-writer.test.ts`); a genuine `pg` round
 * trip is inherently async. Forcing an async client behind a sync
 * interface (or making `RegistryStore` itself async, a real port change)
 * is a decision for whichever future round wires a real transport — not
 * invented here. These functions are real and typed so the SQL itself is
 * reviewable now.
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
import type { ApprovedCandidateWrite, WriteOutcome } from "../store-port";
import type { CapabilityLookupResult, CapabilityRow, IngressMetadataRow, RelationshipEdge, ResourceRow } from "../types";

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
    array_remove(array_agg(distinct r.version), null) as versions,
    array_remove(array_agg(distinct case when rel.relationship_kind = 'CAPABILITY_TO_DEPENDENCY' then rel.to_id end), null) as dependencies,
    array_remove(array_agg(distinct case when rel.relationship_kind = 'CAPABILITY_TO_WORKER' then rel.to_id end), null) as eligible_workers,
    array_remove(array_agg(distinct e.evidence_ref), null) as evidence_refs,
    coalesce(jsonb_agg(distinct jsonb_build_object('to_type', rel.to_type, 'to_id', rel.to_id, 'relationship_kind', rel.relationship_kind)) filter (where rel.to_id is not null), '[]'::jsonb) as relationships
  from software_registry.capabilities c
  left join software_registry.resource_capabilities rc on rc.capability_id = c.capability_id
  left join software_registry.resources r on r.resource_id = rc.resource_id
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

export async function findResourceByContentHashAsync(pool: Pool, content_hash: string): Promise<ResourceRow | null> {
  const { rows } = await pool.query<ResourceRow>(`select * from software_registry.resources where content_hash = $1`, [content_hash]);
  return rows.length > 0 ? rows[0] : null;
}

export async function findResourceByExactFingerprintAsync(pool: Pool, exact_fingerprint: string): Promise<ResourceRow | null> {
  const { rows } = await pool.query<ResourceRow>(`select * from software_registry.resources where exact_fingerprint = $1`, [exact_fingerprint]);
  return rows.length > 0 ? rows[0] : null;
}

export async function findResourceByIdAsync(pool: Pool, resource_id: string): Promise<ResourceRow | null> {
  const { rows } = await pool.query<ResourceRow>(`select * from software_registry.resources where resource_id = $1`, [resource_id]);
  return rows.length > 0 ? rows[0] : null;
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
