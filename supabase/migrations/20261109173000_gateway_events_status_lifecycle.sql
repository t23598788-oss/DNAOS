-- Integration Gateway — event lifecycle columns (FIX 1).
--
-- The workers were written against `integration_gateway_events.status` and
-- `integration_gateway_events.updated_at`, but no migration ever created either
-- column. PostgREST therefore rejected every worker read/write on this table:
--
--   order-translator.ts:106  .eq("status", "received")          -> 42703
--   order-translator.ts:168  .update({ status, updated_at })    -> 42703
--   reconciler.ts:80,144     .eq("status", "received")          -> 42703
--   reconciler.ts:142,183    .update({ status, updated_at })    -> 42703
--
-- Adding the columns is the smaller change than rewriting both workers, and it
-- restores the intent the workers already encode: an event starts 'received'
-- and is advanced to 'processed' / 'unmatched' by the reconcile phase.

alter table public.integration_gateway_events
  add column if not exists status text not null default 'received';

alter table public.integration_gateway_events
  add column if not exists updated_at timestamptz not null default now();

-- The workers select on (provider, capability, channel, status) for every run.
create index if not exists idx_integration_gateway_events_status
  on public.integration_gateway_events (status);
