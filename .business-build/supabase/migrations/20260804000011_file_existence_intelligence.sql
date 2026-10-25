-- File Existence Intelligence & Recovery Capability (owner, 2026-08-04).
-- Built directly after a real incident: an untracked file was permanently
-- deleted mid-session with no recovery path. Extends Rule 116's workspace
-- lock/audit infrastructure — same family as workspace_locks/storage_actions,
-- not a parallel system.

create table if not exists public.file_existence_registry (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  canonical_path text,
  file_type text not null default 'UNKNOWN',
  owning_module text,
  owning_session text,
  purpose text,
  route text,
  exports jsonb not null default '[]'::jsonb,
  imports jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  content_hash text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  git_state text not null default 'UNKNOWN' check (git_state in ('tracked', 'untracked', 'ignored', 'UNKNOWN')),
  registration_state text not null default 'UNCLASSIFIED' check (registration_state in ('REGISTERED', 'UNREGISTERED', 'UNCLASSIFIED')),
  active_or_duplicate text not null default 'UNKNOWN' check (active_or_duplicate in
    ('ACTIVE', 'EXACT_DUPLICATE', 'CONTENT_DIVERGED_COPY', 'GENERATED_OUTPUT', 'ACTIVE_CONCURRENT_WORK', 'TEMPORARY_FILE', 'UNKNOWN_DUPLICATE', 'UNKNOWN')),
  recoverability text not null default 'UNKNOWN' check (recoverability in ('SNAPSHOT_AVAILABLE', 'GIT_AVAILABLE', 'RECONSTRUCTABLE', 'UNRECOVERABLE', 'UNKNOWN')),
  source_of_truth text,
  generation_recipe text,
  last_known_snapshot_hash text,
  unique (path)
);

create table if not exists public.file_snapshots (
  content_hash text primary key,
  original_path text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  session_id text,
  command text,
  reason text,
  related_module text,
  registry_references jsonb not null default '[]'::jsonb,
  storage_path text not null, -- .dna-os/snapshots/<hash>/content on disk; content itself never stored in Postgres
  is_secret boolean not null default false -- true = storage_path intentionally not written, per Vault/Secret policy
);

create table if not exists public.destructive_action_log (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  action text not null check (action in ('rm', 'rm_f', 'rm_rf', 'unlink', 'trash', 'overwrite', 'rename_over', 'cleanup', 'dedup')),
  target_path text not null,
  actor text not null,
  session_id text,
  requested_at timestamptz not null default now(),
  preview jsonb not null,
  blocked boolean not null default true,
  block_reason text,
  confirmation_token text,
  executed boolean not null default false,
  executed_at timestamptz,
  snapshot_hash text,
  trash_path text
);

alter table public.file_existence_registry enable row level security;
alter table public.file_snapshots enable row level security;
alter table public.destructive_action_log enable row level security;

comment on table public.file_existence_registry is 'File Existence Intelligence: real per-file state, UNKNOWN where genuinely unknown, never fabricated. Service-role only.';
comment on table public.destructive_action_log is 'Every destructive-action request, blocked or executed — the audit trail that did not exist when a real untracked file was lost 2026-08-04.';
