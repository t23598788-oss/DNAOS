-- Development Machine Policy drift audit (Constitution Rule 117, owner 2026-08-04).
-- One row per real drift check run (every 6h, piggybacked on
-- local-runtime/storage-threshold-watcher.ts), findings stored as real
-- evidence, never a synthetic/assumed record.

create table if not exists public.architecture_drift_events (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null,
  checked_at timestamptz not null default now(),
  clean boolean not null,
  finding_count integer not null default 0,
  findings jsonb not null default '[]'::jsonb,
  notified boolean not null default false
);

alter table public.architecture_drift_events enable row level security;

comment on table public.architecture_drift_events is 'Development Machine Policy: real drift checks for local AI runtime/model presence. Service-role only.';
