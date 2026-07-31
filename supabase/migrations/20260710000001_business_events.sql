-- The event-centric core layer, per owner's explicit architecture direction
-- 2026-07-10: LINE messages are currently read as independent rows with no
-- shared identity. This adds business_events — one row per real business
-- event (a customer's request, synthesized from a cluster of raw LINE
-- messages) that every downstream module (pricing, GPS, quotation, debt,
-- accounting) should reference by event_code instead of re-parsing raw text.
-- Explicitly authorized by owner as an exception to Plan Lock (registry/CONSTITUTION.json)
-- because it's the architectural core, not a peripheral feature.

create table if not exists public.material_types (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  name        text not null
);

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): 20260705000001_business_events_
-- partner_timeline.sql already CREATEs a much narrower public.business_events
-- (id/partner_id/event_type/event_date/title/description/metadata) — this
-- file's CREATE TABLE IF NOT EXISTS is THIS session's real, canonical,
-- event-centric-core definition, but on a fresh local bootstrap it silently
-- no-ops if the table already exists from that earlier file, leaving out
-- every column below. Explicit ADD COLUMN IF NOT EXISTS after the CREATE
-- makes this converge to the real full schema either way — a no-op change
-- in production, where this file already ran when business_events didn't
-- exist yet there (matching every other real-app usage this whole session
-- of event_code/quoted_amount/status etc., which only this definition has).
create table if not exists public.business_events (
  id                uuid primary key default gen_random_uuid(),
  event_code        text unique,
  status            text not null default 'new',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.business_events
  add column if not exists event_code text unique,
  add column if not exists status text not null default 'new',
  add column if not exists event_type text,
  add column if not exists source_line_user_id text,
  add column if not exists source_message_ids uuid[],
  add column if not exists material_id uuid references public.material_types(id),
  add column if not exists material_text text,
  add column if not exists quantity numeric,
  add column if not exists quantity_unit text,
  add column if not exists destination text,
  add column if not exists schedule_text text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists context jsonb,
  add column if not exists confidence numeric;

-- partner_id already exists from the narrower July 5 definition (references
-- public.partners, deferred there) — this file originally wanted it to
-- reference public.companies(id) instead. Both companies and partners are
-- real distinct tables in this codebase; not resolving that discrepancy
-- here (out of scope for a bootstrap fix) — left exactly as July 5 defined
-- it, since that's what's real in production today.

create index if not exists business_events_source_line_user_id_idx on public.business_events (source_line_user_id);
create index if not exists business_events_partner_id_idx on public.business_events (partner_id);
create index if not exists business_events_status_idx on public.business_events (status);

do $$
declare
  t text;
begin
  foreach t in array array['material_types','business_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists service_role_only on public.%I', t);
    execute format('create policy service_role_only on public.%I for all using (false)', t);
  end loop;
end $$;
