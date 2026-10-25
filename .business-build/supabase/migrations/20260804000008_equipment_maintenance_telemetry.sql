-- Equipment GPS/Relay Permission System — Telemetry + Engine-Hours +
-- Maintenance Ticket schema (owner spec 2026-07-24, implemented 2026-08-04
-- per docs/equipment-maintenance-lock-module.md's PLANNED rows). Extends
-- migration 20260724000004_equipment_gps_permissions.sql — does not
-- duplicate equipment_assets / driver_equipment_permissions (Rule 103).
--
-- Design notes:
-- 1. equipment_telemetry_pings stores every raw ping (engine-running signal
--    + timestamp) so engine-hours accumulation can compute a real
--    time-delta between consecutive "engine running" pings for the same
--    asset, instead of a naive increment-per-ping (see
--    engines/equipment/engine-hours.ts for the MAX_GAP_HOURS reasoning).
-- 2. equipment_assets.last_ticket_trigger_hours tracks the engine-hours
--    value at which the most recently OPENED maintenance ticket's 250h
--    boundary was crossed — lets the cron engine know the next boundary to
--    watch for without re-scanning ticket history every run.
-- 3. maintenance_tickets.trigger_hours is the 250h-multiple boundary that
--    opened this ticket (250, 500, 750, ...). overdue_locked_at records
--    when the +50h-overdue auto-lock actually fired for this ticket (Rule
--    72 — this is a system-initiated SAFETY lock, not a human-gated
--    unlock/start action; see docs/equipment-maintenance-lock-module.md).

alter table public.equipment_assets
  add column if not exists last_ticket_trigger_hours numeric not null default 0;

create table if not exists public.equipment_telemetry_pings (
  id             uuid primary key default gen_random_uuid(),
  equipment_id   uuid not null references public.equipment_assets(id) on delete cascade,
  recorded_at    timestamptz not null,
  engine_running boolean not null,          -- derived from VCC >= 13.5V at ingestion time
  vcc_voltage    numeric,                   -- raw voltage reading, if the provider sends one
  raw_payload    jsonb,                     -- full inbound body, for provider-format forensics
  created_at     timestamptz not null default now()
);

create index if not exists equipment_telemetry_pings_equipment_recorded_idx
  on public.equipment_telemetry_pings (equipment_id, recorded_at desc);

alter table public.equipment_telemetry_pings enable row level security;
drop policy if exists service_role_only on public.equipment_telemetry_pings;
create policy service_role_only on public.equipment_telemetry_pings for all using (false);

create table if not exists public.maintenance_tickets (
  id                 uuid primary key default gen_random_uuid(),
  equipment_id       uuid not null references public.equipment_assets(id) on delete cascade,
  trigger_hours      numeric not null,       -- the 250h-multiple boundary that opened this ticket
  status             text not null default 'open' check (status in ('open', 'closed')),
  opened_at          timestamptz not null default now(),
  closed_at          timestamptz,
  closed_by          text,                   -- admin session/note, human-confirmed close (Rule 72)
  overdue_locked     boolean not null default false,
  overdue_locked_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (equipment_id, trigger_hours)
);

create index if not exists maintenance_tickets_equipment_status_idx
  on public.maintenance_tickets (equipment_id, status);

alter table public.maintenance_tickets enable row level security;
drop policy if exists service_role_only on public.maintenance_tickets;
create policy service_role_only on public.maintenance_tickets for all using (false);
