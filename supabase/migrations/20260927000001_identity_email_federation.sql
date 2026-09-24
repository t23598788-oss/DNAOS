-- One identity, many providers (owner, 2026-09-24) — canonical auth contract:
-- Google / Apple / Microsoft / Email magic link must ALL resolve to the SAME
-- user/profile. Supabase Auth (GoTrue) links a provider identity onto the
-- existing confirmed-email user, so normally ONE auth.users row serves every
-- provider. This migration is the DB-side guarantee for the edge cases:
--   1. profiles.email UNIQUE (case-insensitive) — one human = one profile
--      row, EVER. A second provider camp can never insert a duplicate.
--      NOTE: index creation fails if duplicate emails already exist — the
--      single-owner history expects none; verify before applying on LIVE.
--   2. handle_new_user v2 — if a profile for this email already exists, KEEP
--      the original row (and its role) untouched instead of inserting a
--      second one: "ห้ามสร้าง profile ซ้ำเมื่อ login คนเดียวกันผ่าน provider
--      คนละค่าย" (owner directive this round).
--   3. profiles_select_same_email — SELECT-ONLY RLS: a session whose JWT
--      email matches the row's email may READ that row. This is identity
--      resolution by email for multi-provider sessions whose sub ≠ original
--      profile id (core/auth/session.ts#getAuthedUser email fallback) —
--      NOT a role/policy widening: no role changes, no write access,
--      registry role_tiers stays the single authority.
-- Idempotent: index IF NOT EXISTS · function CREATE OR REPLACE · policy
-- DROP+CREATE. Apply with the other pending migrations (Owner-gated).

create unique index if not exists profiles_email_lower_key
  on public.profiles (lower(email));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  existing_count int;
  assigned_role public.app_role;
begin
  -- same human via another provider: keep the ONE profile (and its role)
  if exists (
    select 1 from public.profiles p where lower(p.email) = lower(new.email)
  ) then
    return new;
  end if;

  select count(*) into existing_count from public.profiles;
  if existing_count = 0 then
    assigned_role := 'super_admin';
  else
    assigned_role := 'customer';
  end if;

  insert into public.profiles (id, email, role)
  values (new.id, new.email, assigned_role);

  return new;
end;
$$;

drop policy if exists "profiles_select_same_email" on public.profiles;
create policy "profiles_select_same_email" on public.profiles
  for select
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
