-- Public-signup privilege hardening (2026-10-24, idempotent: CREATE OR REPLACE)
--
-- WHY: /register went live for the public website. The original
-- handle_new_user (migration 20260927000001) bootstraps the FIRST profile to
-- super_admin when public.profiles is empty. With a public signup form that
-- is a faceless race: whichever fresh email signs up while profiles is empty
-- (fresh restore, owner rows purged, migration replay on a new project)
-- becomes the system controller entirely from the PUBLIC web form.
--
-- CHANGE: every new signup gets role 'customer' — unconditionally. The
-- controller account gets provisioned out-of-band (direct DB / Supabase
-- Admin API by the owner), exactly once, never through the public form.
--
-- IMPACT ON EXISTING ACCOUNTS: none. This function only runs at signup-time
-- (auth.users insert trigger). The same-human guard below still keeps the
-- ORIGINAL profile+role for any email that already has a row, and no UPDATE
-- touches existing profiles.role values.
--
-- STATUS: source file ONLY — deliberately NOT applied by this pass
-- (constraint: no production DB change without owner authorization). The
-- owner applies it in an approved window (supabase db push / SQL editor).
--
-- Post-apply verification:
--   1) select role from public.profiles where lower(email)=lower('<owner-email>');
--      → unchanged (super_admin).
--   2) fresh signup row → role = 'customer'.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- same human via another provider: keep the ONE profile (and its role).
  -- This is what guarantees an existing account is never touched.
  if exists (
    select 1 from public.profiles p where lower(p.email) = lower(new.email)
  ) then
    return new;
  end if;

  -- Public signup can NEVER receive controller privileges, regardless of
  -- table emptiness (controller accounts are provisioned out-of-band).
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'customer'::public.app_role);

  return new;
end;
$$;
