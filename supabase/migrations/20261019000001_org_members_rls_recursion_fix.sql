-- ORG MEMBERSHIP RLS RECURSION FIX — PREPARED ONLY (owner mission 2026-10-19, STEP 2)
-- DO NOT APPLY TO PRODUCTION WITHOUT OWNER APPROVAL.
--
-- PROVEN CAUSE (live, read-only 2026-10-19):
--   GET /rest/v1/org_members  (anon) → HTTP 500
--     {"code":"42P17","message":"infinite recursion detected in policy for relation \"org_members\""}
--   GET /rest/v1/organizations (anon) → the same 42P17, because its SELECT policy
--   queries public.org_members.
--
-- The recursive policy shipped in 20261018000001_tenant_core_v1.sql:
--   org_members_select_own_or_staff
--     using (user_id = auth.uid()
--            or exists (select 1 from public.org_members m
--                       where m.organization_id = org_members.organization_id
--                         and m.user_id = auth.uid() and m.role in ('owner','admin')))
-- A policy on org_members that SELECTs org_members is evaluated while evaluating
-- itself → Postgres aborts the whole query. organizations fails for the same reason.
--
-- WHY THIS SHAPE:
--   * membership/role lookups move into SECURITY DEFINER helpers (owned by the
--     migration role, which owns the tables). One function does the nested check,
--     exactly like public.tenant_has_membership() already does in V2, so no policy
--     ever selects the table it protects.
--   * policies remain fail-closed for anon: helpers read auth.uid(); no anon grant.
--   * no service-role is introduced into any user path — the app's server routes
--     keep using requireAuth() + resolveVerifiedScope(); RLS is the session guard.
--   * behaviour preserved: a member can read their own membership; an owner/admin
--     can read the membership of their own organization; nobody can read another org.
--
-- TEST (after applying on a scratch/staging DB): scripts/tenant-matrix-test.ts plus
-- the static assertions in scripts/ownership-publication-boundary-test.ts.
-- This file is NOT applied by this change.

-- ─── helpers (single decision points; security definer avoids policy recursion) ───
create or replace function public.tenant_is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and organization_id = org
  );
$$;

create or replace function public.tenant_is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and organization_id = org
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.tenant_is_org_owner(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where user_id = auth.uid()
      and organization_id = org
      and role = 'owner'
  );
$$;

revoke all on function public.tenant_is_org_member(uuid) from anon, public;
revoke all on function public.tenant_is_org_admin(uuid)  from anon, public;
revoke all on function public.tenant_is_org_owner(uuid)  from anon, public;
grant execute on function public.tenant_is_org_member(uuid) to authenticated;
grant execute on function public.tenant_is_org_admin(uuid)  to authenticated;
grant execute on function public.tenant_is_org_owner(uuid)  to authenticated;

-- ─── organizations ───
drop policy if exists organizations_select_member_only on public.organizations;
create policy organizations_select_member_only
  on public.organizations for select
  to authenticated
  using (public.tenant_is_org_member(id));

drop policy if exists organizations_update_owner_or_admin on public.organizations;
create policy organizations_update_owner_or_admin
  on public.organizations for update
  to authenticated
  using (public.tenant_is_org_admin(id))
  with check (public.tenant_is_org_admin(id));

-- ─── org_members (replaces the self-referential policy) ───
drop policy if exists org_members_select_own_or_staff on public.org_members;
create policy org_members_select_own_or_staff
  on public.org_members for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.tenant_is_org_admin(organization_id)
  );

drop policy if exists org_members_insert_owner_or_admin on public.org_members;
create policy org_members_insert_owner_or_admin
  on public.org_members for insert
  to authenticated
  with check (
    public.tenant_is_org_owner(organization_id)
    or (public.tenant_is_org_admin(organization_id) and role <> 'owner')
  );

drop policy if exists org_members_update_owner_only on public.org_members;
create policy org_members_update_owner_only
  on public.org_members for update
  to authenticated
  using (public.tenant_is_org_owner(organization_id))
  with check (public.tenant_is_org_owner(organization_id));

drop policy if exists org_members_delete_owner_or_admin on public.org_members;
create policy org_members_delete_owner_or_admin
  on public.org_members for delete
  to authenticated
  using (
    public.tenant_is_org_owner(organization_id)
    or (public.tenant_is_org_admin(organization_id) and role <> 'owner')
  );

-- ─── companies (V2's policy already uses tenant_has_membership; re-assert only) ───
-- Kept member-only-when-mapped. Unmapped companies stay invisible to sessions
-- (that is the fail-closed state the owner intentionally chose in V2).
drop policy if exists companies_select_member_only on public.companies;
create policy companies_select_member_only
  on public.companies for select
  to authenticated
  using (
    organization_id is not null
    and public.tenant_is_org_member(organization_id)
  );

-- ROLLBACK: re-create the V1 policy definitions from
-- supabase/migrations/20261018000001_tenant_core_v1.sql (they are recursive; a
-- rollback restores the 42P17 failure, it does not restore a working state).
