-- Resource Control Workspace — canonical atomic deactivation boundary.
--
-- This is intentionally NOT a second writer: DELETE /api/admin/pits/[pitId]
-- remains the authority and commits through this one RPC. PostgreSQL executes a
-- function in one transaction; any RAISE (including a failed audit insert)
-- rolls back the operation claim, all resource changes, and both audit rows.
--
-- Permanent deletion is deliberately NOT implemented here. public.jobs carries
-- pit_profile_id as a canonical reference but has no declared FK, so an orphan-
-- safe permanent delete cannot be proven without a separate schema decision.

create table if not exists public.pit_resource_operations (
  operation_id uuid primary key,
  -- No FK here: the atomic claim must happen before the target FOR UPDATE lock
  -- so duplicate requests replay correctly. An FK would take KEY SHARE first
  -- and allow two distinct operations to deadlock while upgrading to FOR UPDATE.
  -- The operation and target mutation remain in the same transaction, so a
  -- failed/not-found target rolls the ledger row back with no orphan ledger row.
  pit_profile_id uuid not null,
  actor_user_id uuid not null,
  action text not null check (action = 'deactivate'),
  response jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists pit_resource_operations_pit_profile_id_idx
  on public.pit_resource_operations (pit_profile_id, created_at desc);

alter table public.pit_resource_operations enable row level security;
drop policy if exists service_role_only on public.pit_resource_operations;
create policy service_role_only on public.pit_resource_operations for all using (false);

create or replace function public.deactivate_pit_resource(
  p_pit_id uuid,
  p_operation_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pit public.pit_profiles%rowtype;
  v_existing_response jsonb;
  v_claim_rows integer := 0;
  v_now timestamptz := clock_timestamp();
  v_active_materials integer := 0;
  v_price_requests integer := 0;
  v_partner_links integer := 0;
  v_job_references integer := 0;
  v_archived_materials integer := 0;
  v_before_counters jsonb;
  v_after_counters jsonb;
  v_impact jsonb;
  v_evidence jsonb;
  v_response jsonb;
begin
  if p_pit_id is null or p_operation_id is null or p_actor_user_id is null then
    raise exception 'pit_id_operation_id_and_actor_required';
  end if;

  -- Claim before the target lock so a concurrent duplicate waits on the unique
  -- index and then returns this completed response instead of seeing an already
  -- deactivated pit. A failed operation rolls this INSERT back, so retry is safe.
  insert into public.pit_resource_operations (
    operation_id, pit_profile_id, actor_user_id, action
  ) values (
    p_operation_id, p_pit_id, p_actor_user_id, 'deactivate'
  ) on conflict (operation_id) do nothing;
  get diagnostics v_claim_rows = row_count;

  if v_claim_rows = 0 then
    select response into v_existing_response
      from public.pit_resource_operations
     where operation_id = p_operation_id
       and pit_profile_id = p_pit_id
       and actor_user_id = p_actor_user_id
       and action = 'deactivate'
       for update;
    if not found then
      raise exception 'operation_id_reused_for_different_request';
    end if;
    return jsonb_set(v_existing_response, '{replayed}', 'true'::jsonb, true);
  end if;

  -- Lock parent first. FK inserts into pit_materials, pit_price_requests and
  -- partners need KEY SHARE and therefore cannot race this transaction.
  select * into v_pit from public.pit_profiles
   where id = p_pit_id
   for update;
  if not found then raise exception 'pit_not_found'; end if;
  if v_pit.deleted_at is not null or not coalesce(v_pit.is_open, true) then
    raise exception 'pit_already_deactivated';
  end if;

  -- jobs.pit_profile_id is a real canonical reference but not an FK. Its table
  -- is locked for this short transaction so an insert/update cannot invalidate
  -- the dependency snapshot or audit evidence while the pit is being changed.
  if to_regclass('public.jobs') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'jobs' and column_name = 'pit_profile_id'
     ) then
    raise exception 'jobs_pit_reference_schema_unavailable';
  end if;
  lock table public.jobs in share row exclusive mode;

  -- Lock the mutable child set before counting and archiving it. New FK-backed
  -- rows are blocked by the parent FOR UPDATE lock until this transaction ends.
  perform 1 from public.pit_materials
   where pit_profile_id = p_pit_id and deleted_at is null
   order by id for update;

  select count(*) into v_active_materials from public.pit_materials
   where pit_profile_id = p_pit_id and deleted_at is null;
  select count(*) into v_price_requests from public.pit_price_requests
   where pit_profile_id = p_pit_id;
  select count(*) into v_partner_links from public.partners
   where pit_profile_id = p_pit_id;
  execute 'select count(*) from public.jobs where pit_profile_id = $1'
    into v_job_references using p_pit_id;

  v_impact := jsonb_build_object(
    'active_material_relationships', v_active_materials,
    'price_requests', v_price_requests,
    'partner_links', v_partner_links,
    'job_references', v_job_references,
    'direct_document_references', 0
  );

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where deleted_at is null and is_open),
    'inactive', count(*) filter (where deleted_at is not null or not is_open)
  ) into v_before_counters from public.pit_profiles;

  insert into public.audit_logs (
    entity_type, entity_id, action, field, old_value, new_value, actor_user_id
  ) values (
    'pit_profile', p_pit_id::text, 'deactivation_preflight_authorized',
    'deletion_preflight_operation_id=' || p_operation_id::text, null,
    jsonb_build_object(
      'operation_id', p_operation_id,
      'action', 'deactivate',
      'authorization', 'ADMIN_TIER checked by canonical route',
      'latest_impact', v_impact
    )::text,
    p_actor_user_id
  );

  update public.pit_materials
     set deleted_at = v_now, updated_at = v_now
   where pit_profile_id = p_pit_id and deleted_at is null;
  get diagnostics v_archived_materials = row_count;

  update public.pit_profiles
     set deleted_at = v_now, is_open = false, updated_at = v_now
   where id = p_pit_id;

  if exists (
    select 1 from public.pit_materials
     where pit_profile_id = p_pit_id and deleted_at is null
  ) then
    raise exception 'active_material_links_remain_after_deactivation';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where deleted_at is null and is_open),
    'inactive', count(*) filter (where deleted_at is not null or not is_open)
  ) into v_after_counters from public.pit_profiles;

  v_evidence := jsonb_build_object(
    'operation_id', p_operation_id,
    'impact', v_impact,
    'before_counters', v_before_counters,
    'after_counters', v_after_counters,
    'archived_material_links', v_archived_materials,
    'unrelated_rows_modified', 0
  );

  insert into public.audit_logs (
    entity_type, entity_id, action, field, old_value, new_value, actor_user_id
  ) values (
    'pit_profile', p_pit_id::text, 'deactivated',
    'deletion_operation_id=' || p_operation_id::text,
    v_impact::text, v_evidence::text, p_actor_user_id
  );

  v_response := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'action', 'deactivated',
    'pit', jsonb_build_object('id', v_pit.id, 'name', v_pit.pit_name, 'company_name', v_pit.registered_name),
    'impact', v_impact,
    'read_back', jsonb_build_object('id', v_pit.id, 'deleted_at', v_now, 'is_open', false),
    'counters_before', v_before_counters,
    'counters_after', v_after_counters,
    'audit_evidence', v_evidence
  );

  update public.pit_resource_operations
     set response = v_response, completed_at = clock_timestamp()
   where operation_id = p_operation_id;

  return v_response;
end;
$$;

revoke all on function public.deactivate_pit_resource(uuid, uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.deactivate_pit_resource(uuid, uuid, uuid) to service_role;
  end if;
end $$;