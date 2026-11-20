-- Production-only promotion script for the existing organization membership
-- tables. Apply only to the explicitly verified DNA OS main project after
-- reviewing the preflight. This does not create or delete business tables.
--
-- Scope:
--   * remove direct client writes to public.org_members;
--   * route membership changes through an authenticated, organization-scoped
--     SECURITY DEFINER RPC;
--   * replace recursive SELECT policy evaluation with a scoped helper;
-- The migration runner records this version after successful application.
--
-- The Local end-to-end contract is scripts/test_org_members_security.mjs.


do $preflight$
begin
  if to_regclass('public.org_members') is null
     or to_regclass('public.organizations') is null
     or to_regclass('auth.users') is null
     or to_regclass('public.admin_action_log') is null then
    raise exception 'org_members authority preflight failed: required existing relations are missing';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20261120000001'
      and name <> 'org_members_authority_reconcile'
  ) then
    raise exception 'migration version 20261120000001 is already used by another migration';
  end if;
end
$preflight$;

-- Keep reads under the existing row scope, but prevent clients from writing
-- the membership table directly. service_role behavior is unchanged.
revoke all on table public.org_members from public, anon, authenticated;
grant select on table public.org_members to authenticated;

drop policy if exists org_members_insert_owner_or_admin on public.org_members;
drop policy if exists org_members_update_owner_only on public.org_members;
drop policy if exists org_members_delete_owner_or_admin on public.org_members;

create or replace function public.manage_org_member(
  p_org_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_role text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
  v_owner_count integer;
begin
  if v_actor_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception using errcode = '42501', message = 'ORG_MEMBER_AUTH_REQUIRED';
  end if;
  if p_org_id is null or p_target_user_id is null or p_action is null
     or p_action not in ('ADD', 'SET_ROLE', 'REMOVE') then
    raise exception using errcode = '22023', message = 'ORG_MEMBER_INPUT_INVALID';
  end if;

  select m.role into v_actor_role
  from public.org_members m
  where m.organization_id = p_org_id and m.user_id = v_actor_id;
  if not found or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'ORG_MEMBER_MANAGEMENT_DENIED';
  end if;

  -- Serialize membership changes within this organization and then re-check
  -- the actor's scoped authority before writing.
  perform 1 from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'ORG_MEMBER_MANAGEMENT_DENIED';
  end if;
  select m.role into v_actor_role
  from public.org_members m
  where m.organization_id = p_org_id and m.user_id = v_actor_id;
  if not found or v_actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'ORG_MEMBER_MANAGEMENT_DENIED';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception using errcode = '22023', message = 'ORG_MEMBER_TARGET_NOT_FOUND';
  end if;

  if p_action = 'ADD' then
    if p_role is null or p_role not in ('member', 'admin') then
      raise exception using errcode = '42501', message = 'ORG_MEMBER_ROLE_NOT_ASSIGNABLE';
    end if;
    if v_actor_role = 'admin' and p_role <> 'member' then
      raise exception using errcode = '42501', message = 'ORG_MEMBER_ROLE_CHANGE_DENIED';
    end if;
    select m.role into v_target_role from public.org_members m
      where m.organization_id = p_org_id and m.user_id = p_target_user_id;
    if found then
      if v_target_role = p_role then
        return jsonb_build_object('organization_id', p_org_id, 'user_id', p_target_user_id,
          'role', v_target_role, 'status', 'UNCHANGED');
      end if;
      raise exception using errcode = '23505', message = 'ORG_MEMBER_ALREADY_EXISTS';
    end if;
    insert into public.org_members(organization_id, user_id, role)
      values (p_org_id, p_target_user_id, p_role);
    insert into public.admin_action_log(actor_id, action, target_table, target_id, detail)
      values (v_actor_id, 'ORG_MEMBER_ADD', 'org_members', p_target_user_id,
        jsonb_build_object('organization_id', p_org_id, 'role_after', p_role));
    return jsonb_build_object('organization_id', p_org_id, 'user_id', p_target_user_id,
      'role', p_role, 'status', 'ADDED');
  end if;

  select m.role into v_target_role from public.org_members m
    where m.organization_id = p_org_id and m.user_id = p_target_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'ORG_MEMBER_NOT_FOUND';
  end if;

  if p_action = 'SET_ROLE' then
    if v_actor_role <> 'owner' or v_target_role = 'owner'
       or p_role is null or p_role not in ('member', 'admin') then
      raise exception using errcode = '42501', message = 'ORG_MEMBER_ROLE_CHANGE_DENIED';
    end if;
    update public.org_members set role = p_role
      where organization_id = p_org_id and user_id = p_target_user_id;
    insert into public.admin_action_log(actor_id, action, target_table, target_id, detail)
      values (v_actor_id, 'ORG_MEMBER_SET_ROLE', 'org_members', p_target_user_id,
        jsonb_build_object('organization_id', p_org_id, 'role_before', v_target_role, 'role_after', p_role));
    return jsonb_build_object('organization_id', p_org_id, 'user_id', p_target_user_id,
      'role', p_role, 'status', 'UPDATED');
  end if;

  if p_role is not null then
    raise exception using errcode = '22023', message = 'ORG_MEMBER_INPUT_INVALID';
  end if;
  if v_actor_role = 'admin' and v_target_role <> 'member' then
    raise exception using errcode = '42501', message = 'ORG_MEMBER_REMOVE_DENIED';
  end if;
  if v_target_role = 'owner' then
    if v_actor_role <> 'owner' then
      raise exception using errcode = '42501', message = 'ORG_MEMBER_REMOVE_DENIED';
    end if;
    select count(*) into v_owner_count from public.org_members m
      where m.organization_id = p_org_id and m.role = 'owner';
    if v_owner_count <= 1 then
      raise exception using errcode = '23514', message = 'ORG_LAST_OWNER_PROTECTED';
    end if;
  end if;
  delete from public.org_members
    where organization_id = p_org_id and user_id = p_target_user_id;
  insert into public.admin_action_log(actor_id, action, target_table, target_id, detail)
    values (v_actor_id, 'ORG_MEMBER_REMOVE', 'org_members', p_target_user_id,
      jsonb_build_object('organization_id', p_org_id, 'role_before', v_target_role));
  return jsonb_build_object('organization_id', p_org_id, 'user_id', p_target_user_id,
    'status', 'REMOVED');
end
$function$;

alter function public.manage_org_member(uuid, uuid, text, text) owner to postgres;
revoke all on function public.manage_org_member(uuid, uuid, text, text) from public, anon, service_role;
grant execute on function public.manage_org_member(uuid, uuid, text, text) to authenticated;
comment on function public.manage_org_member(uuid, uuid, text, text) is
  'Fail-closed organization membership management. All writes are organization-scoped to auth.uid(); owner assignment remains exclusive to existing onboarding authority.';

-- This helper bypasses the table's SELECT policy only to check the caller's
-- own owner/admin membership for the same organization, avoiding recursive RLS.
create or replace function public.current_user_is_org_admin(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select auth.uid() is not null and exists (
    select 1 from public.org_members m
    where m.organization_id = p_org_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$function$;
alter function public.current_user_is_org_admin(uuid) owner to postgres;
revoke all on function public.current_user_is_org_admin(uuid) from public, anon, service_role;
grant execute on function public.current_user_is_org_admin(uuid) to authenticated;

drop policy if exists org_members_select_own_or_staff on public.org_members;
create policy org_members_select_own_or_staff
  on public.org_members for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_org_admin(organization_id));
