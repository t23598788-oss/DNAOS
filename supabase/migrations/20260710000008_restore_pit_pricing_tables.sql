-- pit_profiles / pit_materials / vehicle_types were found DROPPED from the
-- live database 2026-07-10 (root cause unconfirmed — likely an external
-- `prisma db push` targeting this same database from a different Prisma
-- schema, since ~30 unrelated e-commerce/logistics tables appeared at the
-- same time and no supabase/migrations/*.sql in this repo ever dropped
-- them). Recreating with the exact schema recovered from the last local
-- backup (backups/2026-07-05_0502/) so engines/distance.ts, engines/cost.ts,
-- engines/fuel.ts (the real pricing engines) work again. Data reload is a
-- separate step (scripts, not SQL — JSON payload too large for one file).

create table if not exists public.pit_profiles (
  id                        uuid primary key,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  user_id                   uuid,
  owner_type                text,
  pit_name                  text not null,
  contact_name              text,
  phone                     text,
  address                   text,
  latitude                  numeric,
  longitude                 numeric,
  is_open                   boolean not null default true,
  large_vehicle_accessible  boolean not null default false,
  sub_district_id           uuid,
  district_id               uuid,
  province_id               uuid,
  zip_code                  text,
  entity_type               text,
  registered_name           text,
  taxpayer_id               text,
  bank_account_number       text,
  bank_name                 text,
  place_name                text,
  formatted_address         text,
  geom                      geometry(Point, 4326),
  line_user_id              text
);

create table if not exists public.pit_materials (
  id                 uuid primary key,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  pit_profile_id     uuid not null references public.pit_profiles(id),
  material_type_id   uuid not null references public.material_types(id),
  price              numeric not null
);

create table if not exists public.vehicle_types (
  id                     uuid primary key,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  name                   text not null,
  load_capacity          numeric,
  fuel_consumption_rate  numeric
);

create index if not exists pit_profiles_deleted_at_idx on public.pit_profiles (deleted_at);
create index if not exists pit_materials_pit_profile_id_idx on public.pit_materials (pit_profile_id);
create index if not exists pit_materials_material_type_id_idx on public.pit_materials (material_type_id);

alter table public.pit_profiles enable row level security;
alter table public.pit_materials enable row level security;
alter table public.vehicle_types enable row level security;

drop policy if exists service_role_only on public.pit_profiles;
create policy service_role_only on public.pit_profiles for all using (false);
drop policy if exists service_role_only on public.pit_materials;
create policy service_role_only on public.pit_materials for all using (false);
drop policy if exists service_role_only on public.vehicle_types;
create policy service_role_only on public.vehicle_types for all using (false);
