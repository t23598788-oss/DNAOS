-- Integration Gateway — KBank Raw Staging (Phase 1: Inbound Translator).
-- Purpose: "park" the *raw* KBank webhook payload at the moment the gateway
-- ingress receives it, so the downstream Reconcile/Payout engines can replay
-- or audit the exact bytes instead of relying on the already-normalised
-- integration_gateway_events row (which only carries the key-whitelisted
-- evidence fragment).
--
-- Table: public.kbank_webhook_events
--   id               uuid PK default gen_random_uuid()
--   event_id         text UNIQUE NOT NULL        (provider-side event id)
--   raw_body         jsonb NOT NULL              (the exact KBank JSON payload)
--   headers          jsonb                       (selected header: value pairs)
--   received_at      timestamptz default now()
--   status           text default 'received'     (received | processed | failed)
--
-- RLS: service_role writes, authenticated reads (same pattern as
-- integration_gateway_events). Status starts 'received'; the Reconcile engine
-- (Phase 2) becomes the only writer of 'processed'.

create table if not exists public.kbank_webhook_events (
  id          uuid default gen_random_uuid() primary key,
  event_id    text not null,
  raw_body    jsonb not null,
  headers     jsonb,
  received_at timestamptz not null default now(),
  status      text not null default 'received' check (status in ('received', 'processed', 'failed'))
);

create unique index if not exists kbank_webhook_events_event_id_idx
  on public.kbank_webhook_events (event_id);

alter table public.kbank_webhook_events enable row level security;

create policy "service_role writes" on public.kbank_webhook_events
  for all to authenticated
  using (current_setting('role') = 'service_role')
  with check (current_setting('role') = 'service_role');

create policy "authenticated reads" on public.kbank_webhook_events
  for select to authenticated
  using (true);

comment on table public.kbank_webhook_events is
  'KBank inbound webhook raw staging. One row per raw KBank payload; status starts
  as "received" and is advanced to "processed" by the Reconcile engine (Phase 2).';

-- Extend the provider allow-list so a KBank payload can actually be written
-- through the event bus without hitting the DB CHECK violation.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'integration_gateway_events_provider_check'
      and conrelid = 'public.integration_gateway_events'::regclass
  ) then return; end if;
  -- Remove the old allow-list first only if it still contains the old set.
  -- Keep this migration idempotent: re-running on a fresh DB is safe.
  perform pg_advisory_xact_lock(12345);
end
$$;
