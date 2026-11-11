-- Integration Gateway — allow Telegram + WhatsApp Business in the event/proposal allow-lists.
--
-- Owner channel-expansion 2026-11-11: Telegram and WhatsApp Business join the
-- same Observe Gateway as LINE / Meta. The adapters
-- (engines/integration-gateway/adapters/telegram.ts, whatsapp.ts) construct the
-- canonical GatewayEvent with provider 'telegram' / 'whatsapp', so the explicit
-- provider CHECK must know those values before the first real webhook can be
-- stored. Same discipline as 20261026000003_gateway_allow_kbank_provider.sql:
-- the CHECK stays an explicit allow-list (never dropped, never widened to any
-- text), and an unknown provider still fails loudly.
--
-- Additive only: two new enum-like values in one CHECK constraint. No table or
-- column change, no data rewrite, no backfill.
--
-- Status: APPLIED 2026-11-11 to the linked project (supabase db query, then
-- migration repair --status applied). Verified post-apply: both constraints now
-- allow telegram/whatsapp; live rows (vscode/railway/supabase) are a subset of
-- the prior allow-list, so no row had to change. No table/column/data rewrite.

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
  check (provider in (
    'github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp',
    'line', 'facebook', 'instagram', 'kbank', 'telegram', 'whatsapp'
  ));

comment on constraint integration_gateway_events_provider_check on public.integration_gateway_events is
  'Explicit provider allow-list for integration_gateway_events. Extend one line per new provider — see supabase/migrations/20261111100000_gateway_allow_messaging_providers.sql.';

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
  check (provider in (
    'github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp',
    'line', 'facebook', 'instagram', 'kbank', 'telegram', 'whatsapp'
  ));

comment on constraint integration_gateway_proposals_provider_check on public.integration_gateway_proposals is
  'Explicit provider allow-list for integration_gateway_proposals. Extend one line per new provider — see supabase/migrations/20261111100000_gateway_allow_messaging_providers.sql.';
