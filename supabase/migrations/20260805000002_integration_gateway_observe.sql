-- Integration Gateway — Observe Channel evidence (owner, 2026-08-05).
-- Every normalized GatewayEvent (engines/integration-gateway/contracts/event.ts)
-- lands here, whichever provider/adapter produced it. Separate from
-- dev_loop_* (20260805000001) on purpose — dev_loop_* is the file-watch
-- specific pipeline built the same day; this table is the general-purpose
-- cross-provider event log the Gateway is the one and only writer of.
-- Proposal/Execution channels are NOT built yet (explicit instruction:
-- Observe first) — this table has no "approved"/"executed" columns because
-- nothing here ever requests a real effect yet (requires_owner_approval is
-- carried for forward-compatibility with the Proposal channel, not acted on).

create table if not exists public.integration_gateway_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  provider text not null check (provider in ('github', 'supabase', 'vercel', 'vscode', 'chatgpt-mcp')),
  capability text not null,
  channel text not null check (channel in ('observe', 'propose', 'execute')),
  action text not null check (action in ('observe', 'propose', 'execute')),
  session_id text,
  change_id text,
  evidence jsonb not null default '{}'::jsonb,
  requested_effect text not null default 'none',
  requires_owner_approval boolean not null default false,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index if not exists integration_gateway_events_provider_idx on public.integration_gateway_events (provider, occurred_at desc);
create index if not exists integration_gateway_events_capability_idx on public.integration_gateway_events (capability, occurred_at desc);

alter table public.integration_gateway_events enable row level security;

create policy "authenticated can read integration_gateway_events" on public.integration_gateway_events for select to authenticated using (true);

do $$
begin
  -- add to realtime only when the publication exists (Supabase); plain Postgres skips
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'integration_gateway_events'
  ) then
    alter publication supabase_realtime add table public.integration_gateway_events;
  end if;
end
$$;

comment on table public.integration_gateway_events is 'Integration Gateway Observe Channel — canonical GatewayEvent rows from every provider adapter (GitHub/Supabase/Vercel/...). Service-role writes, authenticated reads. Channel is always "observe" until Proposal/Execution are built.';
