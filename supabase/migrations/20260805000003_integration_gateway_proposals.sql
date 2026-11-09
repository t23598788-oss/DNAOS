-- Integration Gateway — Proposal Channel (owner, 2026-08-05).
-- Opens the second of 3 channels (Observe -> Propose -> Execute). A proposal
-- is a real GatewayEvent (channel='propose') that requests a specific,
-- whitelisted effect — today, running one of the same Automation commands
-- already real in app/api/admin/workspace/automation/route.ts — but never
-- runs it. Only POST /api/gateway/proposals/[id]/decide with an Owner
-- session can flip status to 'approved' and trigger the real run, reusing
-- the exact same exec path (engines/integration-gateway/automationCommands.ts)
-- the direct-run Automation tool already uses. No Execution Channel exists
-- yet — approval here is the ONLY path to a real run, and only for the
-- commands already whitelisted there.

create table if not exists public.integration_gateway_proposals (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  provider text not null check (provider in ('github', 'supabase', 'vercel', 'vscode', 'chatgpt-mcp')),
  capability text not null,
  requested_effect text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'failed')),
  proposed_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  run_result jsonb
);

create index if not exists integration_gateway_proposals_status_idx on public.integration_gateway_proposals (status, proposed_at desc);

alter table public.integration_gateway_proposals enable row level security;

create policy "authenticated can read integration_gateway_proposals" on public.integration_gateway_proposals for select to authenticated using (true);

do $$
begin
  -- add to realtime only when the publication exists (Supabase); plain Postgres skips
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'integration_gateway_proposals'
  ) then
    alter publication supabase_realtime add table public.integration_gateway_proposals;
  end if;
end
$$;

comment on table public.integration_gateway_proposals is 'Integration Gateway Proposal Channel — pending run requests for whitelisted Automation commands. service-role writes proposal + decision, authenticated reads. Approval is the only path to a real run; no Execution Channel exists yet.';
