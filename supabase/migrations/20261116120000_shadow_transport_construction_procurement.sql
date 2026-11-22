-- Applied to Supabase project xeytcavxejhyzxwevgto on 2026-11-16 and recorded
-- in supabase_migrations.schema_migrations as 20261116120000.
-- Stateless integration references for transport, construction, and public
-- procurement; no business payload rows were inserted.
--
-- Integration Model stores external identifiers, current states, relationships,
-- and durable route audit references only. Business payloads are not stored in
-- these tables. Payload delivery is transient; the route/reference record stays
-- after completion. No expires_at is defined for relationships or route audit.
--
-- adapter_id is an opaque reference to system.system_adapters.adapter_id.
-- There are intentionally no cross-schema foreign keys. External IDs are scoped
-- by adapter. The source systems remain authoritative for their own records.
-- SaaS-owned business data belongs in separate tenant-scoped saas_* tables and
-- is not part of this Integration Model migration.

begin;

-- Entity snapshots: each table holds only a source ID, its adapter, a compact
-- state and the last time the source confirmed it. Detailed payloads are omitted.
create table public.shadow_transport_jobs (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

create table public.shadow_vehicle_types (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

create table public.shadow_vehicle_costs (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

create table public.shadow_wbs (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

create table public.shadow_boq_items (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

create table public.shadow_rate_analysis (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

create table public.shadow_government_procurements (
  adapter_id uuid not null,
  external_id text not null check (length(btrim(external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null,
  primary key (adapter_id, external_id)
);

-- Durable graph edges. These rows retain only identifiers and relationship
-- semantics; they are not deleted when a routed request completes.
create table public.shadow_relationships (
  relationship_event_id uuid primary key default gen_random_uuid(),
  source_adapter_id uuid not null,
  source_external_id text not null
    check (length(btrim(source_external_id)) between 1 and 240),
  relation_type text not null
    check (length(btrim(relation_type)) between 1 and 100),
  target_adapter_id uuid not null,
  target_external_id text not null
    check (length(btrim(target_external_id)) between 1 and 240),
  state text not null check (length(btrim(state)) between 1 and 80),
  last_seen_at timestamptz not null
  -- Repeated edges are allowed so changed states can be recorded as history.
  -- Consumers select the latest event for a given source/relationship/target.
);

create index shadow_relationships_target_idx
  on public.shadow_relationships
    (target_adapter_id, target_external_id, relation_type);
create index shadow_relationships_source_idx
  on public.shadow_relationships
    (source_adapter_id, source_external_id, relation_type, last_seen_at desc);

-- Persistent request-route audit. `COMPLETED` is a durable terminal state.
-- The request body/payload is deliberately not represented by a column here.
create table public.integration_route_audit (
  route_event_id uuid primary key default gen_random_uuid(),
  route_id uuid not null,
  adapter_id uuid not null,
  target_adapter_id uuid not null,
  reference_id text not null
    check (length(btrim(reference_id)) between 1 and 240),
  source_external_id text,
  target_external_id text,
  attempt_no integer not null default 1 check (attempt_no > 0),
  route_state text not null check (route_state in (
    'RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'
  )),
  event_at timestamptz not null default now()
);

create index integration_route_audit_state_time_idx
  on public.integration_route_audit (route_state, event_at desc);
create index integration_route_audit_target_ref_idx
  on public.integration_route_audit (target_adapter_id, reference_id);
create index integration_route_audit_route_time_idx
  on public.integration_route_audit (route_id, event_at);

alter table public.shadow_transport_jobs enable row level security;
alter table public.shadow_vehicle_types enable row level security;
alter table public.shadow_vehicle_costs enable row level security;
alter table public.shadow_wbs enable row level security;
alter table public.shadow_boq_items enable row level security;
alter table public.shadow_rate_analysis enable row level security;
alter table public.shadow_government_procurements enable row level security;
alter table public.shadow_relationships enable row level security;
alter table public.integration_route_audit enable row level security;

revoke all on public.shadow_transport_jobs from public, anon, authenticated;
revoke all on public.shadow_vehicle_types from public, anon, authenticated;
revoke all on public.shadow_vehicle_costs from public, anon, authenticated;
revoke all on public.shadow_wbs from public, anon, authenticated;
revoke all on public.shadow_boq_items from public, anon, authenticated;
revoke all on public.shadow_rate_analysis from public, anon, authenticated;
revoke all on public.shadow_government_procurements from public, anon, authenticated;
revoke all on public.shadow_relationships from public, anon, authenticated;
revoke all on public.integration_route_audit from public, anon, authenticated;

grant select, insert, update on public.shadow_transport_jobs to service_role;
grant select, insert, update on public.shadow_vehicle_types to service_role;
grant select, insert, update on public.shadow_vehicle_costs to service_role;
grant select, insert, update on public.shadow_wbs to service_role;
grant select, insert, update on public.shadow_boq_items to service_role;
grant select, insert, update on public.shadow_rate_analysis to service_role;
grant select, insert, update on public.shadow_government_procurements to service_role;
-- Relationships and route audit are append-only; record each transition as a
-- new row instead of editing or deleting previous history.
grant select, insert on public.shadow_relationships to service_role;
grant select, insert on public.integration_route_audit to service_role;
revoke update, delete, truncate on public.shadow_relationships from service_role;
revoke update, delete, truncate on public.integration_route_audit from service_role;

comment on table public.integration_route_audit is
  'Append-only, durable, payload-free route lifecycle audit. Insert COMPLETED as a terminal event; no expires_at.';
comment on table public.shadow_relationships is
  'Append-only adapter-scoped graph-edge events containing identifiers and relation state only.';
comment on column public.integration_route_audit.reference_id is
  'Correlation/reference identifier retained after payload deletion and route completion.';
comment on column public.integration_route_audit.route_id is
  'Stable identifier shared by the append-only lifecycle events for one routed request.';
comment on column public.shadow_government_procurements.external_id is
  'Opaque source reference only; e-CPPM field-level schema is not publicly verified.';

commit;
