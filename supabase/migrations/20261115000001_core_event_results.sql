-- Core Event Execution results (additive migration; applied to Supabase Production
-- project xeytcavxejhyzxwevgto on 2026-11-15).
-- The shared queue envelope is provider-neutral; ai_tasks is intentionally not
-- reused because its required line_user_id and task kinds belong to existing
-- product-specific workflows.
create table if not exists public.core_event_results (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  idempotency_key text not null unique,
  source text not null,
  event_type text not null,
  capability_id text not null,
  tenant_id text,
  actor_type text not null check (actor_type in ('provider', 'user', 'system', 'driver')),
  actor_id text,
  status text not null check (status in ('processing', 'succeeded', 'failed')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  lease_until timestamptz,
  result jsonb,
  provider text,
  model text,
  error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists core_event_results_status_created_idx
  on public.core_event_results (status, created_at);
create index if not exists core_event_results_tenant_created_idx
  on public.core_event_results (tenant_id, created_at desc);

alter table public.core_event_results enable row level security;
drop policy if exists service_role_only on public.core_event_results;
create policy service_role_only on public.core_event_results
  for all using (false) with check (false);

comment on table public.core_event_results is
  'Idempotent result ledger for provider-neutral core event execution. Stores normalized output and execution evidence, not raw provider payloads.';
