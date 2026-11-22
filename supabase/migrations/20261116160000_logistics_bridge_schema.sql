-- Logistics Bridge schema draft.
-- Design artifact only: this migration has not been applied to Production.
-- It stores adapter-scoped transport requests, immutable capacity observations,
-- and append-only matching decisions. Retailer/carrier systems remain the source
-- of truth for their full orders, vehicles, drivers, and dispatch operations.

begin;

create table system.logistics_requests (
  request_id uuid primary key default gen_random_uuid(),
  -- Opaque tenant boundary. No tenant registry/FK is present in the inspected
  -- schema; ingestion must derive this from authenticated adapter context.
  tenant_id uuid not null,
  source_adapter_id uuid not null
    references system.system_adapters(adapter_id) on delete restrict,
  external_request_id text not null
    check (length(btrim(external_request_id)) between 1 and 240),
  external_order_id text
    check (external_order_id is null or length(btrim(external_order_id)) between 1 and 240),
  source_revision integer not null default 1 check (source_revision > 0),
  data_owner_ref text not null check (length(btrim(data_owner_ref)) between 1 and 240),
  usage_rights text not null check (length(btrim(usage_rights)) between 1 and 120),
  source_record_ref text not null check (length(btrim(source_record_ref)) between 1 and 500),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  origin_reference text,
  origin_zone text,
  origin_latitude numeric(9, 6),
  origin_longitude numeric(9, 6),
  destination_reference text,
  destination_zone text,
  destination_latitude numeric(9, 6),
  destination_longitude numeric(9, 6),
  requested_weight numeric(24, 8) not null check (requested_weight > 0),
  weight_unit text not null check (length(btrim(weight_unit)) between 1 and 24),
  requested_pickup_time timestamptz not null,
  requested_delivery_by timestamptz,
  service_mode text,
  requirements jsonb not null default '{}'::jsonb
    check (jsonb_typeof(requirements) = 'object'),
  idempotency_key text not null unique
    check (length(btrim(idempotency_key)) between 1 and 240),
  occurred_at timestamptz not null,
  effective_at timestamptz not null,
  received_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  actor_id text,
  source_channel text not null
    check (length(btrim(source_channel)) between 1 and 120),
  unique (source_adapter_id, external_request_id, source_revision),
  unique (request_id, tenant_id),
  check ((origin_latitude is null) = (origin_longitude is null)),
  check ((destination_latitude is null) = (destination_longitude is null)),
  check (origin_latitude is null or origin_latitude between -90 and 90),
  check (origin_longitude is null or origin_longitude between -180 and 180),
  check (destination_latitude is null or destination_latitude between -90 and 90),
  check (destination_longitude is null or destination_longitude between -180 and 180),
  check (requested_delivery_by is null or requested_delivery_by >= requested_pickup_time)
);

create index logistics_requests_pickup_idx
  on system.logistics_requests (requested_pickup_time, recorded_at desc);
create index logistics_requests_origin_zone_idx
  on system.logistics_requests (origin_zone, destination_zone, requested_pickup_time);
create index logistics_requests_adapter_external_idx
  on system.logistics_requests (source_adapter_id, external_request_id);
create index logistics_requests_tenant_pickup_idx
  on system.logistics_requests (tenant_id, requested_pickup_time, recorded_at desc);

create table system.logistics_capacities (
  capacity_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  adapter_id uuid not null
    references system.system_adapters(adapter_id) on delete restrict,
  external_resource_id text not null
    check (length(btrim(external_resource_id)) between 1 and 240),
  vehicle_id text
    check (vehicle_id is null or length(btrim(vehicle_id)) between 1 and 240),
  resource_kind text not null check (resource_kind in (
    'vehicle', 'rail_slot', 'parcel_service', 'other'
  )),
  current_location_reference text,
  current_zone text,
  current_latitude numeric(9, 6),
  current_longitude numeric(9, 6),
  available_capacity numeric(24, 8) not null check (available_capacity >= 0),
  available_volume numeric(24, 8) check (available_volume is null or available_volume >= 0),
  volume_unit text,
  vehicle_type_code text,
  capacity_unit text not null check (length(btrim(capacity_unit)) between 1 and 24),
  available_from_time timestamptz not null,
  available_until_time timestamptz,
  service_zones jsonb not null default '[]'::jsonb
    check (jsonb_typeof(service_zones) in ('array', 'object')),
  capabilities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(capabilities) = 'object'),
  availability_status text not null check (availability_status in (
    'available', 'unavailable', 'in_transit', 'unknown'
  )),
  data_owner_ref text not null check (length(btrim(data_owner_ref)) between 1 and 240),
  usage_rights text not null check (length(btrim(usage_rights)) between 1 and 120),
  source_record_ref text not null check (length(btrim(source_record_ref)) between 1 and 500),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique
    check (length(btrim(idempotency_key)) between 1 and 240),
  occurred_at timestamptz not null,
  effective_at timestamptz not null,
  received_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  actor_id text,
  source_channel text not null
    check (length(btrim(source_channel)) between 1 and 120),
  unique (adapter_id, external_resource_id, occurred_at),
  unique (capacity_id, tenant_id),
  check ((current_latitude is null) = (current_longitude is null)),
  check (current_latitude is null or current_latitude between -90 and 90),
  check (current_longitude is null or current_longitude between -180 and 180),
  check (available_until_time is null or available_until_time >= available_from_time)
);

create index logistics_capacities_available_window_idx
  on system.logistics_capacities
    (availability_status, available_from_time, available_until_time, recorded_at desc);
create index logistics_capacities_location_service_idx
  on system.logistics_capacities (current_zone, resource_kind, recorded_at desc);
create index logistics_capacities_vehicle_observation_idx
  on system.logistics_capacities (adapter_id, external_resource_id, occurred_at desc);
create index logistics_capacities_tenant_window_idx
  on system.logistics_capacities (tenant_id, availability_status, available_from_time, recorded_at desc);

-- Each row is an immutable proposal or status transition. A stable match_id
-- groups the rows in one lifecycle; match_event_id identifies one transition.
create table system.logistics_matches (
  match_event_id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  tenant_id uuid not null,
  request_id uuid not null
    ,
  capacity_id uuid not null
    ,
  status text not null check (status in (
    'proposed', 'accepted', 'rejected', 'cancelled', 'expired'
  )),
  matched_at timestamptz not null,
  matching_rule_version text not null
    check (length(btrim(matching_rule_version)) between 1 and 80),
  match_score numeric(8, 7) check (match_score is null or match_score between 0 and 1),
  reason_code text,
  evidence_refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence_refs) = 'array'),
  idempotency_key text not null unique
    check (length(btrim(idempotency_key)) between 1 and 240),
  occurred_at timestamptz not null,
  effective_at timestamptz not null,
  received_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  actor_id text,
  source_channel text not null default 'matching_engine'
    check (length(btrim(source_channel)) between 1 and 120),
  foreign key (request_id, tenant_id)
    references system.logistics_requests(request_id, tenant_id) on delete restrict,
  foreign key (capacity_id, tenant_id)
    references system.logistics_capacities(capacity_id, tenant_id) on delete restrict
);

create index logistics_matches_current_state_idx
  on system.logistics_matches (match_id, recorded_at desc, match_event_id desc);
create index logistics_matches_request_idx
  on system.logistics_matches (request_id, matched_at desc);
create index logistics_matches_capacity_idx
  on system.logistics_matches (capacity_id, matched_at desc);
create index logistics_matches_tenant_idx
  on system.logistics_matches (tenant_id, match_id, recorded_at desc);

create or replace view system.logistics_match_current
with (security_invoker = true)
as
select distinct on (m.match_id)
  m.match_id,
  m.request_id,
  m.capacity_id,
  m.status,
  m.matched_at,
  m.matching_rule_version,
  m.match_score,
  m.reason_code,
  m.occurred_at,
  m.received_at,
  m.recorded_at,
  m.actor_id,
  m.source_channel,
  m.match_event_id
from system.logistics_matches m
order by m.match_id, m.recorded_at desc, m.match_event_id desc;

alter table system.logistics_requests enable row level security;
alter table system.logistics_capacities enable row level security;
alter table system.logistics_matches enable row level security;
-- Direct browser access remains denied. service_role has BYPASSRLS in Supabase,
-- so tenant enforcement for that role must be performed at the authenticated
-- ingestion/API boundary; composite FKs above prevent cross-tenant match links.
revoke all on system.logistics_requests from public, anon, authenticated;
revoke all on system.logistics_capacities from public, anon, authenticated;
revoke all on system.logistics_matches from public, anon, authenticated;
grant select, insert on system.logistics_requests to service_role;
grant select, insert on system.logistics_capacities to service_role;
grant select, insert on system.logistics_matches to service_role;
revoke update, delete, truncate on system.logistics_requests from service_role;
revoke update, delete, truncate on system.logistics_capacities from service_role;
revoke update, delete, truncate on system.logistics_matches from service_role;
revoke all on system.logistics_match_current from public, anon, authenticated;
grant select on system.logistics_match_current to service_role;

comment on table system.logistics_requests is
  'Adapter-scoped transport request facts only; retailer ERP remains authoritative for the order and customer record.';
comment on table system.logistics_capacities is
  'Append-only carrier, rail, or parcel-resource availability snapshots; the source provider remains authoritative.';
comment on table system.logistics_matches is
  'Append-only match proposals and status transitions; match_id groups lifecycle events and match_event_id identifies each immutable event.';
comment on view system.logistics_match_current is
  'Latest append-only status event per stable match_id.';

commit;
