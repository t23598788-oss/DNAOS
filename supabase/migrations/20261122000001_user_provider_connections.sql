-- Per-user provider connections (metadata and opaque secret reference only).
-- Shared service configuration remains in the existing system connector
-- registry; this table is for each user's own external account or API key.

begin;

create table if not exists public.user_provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  connection_method text not null
    check (connection_method in ('oauth', 'api_key', 'mcp')),
  external_account_id text,
  account_label text,
  granted_scopes text[] not null default '{}',
  credential_ref text,
  status text not null default 'pending'
    check (status in ('pending', 'connected', 'error', 'revoked')),
  oauth_state_hash text unique,
  oauth_state_expires_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, provider_id, external_account_id)
);

comment on table public.user_provider_connections is
  'User-owned external provider grants. Contains identity/scope/status metadata and an opaque credential reference only; never stores credential values.';
comment on column public.user_provider_connections.credential_ref is
  'Opaque server-side secret-store reference. Never expose this field to clients.';

create index if not exists user_provider_connections_owner_idx
  on public.user_provider_connections (owner_user_id, provider_id, status);
create unique index if not exists user_provider_connections_one_api_key_per_user
  on public.user_provider_connections (owner_user_id, provider_id)
  where connection_method = 'api_key' and external_account_id is null;

create index if not exists user_provider_connections_pending_oauth_idx
  on public.user_provider_connections (owner_user_id, provider_id, oauth_state_expires_at)
  where connection_method = 'oauth' and status = 'pending';

alter table public.user_provider_connections enable row level security;

drop policy if exists user_provider_connections_select_own on public.user_provider_connections;
create policy user_provider_connections_select_own
  on public.user_provider_connections for select to authenticated
  using (owner_user_id = (select auth.uid()));

-- Browser sessions can read their own non-secret connection metadata only.
-- All writes go through authenticated server routes, which derive owner_user_id
-- from the DNA OS session and never accept it from the request body.
revoke all on public.user_provider_connections from public, anon, authenticated;
grant select (
  id, owner_user_id, provider_id, external_account_id, account_label,
  connection_method, granted_scopes, status, last_verified_at, last_error_code, created_at, updated_at
) on public.user_provider_connections to authenticated;
grant all on public.user_provider_connections to service_role;

commit;
