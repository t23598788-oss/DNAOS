-- Dev Loop Pipeline: file-watch → evidence → impact → proposed patch → gate (owner, 2026-08-05).
-- The small working loop requested: every local file edit gets a session,
-- an evidence event (hash + diff summary), an impact-analyzer verdict, and
-- — only if the analyzer decides registry/module-registry.json needs an
-- update — a PROPOSED patch row. Nothing here ever writes module-registry.json
-- directly; scripts/sync-registry.ts remains the only writer of that file.
-- Same family as file_existence_registry/file_snapshots (20260804000007) —
-- reuses their session_id convention (text, not a users table FK, since a
-- "session" here is a local dev-loop run, not an authenticated user).

create table if not exists public.dev_loop_sessions (
  id text primary key, -- e.g. "watch-2026-08-05T12:00:00Z"
  owner text,
  goal text,
  file_scope jsonb not null default '[]'::jsonb, -- glob patterns this session is allowed to touch
  status text not null default 'open' check (status in ('open', 'closed')),
  started_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.dev_loop_evidence_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.dev_loop_sessions(id),
  path text not null,
  event_type text not null check (event_type in ('add', 'change', 'unlink')),
  content_hash text,
  diff_summary text,
  occurred_at timestamptz not null default now()
);

create table if not exists public.dev_loop_check_results (
  id uuid primary key default gen_random_uuid(),
  evidence_event_id uuid not null references public.dev_loop_evidence_events(id),
  session_id text not null references public.dev_loop_sessions(id),
  path text not null,
  result text not null check (result in ('pass', 'warning', 'fail')),
  reason text not null,
  dependents jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);

create table if not exists public.dev_loop_registry_proposals (
  id uuid primary key default gen_random_uuid(),
  check_result_id uuid not null references public.dev_loop_check_results(id),
  session_id text not null references public.dev_loop_sessions(id),
  target_registry text not null default 'registry/module-registry.json',
  path text not null,
  patch jsonb not null, -- the proposed module-registry.json entry, never applied automatically
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);

alter table public.dev_loop_sessions enable row level security;
alter table public.dev_loop_evidence_events enable row level security;
alter table public.dev_loop_check_results enable row level security;
alter table public.dev_loop_registry_proposals enable row level security;

-- Reads only, for the /admin/dev-loop Realtime dashboard (already behind
-- requireAuth(ADMIN_TIER) at the route/page level — see middleware.ts's
-- PROTECTED_PAGE_PREFIXES). Every write (approve/reject) still goes through
-- app/api/admin/dev-loop/approve/route.ts using the service-role key, never
-- directly from the browser.
create policy "authenticated can read dev_loop_sessions" on public.dev_loop_sessions for select to authenticated using (true);
create policy "authenticated can read dev_loop_evidence_events" on public.dev_loop_evidence_events for select to authenticated using (true);
create policy "authenticated can read dev_loop_check_results" on public.dev_loop_check_results for select to authenticated using (true);
create policy "authenticated can read dev_loop_registry_proposals" on public.dev_loop_registry_proposals for select to authenticated using (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dev_loop_evidence_events') then
    alter publication supabase_realtime add table public.dev_loop_evidence_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dev_loop_check_results') then
    alter publication supabase_realtime add table public.dev_loop_check_results;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dev_loop_registry_proposals') then
    alter publication supabase_realtime add table public.dev_loop_registry_proposals;
  end if;
end
$$;

comment on table public.dev_loop_sessions is 'One row per local dev-loop run (npm run watch). Service-role only.';
comment on table public.dev_loop_evidence_events is 'Raw evidence: every file add/change/unlink seen by the watcher, with hash + diff summary.';
comment on table public.dev_loop_check_results is 'Impact Analyzer verdict per evidence event — pass/warning/fail, never fabricated, always tied to a real evidence row.';
comment on table public.dev_loop_registry_proposals is 'PROPOSED registry patches only — approval required (dev_loop_registry_proposals.status), never auto-applied to module-registry.json.';
