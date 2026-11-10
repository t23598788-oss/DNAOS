-- trucks, trips, inventory — Phase 1 of delivery tracking.
-- Created 2026-11-03.

-- ==========================================================
-- Table 1: trucks (individual vehicles, not types)
-- ==========================================================
create table if not exists public.trucks (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid references public.companies(id) on delete set null,
  vehicle_type_id     uuid references public.vehicle_types(id) on delete set null,
  license_plate       text not null,
  driver_name         text,
  driver_phone        text,
  driver_line_id      text,
  capacity_tons       numeric(6,2),
  current_status      text not null default 'available'
                      check (current_status in ('available','in_use','maintenance','offline')),
  current_lat         numeric(10,7),
  current_lng         numeric(10,7),
  location_updated_at timestamptz,
  busy_until          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint trucks_plate_unique unique (license_plate)
);

create index if not exists trucks_status_idx on public.trucks (current_status) where current_status = 'available';
create index if not exists trucks_partner_idx on public.trucks (partner_id) where partner_id is not null;
create index if not exists trucks_line_idx on public.trucks (driver_line_id) where driver_line_id is not null;

create or replace function public.touch_trucks_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_trucks_touch on public.trucks;
create trigger trg_trucks_touch before update on public.trucks
  for each row execute function public.touch_trucks_updated_at();

alter table public.trucks enable row level security;
drop policy if exists trucks_service on public.trucks;
create policy trucks_service on public.trucks for all to service_role using (true) with check (true);
drop policy if exists trucks_read on public.trucks;
create policy trucks_read on public.trucks for select to authenticated using (true);

-- ==========================================================
-- Table 2: trips (per-delivery, with planned and actual timing)
-- ==========================================================
create table if not exists public.trips (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid references public.jobs(id) on delete set null,
  truck_id              uuid references public.trucks(id) on delete set null,
  pit_profile_id        uuid references public.pit_profiles(id) on delete set null,

  origin_lat            numeric(10,7),
  origin_lng            numeric(10,7),
  dest_lat              numeric(10,7),
  dest_lng              numeric(10,7),

  distance_km           numeric(8,2),
  material_quantity     numeric(10,2),
  material_unit         text default 'CUBIC' check (material_unit in ('CUBIC','TON')),

  dispatch_at           timestamptz,
  planned_loading_min   int check (planned_loading_min is null or planned_loading_min >= 0),
  planned_transit_min   int check (planned_transit_min is null or planned_transit_min >= 0),
  planned_arrival_at    timestamptz,
  actual_loading_min    int check (actual_loading_min is null or actual_loading_min >= 0),
  actual_transit_min    int check (actual_transit_min is null or actual_transit_min >= 0),
  actual_arrival_at     timestamptz,

  status                text not null default 'scheduled'
                        check (status in ('scheduled','loading','in_transit','arrived','delivered','failed')),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists trips_job_idx on public.trips (job_id) where job_id is not null;
create index if not exists trips_truck_idx on public.trips (truck_id, status) where truck_id is not null;
create index if not exists trips_status_idx on public.trips (status, planned_arrival_at) where planned_arrival_at is not null;

create or replace function public.touch_trips_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_trips_touch on public.trips;
create trigger trg_trips_touch before update on public.trips
  for each row execute function public.touch_trips_updated_at();

-- Status may only move forward; scheduled → loading → in_transit → arrived → delivered
-- Any step may fail. delivered is terminal.
create or replace function public.trips_status_forward()
returns trigger language plpgsql as $$
declare allowed boolean;
begin
  if new.status = old.status then return new; end if;
  if old.status = 'delivered' then
    raise exception 'TRIP_STATUS_TERMINAL: delivered -> % is not allowed', new.status using errcode = 'P0001';
  end if;
  allowed := (old.status = 'scheduled' and new.status in ('loading','failed'))
          or (old.status = 'loading' and new.status in ('in_transit','failed'))
          or (old.status = 'in_transit' and new.status in ('arrived','failed'))
          or (old.status = 'arrived' and new.status = 'delivered');
  if not allowed then
    raise exception 'TRIP_STATUS_ILLEGAL: % -> %', old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_trips_status on public.trips;
create trigger trg_trips_status before update on public.trips
  for each row execute function public.trips_status_forward();

alter table public.trips enable row level security;
drop policy if exists trips_service on public.trips;
create policy trips_service on public.trips for all to service_role using (true) with check (true);
drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips for select to authenticated using (true);

-- ==========================================================
-- Table 3: inventory (partner stock per material per pit)
-- ==========================================================
create table if not exists public.inventory (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid references public.companies(id) on delete cascade,
  pit_profile_id      uuid references public.pit_profiles(id) on delete cascade,
  material_type_id    uuid references public.material_types(id) on delete restrict,
  quantity_available  numeric(12,2) not null default 0 check (quantity_available >= 0),
  unit                text not null default 'CUBIC' check (unit in ('CUBIC','TON')),
  last_updated_at     timestamptz not null default now(),
  updated_by          text,
  constraint inventory_pit_material_unique unique (pit_profile_id, material_type_id)
);

create index if not exists inventory_pit_material_idx on public.inventory (pit_profile_id, material_type_id);
create index if not exists inventory_available_idx on public.inventory (material_type_id) where quantity_available > 0;

create or replace function public.touch_inventory_updated_at()
returns trigger language plpgsql as $$
begin new.last_updated_at = now(); return new; end $$;

drop trigger if exists trg_inventory_touch on public.inventory;
create trigger trg_inventory_touch before update on public.inventory
  for each row execute function public.touch_inventory_updated_at();

alter table public.inventory enable row level security;
drop policy if exists inventory_service on public.inventory;
create policy inventory_service on public.inventory for all to service_role using (true) with check (true);
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated using (true);
