-- software/registry-database/migrations/0001_create_software_registry_schema.sql
--
-- Creates the `software_registry` schema and its 7 tables. This schema
-- holds control/infrastructure metadata about software produced by the
-- DNA OS software factory ONLY — never business data (companies,
-- customers, jobs, documents, payments). See ../ARCHITECTURE_DECISIONS.md
-- §BUSINESS_DATA_BOUNDARY.
--
-- STATUS: NOT EXECUTED. Reviewable source only — see MIGRATION_PLAN.md for
-- the pre-flight checklist that must pass before this ever runs against a
-- live database, and ROLLBACK_0001.sql for the recovery plan.
--
-- Idempotent to re-run against a partially-applied database: every
-- statement uses IF NOT EXISTS.

begin;

create schema if not exists software_registry;

-- resources: one row per registered artifact (file/module/repository entry).
create table if not exists software_registry.resources (
  resource_id     uuid primary key default gen_random_uuid(),
  resource_type   text not null,
  owner_id        text,
  repository_id   text,
  source_location text not null,
  module          text,
  exact_fingerprint text not null,
  content_hash    text,
  status          text not null default 'REGISTERED'
                    check (status in ('REGISTERED', 'SUPERSEDED', 'RETIRED')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint resources_exact_fingerprint_unique unique (exact_fingerprint)
);

-- capabilities: one row per distinct, semantically-fingerprinted capability.
create table if not exists software_registry.capabilities (
  capability_id        uuid primary key default gen_random_uuid(),
  canonical_name       text not null,
  capability_type      text not null,
  purpose              text not null,
  input_contract       jsonb not null default '{}'::jsonb,
  output_contract      jsonb not null default '{}'::jsonb,
  side_effects         jsonb not null default '[]'::jsonb,
  semantic_fingerprint text not null,
  status               text not null default 'REGISTERED'
                         check (status in ('REGISTERED', 'VERIFIED', 'SUPERSEDED', 'RETIRED')),
  verified_at          timestamptz,
  -- Present only for capability_type='AI_INGRESS' rows — the
  -- canonical_name/audience/human_facing/transport/endpoint/
  -- accepted_callers/purpose Type Validation contract. See
  -- control/event-pipeline/domain-classification.ts's IngressMetadata /
  -- validateIngressMetadata (audience must be 'MACHINE_AGENT_ONLY',
  -- human_facing must be false — enforced in application code before
  -- this column is ever written, not by a DB constraint).
  ingress_metadata     jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- resource_capabilities: join table, resource_id <-> capability_id.
create table if not exists software_registry.resource_capabilities (
  resource_id   uuid not null references software_registry.resources (resource_id),
  capability_id uuid not null references software_registry.capabilities (capability_id),
  relationship_status text not null default 'ACTIVE',
  created_at    timestamptz not null default now(),
  primary key (resource_id, capability_id)
);

-- relationships: heterogeneous graph edges (FILE->MODULE, MODULE->CAPABILITY,
-- CAPABILITY->WORKER, CAPABILITY->API, CAPABILITY->TEST,
-- CAPABILITY->DEPENDENCY, CAPABILITY->OWNER). from_id/to_id are loose
-- string ids (not FKs) because most entity kinds here (WORKER, API, TEST,
-- DEPENDENCY, OWNER) have no table of their own in this schema — a real,
-- deliberate tradeoff, not an oversight; only FILE/MODULE/CAPABILITY have a
-- backing table today, and this table must be able to reference the others.
create table if not exists software_registry.relationships (
  relationship_id    uuid primary key default gen_random_uuid(),
  from_type          text not null
                       check (from_type in ('FILE', 'MODULE', 'CAPABILITY', 'WORKER', 'API', 'TEST', 'DEPENDENCY', 'OWNER', 'SYSTEM_COMPONENT')),
  from_id            text not null,
  to_type            text not null
                       check (to_type in ('FILE', 'MODULE', 'CAPABILITY', 'WORKER', 'API', 'TEST', 'DEPENDENCY', 'OWNER', 'SYSTEM_COMPONENT')),
  to_id              text not null,
  -- COMMAND_INGRESS/REGISTRATION_INGRESS/TASK_LOOKUP/CAPABILITY_LOOKUP/
  -- WORK_RESULT_RETURN/SYSTEM_STATUS_READ: a CAPABILITY (resource_type=
  -- AI_INGRESS) connecting to one of DNA OS's own real pipeline stages —
  -- always to_type='SYSTEM_COMPONENT' with one fixed to_id per kind, see
  -- software/registry-database/registry-writer.ts's SYSTEM_COMPONENT_TARGETS.
  relationship_kind  text not null
                       check (relationship_kind in (
                         'FILE_TO_MODULE', 'MODULE_TO_CAPABILITY', 'CAPABILITY_TO_WORKER',
                         'CAPABILITY_TO_API', 'CAPABILITY_TO_TEST', 'CAPABILITY_TO_DEPENDENCY',
                         'CAPABILITY_TO_OWNER',
                         'COMMAND_INGRESS', 'REGISTRATION_INGRESS', 'TASK_LOOKUP',
                         'CAPABILITY_LOOKUP', 'WORK_RESULT_RETURN', 'SYSTEM_STATUS_READ',
                         'MCP_TO_WORK_RESULT_INGRESS', 'WORK_RESULT_TO_DOMAIN_CLASSIFIER',
                         'DOMAIN_TO_REGISTRATION_GATE', 'REGISTRATION_GATE_TO_REGISTRY_WRITER',
                         'REGISTRY_WRITER_TO_ARTIFACT_DESTINATION', 'ARTIFACT_DESTINATION_TO_TARGET_RESOLUTION',
                         'TARGET_RESOLUTION_TO_PERMISSION_POLICY_RESOLUTION',
                         'ORCHESTRATES_CAPABILITY', 'INGRESS_DISPATCHES_TO_ORCHESTRATOR',
                         'PERMISSION_POLICY_RESOLUTION_TO_ADMISSION', 'ADMISSION_TO_SOURCE_EXECUTION', 'EXECUTOR_USES_CONNECTION_REGISTRY',
                         'PROVIDER_AUTHORIZATION_MANAGES_CONNECTION', 'EXECUTOR_REQUIRES_PROVIDER_AUTHORIZATION',
                         'SOURCE_EXECUTION_TO_POST_COMMIT_VERIFICATION',
                         'POST_COMMIT_VERIFICATION_TO_DEPLOYABLE_ARTIFACT_READINESS'
                       )),
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  constraint relationships_edge_unique unique (from_type, from_id, to_type, to_id, relationship_kind)
);

-- versions: one row per (resource_id, version) actually registered.
create table if not exists software_registry.versions (
  version_id      uuid primary key default gen_random_uuid(),
  resource_id     uuid not null references software_registry.resources (resource_id),
  version         text not null,
  commit_sha      text,
  content_hash   text,
  source_location text not null,
  created_at      timestamptz not null default now(),
  constraint versions_resource_version_unique unique (resource_id, version)
);

-- evidence: a REFERENCE to where proof lives (file path, test-run id, URL)
-- — never a copy of the underlying log/source.
create table if not exists software_registry.evidence (
  evidence_id           uuid primary key default gen_random_uuid(),
  resource_id           uuid references software_registry.resources (resource_id),
  capability_id         uuid references software_registry.capabilities (capability_id),
  evidence_type         text not null,
  evidence_ref          text not null,
  verification_status   text not null default 'UNVERIFIED',
  created_at            timestamptz not null default now(),
  constraint evidence_ref_relation_unique unique (evidence_ref, resource_id, capability_id)
);

-- registration_events: append-only audit trail of every registration
-- attempt (approved, duplicate-exact, duplicate-candidate, or
-- rejected-evidence) — never only successes. No UPDATE/DELETE grant is
-- issued on this table to any role (see 0001_create_software_registry_roles.sql).
create table if not exists software_registry.registration_events (
  event_id         uuid primary key default gen_random_uuid(),
  request_id       text not null,
  candidate_id     text not null,
  decision         text not null
                     check (decision in ('APPROVED_FOR_REGISTRATION', 'DUPLICATE_EXACT', 'DUPLICATE_CANDIDATE', 'REJECTED_EVIDENCE')),
  duplicate_result text,
  resource_id      uuid references software_registry.resources (resource_id),
  capability_id    uuid references software_registry.capabilities (capability_id),
  evidence_ref     text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_resources_exact_fingerprint on software_registry.resources (exact_fingerprint);
create index if not exists idx_resources_content_hash on software_registry.resources (content_hash);
create index if not exists idx_resources_source_location on software_registry.resources (source_location);
create index if not exists idx_capabilities_semantic_fingerprint on software_registry.capabilities (semantic_fingerprint);
create index if not exists idx_capabilities_canonical_name on software_registry.capabilities (canonical_name);
create index if not exists idx_resource_capabilities_capability_id on software_registry.resource_capabilities (capability_id);
create index if not exists idx_relationships_from on software_registry.relationships (from_type, from_id);
create index if not exists idx_relationships_to on software_registry.relationships (to_type, to_id);
create index if not exists idx_versions_resource_id on software_registry.versions (resource_id);
create index if not exists idx_evidence_resource_id on software_registry.evidence (resource_id);
create index if not exists idx_evidence_capability_id on software_registry.evidence (capability_id);
create index if not exists idx_registration_events_candidate_id on software_registry.registration_events (candidate_id);
create index if not exists idx_registration_events_request_id on software_registry.registration_events (request_id);

commit;
