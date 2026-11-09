-- Integration Gateway — allow the KBank provider in the event/proposal allow-lists.
--
-- Owner decision 2026-11-09: KBank connects as a webhook provider; the canonical
-- GatewayEvent shape (engines/integration-gateway/contracts/event.ts) and the
-- evidence/store.ts writer already include 'kbank' in the GatewayProvider union,
-- so the provider CHECK only needs to be extended.
--
-- The CHECK stays an explicit allow-list (same discipline as
-- public.connectors.auth_type) instead of being dropped or widened to
-- "provider <> '': the tables are written only by the service role, and an
-- unknown provider must fail loudly.
--
-- Status: NOT APPLIED. Draft for the Owner to review and run
-- (supabase db push / migration apply). No capability in this repo applies
-- migrations on its own.

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.integration_gateway_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_gateway_events drop constraint %I', c);
  end loop;
end
$$;

alter table public.integration_gateway_events
  add constraint integration_gateway_events_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line', 'facebook', 'instagram', 'kbank'));

comment on constraint integration_gateway_events_provider_check on public.integration_gateway_events is
  'Explicit provider allow-list for integration_gateway_events. Extend one line per new provider — see supabase/migrations/20261026000003_gateway_allow_kbank_provider.sql.';

do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.integration_gateway_proposals'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_gateway_proposals drop constraint %I', c);
  end loop;
end
$$;

alter table public.integration_gateway_proposals
  add constraint integration_gateway_proposals_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line', 'facebook', 'instagram', 'kbank'));

comment on constraint integration_gateway_proposals_provider_check on public.integration_gateway_proposals is
  'Explicit provider allow-list for integration_gateway_proposals. Extend one line per new provider — see supabase/migrations/20261026000003_gateway_allow_kbank_provider.sql.';
