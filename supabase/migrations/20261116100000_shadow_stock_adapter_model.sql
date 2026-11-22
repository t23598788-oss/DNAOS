-- DNA OS Shadow Stock model, inspired by the structural fields in ERPNext
-- Item, Warehouse, Stock Ledger Entry, and Bin DocTypes.
--
-- Applied to Supabase project xeytcavxejhyzxwevgto on 2026-11-16 and recorded
-- in Supabase migration history as 20261116100000. Do not replay manually.
-- It stores normalized source observations, not ERPNext business records and
-- not authoritative stock. No ERPNext Python/business logic is copied.
-- adapter_id is an opaque UUID for system.system_adapters; the cross-schema
-- association is validated by the application layer.
--
-- Existing public.inventory, facility_inventory, stock_movements,
-- facility_stock_movements, material_masters, and system.inferred_inventory_states
-- are intentionally left unchanged. These tables create an adapter-scoped
-- shadow projection so source identities and observations are not merged into
-- the legacy business tables by this migration.

begin;

create table public.stock_shadow_items (
  shadow_item_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  external_item_code text not null
    check (length(btrim(external_item_code)) between 1 and 240),
  item_name text not null
    check (length(btrim(item_name)) between 1 and 300),
  stock_uom text not null
    check (length(btrim(stock_uom)) between 1 and 40),
  is_stock_item boolean not null default true,
  is_disabled boolean not null default false,
  source_updated_at timestamptz,
  observed_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, external_item_code),
  unique (shadow_item_id, adapter_id)
);

create index stock_shadow_items_adapter_name_idx
  on public.stock_shadow_items (adapter_id, item_name);

create table public.stock_shadow_locations (
  shadow_location_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  external_warehouse_key text not null
    check (length(btrim(external_warehouse_key)) between 1 and 240),
  warehouse_name text not null
    check (length(btrim(warehouse_name)) between 1 and 300),
  parent_location_id uuid,
  is_group boolean not null default false,
  latitude numeric(9, 6) check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude is null or longitude between -180 and 180),
  source_updated_at timestamptz,
  observed_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, external_warehouse_key),
  unique (shadow_location_id, adapter_id),
  constraint stock_shadow_locations_parent_same_adapter_fk
    foreign key (parent_location_id, adapter_id)
    references public.stock_shadow_locations (shadow_location_id, adapter_id)
    on update restrict on delete restrict,
  constraint stock_shadow_locations_not_own_parent_ck
    check (parent_location_id is null or parent_location_id <> shadow_location_id),
  constraint stock_shadow_locations_coordinates_pair_ck
    check ((latitude is null) = (longitude is null))
);

create index stock_shadow_locations_adapter_parent_idx
  on public.stock_shadow_locations (adapter_id, parent_location_id);

-- Normalized, append-only counterpart to ERPNext Stock Ledger Entry.
create table public.stock_shadow_movements (
  shadow_movement_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 240),
  external_entry_key text not null
    check (length(btrim(external_entry_key)) between 1 and 240),
  shadow_item_id uuid not null,
  shadow_location_id uuid not null,
  quantity_delta numeric(24, 8) not null,
  quantity_after_transaction numeric(24, 8),
  stock_uom text not null
    check (length(btrim(stock_uom)) between 1 and 40),
  is_cancelled boolean not null default false,
  source_document_type text,
  source_document_key text,
  source_event_id uuid,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, idempotency_key),
  unique (adapter_id, external_entry_key),
  constraint stock_shadow_movements_item_adapter_fk
    foreign key (shadow_item_id, adapter_id)
    references public.stock_shadow_items (shadow_item_id, adapter_id)
    on update restrict on delete restrict,
  constraint stock_shadow_movements_location_adapter_fk
    foreign key (shadow_location_id, adapter_id)
    references public.stock_shadow_locations (shadow_location_id, adapter_id)
    on update restrict on delete restrict
);

create index stock_shadow_movements_item_time_idx
  on public.stock_shadow_movements (adapter_id, shadow_item_id, occurred_at desc);
create index stock_shadow_movements_location_time_idx
  on public.stock_shadow_movements (adapter_id, shadow_location_id, occurred_at desc);
create index stock_shadow_movements_source_event_idx
  on public.stock_shadow_movements (source_event_id)
  where source_event_id is not null;

-- Normalized, append-only counterpart to ERPNext Bin. A row is a point-in-time
-- observation; current stock is derived by selecting the latest observation.
create table public.stock_shadow_balance_observations (
  balance_observation_id uuid primary key default gen_random_uuid(),
  adapter_id uuid not null,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 240),
  shadow_item_id uuid not null,
  shadow_location_id uuid not null,
  actual_qty numeric(24, 8) not null,
  stock_uom text not null
    check (length(btrim(stock_uom)) between 1 and 40),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  source_event_id uuid,
  source_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_metadata) = 'object'),
  unique (adapter_id, idempotency_key),
  constraint stock_shadow_balance_item_adapter_fk
    foreign key (shadow_item_id, adapter_id)
    references public.stock_shadow_items (shadow_item_id, adapter_id)
    on update restrict on delete restrict,
  constraint stock_shadow_balance_location_adapter_fk
    foreign key (shadow_location_id, adapter_id)
    references public.stock_shadow_locations (shadow_location_id, adapter_id)
    on update restrict on delete restrict
);

create index stock_shadow_balance_latest_idx
  on public.stock_shadow_balance_observations
    (adapter_id, shadow_item_id, shadow_location_id, observed_at desc);

alter table public.stock_shadow_items enable row level security;
alter table public.stock_shadow_locations enable row level security;
alter table public.stock_shadow_movements enable row level security;
alter table public.stock_shadow_balance_observations enable row level security;

revoke all on public.stock_shadow_items from public, anon, authenticated;
revoke all on public.stock_shadow_locations from public, anon, authenticated;
revoke all on public.stock_shadow_movements from public, anon, authenticated;
revoke all on public.stock_shadow_balance_observations from public, anon, authenticated;

-- Service-side ingestion can read and append observations. It cannot overwrite
-- or delete a movement/balance observation through its granted table rights.
grant select, insert, update on public.stock_shadow_items to service_role;
grant select, insert, update on public.stock_shadow_locations to service_role;
grant select, insert on public.stock_shadow_movements to service_role;
grant select, insert on public.stock_shadow_balance_observations to service_role;

comment on table public.stock_shadow_items is
  'Adapter-scoped external item identity and minimal descriptive fields; not the canonical DNA OS material/product master.';
comment on table public.stock_shadow_locations is
  'Adapter-scoped external warehouse identity and optional hierarchy/coordinates.';
comment on table public.stock_shadow_movements is
  'Append-only normalized stock-movement observations modeled on Stock Ledger Entry fields; not an authoritative ledger.';
comment on table public.stock_shadow_balance_observations is
  'Append-only point-in-time actual quantity observations modeled on Bin; latest row is the shadow balance.';
comment on column public.stock_shadow_items.adapter_id is
  'Opaque UUID corresponding to system.system_adapters.adapter_id; validated at the application boundary.';
comment on column public.stock_shadow_movements.source_event_id is
  'Opaque reference to system.event_stream.event_id; cross-schema relation is resolved by the application boundary.';

commit;
