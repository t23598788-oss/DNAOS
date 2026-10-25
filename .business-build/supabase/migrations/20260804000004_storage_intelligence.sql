-- Storage Intelligence capability — persistence for scan/classify/decision/audit.
-- Infra data, not user-facing: RLS enabled with no policies, service-role only
-- (same pattern as other infra tables like ai_tasks). Never exposed via anon key.

create table if not exists public.storage_scan_runs (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  actor text not null,
  roots_scanned text[] not null default '{}',
  resource_count integer,
  total_bytes bigint,
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  correlation_id uuid not null
);

create table if not exists public.storage_resources (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.storage_scan_runs(id) on delete cascade,
  path text not null,
  size_bytes bigint not null,
  sha256 text,
  modified_at timestamptz,
  state text not null default 'DISCOVERED' check (state in
    ('DISCOVERED', 'CLASSIFIED', 'VERIFIED', 'SAFE', 'BLOCKED', 'PLANNED', 'MOVED_TO_TRASH', 'FAILED')),
  created_at timestamptz not null default now()
);

create table if not exists public.storage_classifications (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.storage_resources(id) on delete cascade,
  classification text not null,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  recommended_action text not null,
  blocked_reason text,
  classified_at timestamptz not null default now()
);

create table if not exists public.storage_evidence (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.storage_resources(id) on delete cascade,
  kind text not null,
  detail text not null,
  value text,
  collected_at timestamptz not null default now()
);

create table if not exists public.storage_reclaim_plans (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.storage_scan_runs(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text not null,
  total_bytes bigint not null,
  resource_ids uuid[] not null default '{}',
  correlation_id uuid not null
);

create table if not exists public.storage_actions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.storage_resources(id) on delete cascade,
  plan_id uuid references public.storage_reclaim_plans(id),
  action text not null check (action in ('moved_to_trash', 'blocked', 'failed')),
  actor text not null,
  from_path text not null,
  trash_path text,
  reason text,
  operation_id uuid not null,
  correlation_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.storage_threshold_events (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null,
  free_bytes bigint not null,
  threshold_bytes bigint not null,
  reclaimable_bytes bigint,
  breached boolean not null,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.storage_scan_runs enable row level security;
alter table public.storage_resources enable row level security;
alter table public.storage_classifications enable row level security;
alter table public.storage_evidence enable row level security;
alter table public.storage_reclaim_plans enable row level security;
alter table public.storage_actions enable row level security;
alter table public.storage_threshold_events enable row level security;

comment on table public.storage_scan_runs is 'Storage Intelligence: one row per storage.scan invocation (engines/storage/engine.ts). Service-role only.';
comment on table public.storage_actions is 'Storage Intelligence: audit trail for every trash-move/block/fail decision — never a permanent-delete record, trash_path is always populated on moved_to_trash.';
