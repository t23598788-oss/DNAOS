-- Add Kod Chat to the explicit Integration Gateway provider allow-lists.
-- Applied to Supabase Production project xeytcavxejhyzxwevgto on 2026-11-15.
-- This changes no table shape and rewrites no existing rows.

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.integration_gateway_events'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_gateway_events drop constraint %I', c);
  end loop;
end $$;

alter table public.integration_gateway_events
  add constraint integration_gateway_events_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line', 'facebook', 'instagram', 'kbank', 'telegram', 'whatsapp', 'kodchat'));

do $$
declare
  c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.integration_gateway_proposals'::regclass
      and contype = 'c' and pg_get_constraintdef(oid) ilike '%provider%'
  loop
    execute format('alter table public.integration_gateway_proposals drop constraint %I', c);
  end loop;
end $$;

alter table public.integration_gateway_proposals
  add constraint integration_gateway_proposals_provider_check
  check (provider in ('github', 'supabase', 'vercel', 'railway', 'vscode', 'chatgpt-mcp', 'line', 'facebook', 'instagram', 'kbank', 'telegram', 'whatsapp', 'kodchat'));

comment on constraint integration_gateway_events_provider_check on public.integration_gateway_events is
  'Explicit provider allow-list for Integration Gateway events; includes Kod Chat after migration 20261115030000.';
