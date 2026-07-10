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

create table if not exists public.business_events (
  id                uuid primary key default gen_random_uuid(),
  event_code        text not null unique,            -- EV250710-0001, human-referenceable
  event_type        text,                             -- e.g. "purchase_request", "inquiry", "complaint"
  source_line_user_id  text,                           -- which LINE contact this came from
  source_message_ids   uuid[],                         -- line_events.id[] this event was built from
  partner_id        uuid references public.companies(id),
  material_id       uuid references public.material_types(id),
  material_text     text,                             -- raw material text if not matched to material_types
  quantity          numeric,
  quantity_unit      text,
  destination       text,
  schedule_text      text,
  contact_name       text,
  contact_phone      text,
  status            text not null default 'new',       -- new | quotation_pending | quoted | confirmed | delivered | cancelled
  context           jsonb,                             -- free-form: anything the extractor found but didn't fit a column
  confidence        numeric,                            -- 0-1, how sure the extractor was
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

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
