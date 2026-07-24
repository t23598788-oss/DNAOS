-- Equipment GPS/Relay Permission System (owner spec, 2026-07-24) — schema
-- for the Fleet/Equipment Security feature (heavy equipment GPS immobilizer
-- boxes, SMS-triggered relay unlock, per-driver permission). This is a new
-- business domain, separate from the existing material-quoting/debt system.
--
-- Fixed 2 real gaps from the original spec before applying:
-- 1. No RLS/service_role_only policy — every other real table in this repo
--    has one (Rule: no shadow access path); added here too.
-- 2. driver_equipment_permissions.line_user_id was a bare varchar with no
--    real link to line_profiles despite the comment claiming one — now a
--    real foreign key (line_profiles.line_user_id IS the real primary key,
--    verified directly against the live schema before writing this).
-- Also removed box_password's weak shared default ('123456') — a per-device
-- password must be set explicitly, never silently shared across all units.

create table if not exists public.equipment_assets (
  id                  uuid primary key default gen_random_uuid(),
  asset_code          text not null unique,        -- e.g. 'KX033-01'
  name                text not null,                -- e.g. 'Kubota KX033'
  sim_number          text,                         -- IoT SIM number in the GPS box
  imei                text unique,                  -- GPS box IMEI
  box_password        text,                         -- per-device SMS command password — no shared default
  current_status      text not null default 'LOCKED' check (current_status in ('LOCKED', 'UNLOCKED', 'RUNNING')),
  total_engine_hours  numeric not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.driver_equipment_permissions (
  id             uuid primary key default gen_random_uuid(),
  line_user_id   text not null references public.line_profiles(line_user_id),
  equipment_id   uuid not null references public.equipment_assets(id) on delete cascade,
  is_active      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (line_user_id, equipment_id)
);

create index if not exists driver_equipment_permissions_line_user_id_idx
  on public.driver_equipment_permissions (line_user_id);
create index if not exists driver_equipment_permissions_equipment_id_idx
  on public.driver_equipment_permissions (equipment_id);

alter table public.equipment_assets enable row level security;
drop policy if exists service_role_only on public.equipment_assets;
create policy service_role_only on public.equipment_assets for all using (false);

alter table public.driver_equipment_permissions enable row level security;
drop policy if exists service_role_only on public.driver_equipment_permissions;
create policy service_role_only on public.driver_equipment_permissions for all using (false);
