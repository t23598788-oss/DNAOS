-- Reconciliation: yesterday's business_events (20260710000001) was built
-- without checking for a pre-existing design. 20260705000001_business_events_partner_timeline.sql
-- already defined business_events with the shape engines/partner/timeline.ts
-- (buildPartnerTimeline/buildPartnerSummary — real, already-written code)
-- expects: event_date, title, description, metadata. That migration was
-- never applied (table didn't exist until yesterday), so no data conflict —
-- just add the missing columns so the same table satisfies both the LINE
-- Event Builder's fields AND the existing timeline engine's contract,
-- instead of maintaining two shapes.

alter table public.business_events add column if not exists event_date date;
alter table public.business_events add column if not exists title text;
alter table public.business_events add column if not exists description text;
alter table public.business_events add column if not exists metadata jsonb not null default '{}';
alter table public.business_events add column if not exists transaction_id uuid;

-- Backfill the one test event created yesterday so it satisfies the new columns too.
update public.business_events
set
  event_date = coalesce(event_date, created_at::date),
  title = coalesce(title, material_text || ' ' || coalesce(quantity::text, '') || coalesce(' ' || quantity_unit, '')),
  description = coalesce(description, 'destination: ' || coalesce(destination, '-') || ', schedule: ' || coalesce(schedule_text, '-'))
where event_date is null;

create index if not exists business_events_event_date_idx on public.business_events (event_date desc);
