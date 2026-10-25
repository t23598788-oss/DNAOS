-- ROLLBACK of 20261019000001_org_members_rls_recursion_fix.sql (2026-10-19)
--
-- IMPORTANT: this restores the PREVIOUS state, which is the state that fails
-- with 42P17 (infinite recursion). Rolling back does NOT restore a working
-- product — it restores the exact policies that shipped in
-- 20261018000001_tenant_core_v1.sql plus V2's companies policy. Use only if
-- the fixed migration itself misbehaves and must be withdrawn before a
-- forward-fix is written.
--
-- No data is touched: policies carry no rows, and this file contains no DML.
-- Helper functions introduced by the fix are dropped; V2's
-- tenant_has_membership(uuid) is left untouched because
-- companies_select_member_only depends on it.

-- ─── organizations: V1 recursive definitions ───
drop policy if exists organizations_select_member_only on public.organizations;
create policy organizations_select_member_only
  on public.organizations for select
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organizations.id and m.user_id = auth.uid()
    )
  );

drop policy if exists organizations_update_owner_or_admin on public.organizations;
create policy organizations_update_owner_or_admin
  on public.organizations for update
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organizations.id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- ─── org_members: V1 recursive definitions ───
drop policy if exists org_members_select_own_or_staff on public.org_members;
create policy org_members_select_own_or_staff
  on public.org_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

drop policy if exists org_members_insert_owner_or_admin on public.org_members;
create policy org_members_insert_owner_or_admin
  on public.org_members for insert
  to authenticated
  with check (
    exists (
      select 1 from public.org_members m
      where m.organization_id = organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

drop policy if exists org_members_update_owner_only on public.org_members;
create policy org_members_update_owner_only
  on public.org_members for update
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

drop policy if exists org_members_delete_owner_or_admin on public.org_members;
create policy org_members_delete_owner_or_admin
  on public.org_members for delete
  using (
    exists (
      select 1 from public.org_members m
      where m.organization_id = org_members.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner','admin')
    )
  );

-- ─── companies: restore V2 shape (member-only-when-mapped) ───
drop policy if exists companies_select_member_only on public.companies;
create policy companies_select_member_only
  on public.companies for select
  to authenticated
  using (
    organization_id is not null
    and public.tenant_has_membership(organization_id)
  );

-- ─── helpers introduced by the fix ───
drop function if exists public.tenant_is_org_member(uuid);
drop function if exists public.tenant_is_org_admin(uuid);
drop function if exists public.tenant_is_org_owner(uuid);
