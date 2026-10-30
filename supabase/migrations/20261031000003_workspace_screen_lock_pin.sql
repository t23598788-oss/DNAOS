-- M031 (2026-10-31): Workspace screen lock — mobile-style 6-digit PIN.
-- The PIN hash lives server-side here; browsers never see or receive it.
-- One row per USER (auth.users id) — never shared across users or orgs.
-- The PIN is NOT a replacement for the Supabase Auth session: unlock state is
-- a separate short-lived HMAC cookie and every protected read still requires
-- the real session first. RLS on: no policy is created, so PostgREST callers
-- holding end-user tokens can neither read nor touch these rows; only the
-- server (service_role, RLS-exempt) may — which is what keeps the server gate
-- real and not merely a browser-side screen.

create table if not exists public.workspace_screen_locks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  pin_hash text not null, -- scrypt$N$r$p$<salt hex>$<derived key hex>
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_screen_locks enable row level security;

create index if not exists workspace_screen_locks_locked_until_idx
  on public.workspace_screen_locks (locked_until)
  where locked_until is not null;
