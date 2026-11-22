-- Business price authority is scoped to the seller organization's owner.
-- This is a new forward migration; historical migration files are untouched.

create or replace function public.apply_material_price_atomic(
  p_pit_profile_id    uuid,
  p_material_type_id  uuid,
  p_price             numeric,
  p_actor             text,
  p_actor_profile_id  uuid,
  p_authority         jsonb,
  p_evidence          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_pit       public.pit_profiles%rowtype;
  v_company   uuid;
  v_org       uuid;
  v_material  public.pit_materials%rowtype;
  v_exists    boolean;
  v_price_id  uuid;
  v_audit_id  uuid;
  v_previous  numeric;
  v_action    text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor_required';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price_invalid';
  end if;
  if p_pit_profile_id is null or p_material_type_id is null or p_actor_profile_id is null then
    raise exception 'price_target_or_actor_required';
  end if;
  if p_authority is null
     or coalesce(p_authority->>'authority_allowed', 'false') <> 'true'
     or coalesce(p_authority->>'authority_via', '') <> 'owner'
     or coalesce(p_authority->>'authority_reason', '') <> 'ORGANIZATION_OWNER' then
    raise exception 'price_forbidden:organization_owner_authority_required';
  end if;

  -- Lock the seller resource so concurrent price changes serialize.
  select * into v_pit
    from public.pit_profiles
   where id = p_pit_profile_id and deleted_at is null
   for update;
  if not found then
    raise exception 'pit_not_found';
  end if;

  -- Resolve seller -> company -> organization from canonical relations.
  select pbp.company_id, c.organization_id
    into v_company, v_org
    from public.partner_business_profiles pbp
    join public.companies c on c.id = pbp.company_id
   where pbp.pit_profile_id = p_pit_profile_id;
  if v_company is null or v_org is null then
    raise exception 'price_forbidden:seller_company_or_organization_missing';
  end if;

  -- Database check: the actor id supplied by the verified server path must
  -- have an owner membership for this organization. This RPC is service-role
  -- only; the database verifies membership, while the application binds that
  -- id to the authenticated session.
  if not exists (
    select 1
      from public.org_members m
     where m.organization_id = v_org
       and m.user_id = p_actor_profile_id
       and m.role = 'owner'
  ) then
    raise exception 'price_forbidden:organization_owner_required';
  end if;

  select * into v_material
    from public.pit_materials
   where pit_profile_id = p_pit_profile_id
     and material_type_id = p_material_type_id
     and deleted_at is null
   order by created_at asc
   limit 1
   for update;
  v_exists := found;

  if v_exists and round(v_material.price, 2) = round(p_price, 2) then
    return jsonb_build_object(
      'changed', false,
      'price_id', v_material.id,
      'audit_id', null,
      'previous_price', v_material.price
    );
  end if;

  if v_exists then
    v_price_id := v_material.id;
    v_previous := v_material.price;
    v_action := 'price.updated';
    update public.pit_materials
       set price = round(p_price, 2), updated_at = now()
     where id = v_price_id;
  else
    v_price_id := gen_random_uuid();
    v_previous := null;
    v_action := 'price.created';
    insert into public.pit_materials (id, pit_profile_id, material_type_id, price)
    values (v_price_id, p_pit_profile_id, p_material_type_id, round(p_price, 2));
  end if;

  insert into public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  values
    (p_actor_profile_id, v_company, 'pit_materials', v_price_id::text, v_action, 'price',
     case when v_previous is null then null else v_previous::text end,
     jsonb_build_object(
       'value', jsonb_build_object(
         'price', round(p_price, 2),
         'pit_profile_id', p_pit_profile_id,
         'material_type_id', p_material_type_id,
         'organization_id', v_org
       ),
       'evidence', coalesce(p_evidence, '{}'::jsonb)
     )::text,
     now());
  returning id into v_audit_id;

  return jsonb_build_object(
    'changed', true,
    'price_id', v_price_id,
    'audit_id', v_audit_id,
    'previous_price', v_previous
  );
end;
$$;

revoke all on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) from public;
revoke all on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) from anon;
revoke all on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) from authenticated;
grant execute on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) to service_role;

comment on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) is
  'Atomic seller price write. Requires the actor to be an org_members owner of the seller company organization; platform admin roles and pit profile ownership do not grant price authority.';
