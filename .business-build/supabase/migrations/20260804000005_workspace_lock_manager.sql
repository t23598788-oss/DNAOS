-- Workspace Lock Manager + Resource Migration Engine — real atomic backing.
-- Extends registry/LOCK_MANAGER.json (a JSON ledger with zero atomicity —
-- proven insufficient live 2026-08-04 when a concurrent session overwrote
-- core/shared/types.ts and 4 other registry files mid-session with no
-- conflict detection at all). This is the real enforcement layer; the JSON
-- file stays as a human-readable summary, synced from this table.

create table if not exists public.workspace_locks (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null check (resource_type in
    ('file', 'folder', 'registry', 'migration', 'config', 'database_schema')),
  resource_path text not null,
  holder_actor text not null,
  holder_session_id text not null,
  operation_id uuid not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz
);

-- The real atomicity: only one ACTIVE (released_at is null, not expired) lock
-- can exist per resource_path. Enforced by Postgres itself, not application
-- code — two concurrent INSERTs racing for the same path can only have one
-- winner, which is exactly the guarantee a JSON file can never give.
create unique index if not exists workspace_locks_active_resource_idx
  on public.workspace_locks (resource_path)
  where released_at is null;

create table if not exists public.workspace_lock_conflicts (
  id uuid primary key default gen_random_uuid(),
  resource_path text not null,
  requested_by_actor text not null,
  requested_by_session_id text not null,
  held_by_actor text not null,
  held_by_session_id text not null,
  attempted_at timestamptz not null default now(),
  resolution text not null default 'rejected' check (resolution in ('rejected', 'queued', 'retried_and_acquired'))
);

create table if not exists public.resource_migration_plans (
  id uuid primary key default gen_random_uuid(),
  resource_path text not null,
  resource_type text not null,
  requested_by text not null,
  created_at timestamptz not null default now(),
  dependency_count integer not null default 0,
  dependents jsonb not null default '[]'::jsonb,
  safe boolean not null,
  approved boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  status text not null default 'planned' check (status in ('planned', 'approved', 'moved', 'blocked', 'failed')),
  correlation_id uuid not null
);

create table if not exists public.resource_migration_blocks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid references public.resource_migration_plans(id) on delete cascade,
  resource_path text not null,
  blocking_dependent text not null,
  dependency_kind text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.workspace_locks enable row level security;
alter table public.workspace_lock_conflicts enable row level security;
alter table public.resource_migration_plans enable row level security;
alter table public.resource_migration_blocks enable row level security;

comment on table public.workspace_locks is 'Workspace Lock Manager: real atomic locks via a partial unique index on resource_path where released_at is null. Service-role only.';
comment on table public.resource_migration_plans is 'Resource Migration Engine: Scan->DependencyAnalysis->ImpactAnalysis->Plan->Approval->MoveToTrash->Audit. safe=false the instant any dependent is found — never overridden silently.';
