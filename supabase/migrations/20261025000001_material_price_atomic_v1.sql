-- Material price authority — ATOMIC COMMIT BOUNDARY (WAVE 3, 2026-10-25)
--
-- WHY THIS EXISTS: engines/canonical/material-price-write.ts used to write the
-- business row first and then insert its audit row, reversing the business change
-- on failure. That is compensation, not atomicity: a process death between the two
-- statements leaves a price (or an offer) changed with no audit evidence, and a
-- concurrent reader can observe the half-applied state. WAVE 2 explicitly called
-- this out; WAVE 3 closes it.
--
-- This migration adds the transactional implementation of the TWO commands that
-- already exist in TypeScript. It is not a second writer and contains no business
-- vocabulary of its own (no rates, no UI, no provider branch). The authority
-- DECISION still happens exactly once, in core/authority/resolve.ts; these
-- functions persist that decision and the evidence row in the same transaction.
--
--   record_seller_offer_atomic   a channel reply = EVIDENCE on pit_price_requests
--                                (never touches pit_materials)
--   apply_material_price_atomic  a published price change on pit_materials + the
--                                audit_logs row, committed together
--
-- NOT APPLIED TO ANY DATABASE YET. The TypeScript writer is wired to these
-- functions and fails closed while they are missing (PRICE_ATOMIC_RPC_MISSING),
-- so a half-applied release cannot silently fall back to a non-atomic write.
--
-- PREFLIGHT (run manually on the target before applying; all must return 0 rows):
--   select id from public.pit_materials
--    where price is null or price <= 0;                      -- invalid published rows
--   select pit_profile_id, material_type_id, count(*)
--     from public.pit_materials where deleted_at is null
--    group by 1,2 having count(*) > 1;                       -- duplicate live prices
--   select id from public.pit_profiles
--    where id is not null and user_id is not null
--      and user_id not in (select id from public.profiles);   -- dangling owners
--
-- The duplicate check matters: `findPitMaterial` (TypeScript) uses LIMIT 1, so
-- duplicates would make "which row is the price" ambiguous. The function below
-- locks the PIT row and always operates on the oldest live row, matching the
-- reader order, but the preflight should still be clean before release.
--
-- ROLLBACK: see 20261025000001_material_price_atomic_v1_rollback.sql
-- (dropping both functions only — no table, column or row is touched).

create or replace function public.record_seller_offer_atomic(
  p_request_id      uuid,
  p_price           numeric,
  p_actor           text,
  p_reply_text      text,
  p_replied_at      timestamptz,
  p_evidence        jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request   public.pit_price_requests%rowtype;
  v_audit_id  uuid;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor_required';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price_invalid';
  end if;
  if p_request_id is null then
    raise exception 'price_request_required';
  end if;

  -- Lock the request row: two redelivered messages answer the same request
  -- concurrently, and exactly one of them may record the offer.
  select * into v_request
    from public.pit_price_requests
   where id = p_request_id
     for update;
  if not found then
    raise exception 'price_request_not_found';
  end if;

  -- Idempotency by state (same rule as the TypeScript command):
  -- the same price on an already-answered request is a no-op, not a second row.
  if v_request.status <> 'pending' then
    if v_request.reply_price is not null
       and round(v_request.reply_price, 2) = round(p_price, 2) then
      return jsonb_build_object(
        'already_recorded', true,
        'price', round(v_request.reply_price, 2),
        'audit_id', null
      );
    end if;
    raise exception 'price_request_not_pending:%', v_request.status;
  end if;

  update public.pit_price_requests
     set status      = 'answered',
         reply_text  = left(coalesce(p_reply_text, ''), 2000),
         reply_price = p_price,
         replied_at  = coalesce(p_replied_at, now()),
         updated_at  = now()
   where id = p_request_id;

  insert into public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  values
    (null, null, 'pit_price_requests', p_request_id::text, 'price.offer_recorded', 'reply_price',
     jsonb_build_object('status', v_request.status, 'reply_price', v_request.reply_price)::text,
     jsonb_build_object(
       'value', jsonb_build_object(
         'status', 'answered',
         'reply_price', round(p_price, 2),
         'central_price_changed', false
       ),
       'evidence', coalesce(p_evidence, '{}'::jsonb)
     )::text,
     now())
  returning id into v_audit_id;

  return jsonb_build_object(
    'already_recorded', false,
    'price', round(p_price, 2),
    'audit_id', v_audit_id
  );
end;
$$;

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
set search_path = public
as $$
declare
  v_pit          public.pit_profiles%rowtype;
  v_material     public.pit_materials%rowtype;
  v_exists       boolean;
  v_price_id     uuid;
  v_audit_id     uuid;
  v_previous     numeric;
  v_action       text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor_required';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'price_invalid';
  end if;
  if p_pit_profile_id is null or p_material_type_id is null then
    raise exception 'price_target_required';
  end if;
  if p_actor_profile_id is null then
    raise exception 'authority_actor_required';
  end if;

  -- The authority DECISION is made once, by core/authority/resolve.ts. This
  -- function refuses to persist a change that does not carry an ALLOW decision.
  if p_authority is null or coalesce(p_authority->>'authority_allowed', 'false') <> 'true' then
    raise exception 'price_forbidden:authority_not_granted';
  end if;
  if coalesce(p_authority->>'authority_reason', '') = '' then
    raise exception 'price_forbidden:authority_reason_missing';
  end if;

  -- Lock order: pit row first (serialises every price write for this pit), then
  -- the material row. Two concurrent price changes therefore cannot interleave
  -- their read → write → audit sequence.
  select * into v_pit
    from public.pit_profiles
   where id = p_pit_profile_id
     and deleted_at is null
     for update;
  if not found then
    raise exception 'pit_not_found';
  end if;

  -- Defence in depth: the owner recorded on the resource must match the actor
  -- the resolver evaluated for an owner-path decision. A stale/forged context
  -- cannot claim ownership it does not have.
  if p_authority->>'authority_via' = 'owner'
     and (v_pit.user_id is null or v_pit.user_id <> p_actor_profile_id) then
    raise exception 'price_forbidden:owner_mismatch';
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

  -- Idempotency by state: writing the price that is already published is a no-op
  -- (no second audit row, no updated_at churn).
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
    v_action   := 'price.updated';
    update public.pit_materials
       set price = round(p_price, 2),
           updated_at = now()
     where id = v_price_id;
  else
    v_price_id := gen_random_uuid();
    v_previous := null;
    v_action   := 'price.created';
    insert into public.pit_materials
      (id, pit_profile_id, material_type_id, price)
    values
      (v_price_id, p_pit_profile_id, p_material_type_id, round(p_price, 2));
  end if;

  insert into public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  values
    (null, null, 'pit_materials', v_price_id::text, v_action, 'price',
     case when v_previous is null then null else v_previous::text end,
     jsonb_build_object(
       'value', jsonb_build_object(
         'price', round(p_price, 2),
         'pit_profile_id', p_pit_profile_id,
         'material_type_id', p_material_type_id
       ),
       'evidence', coalesce(p_evidence, '{}'::jsonb)
     )::text,
     now())
  returning id into v_audit_id;

  return jsonb_build_object(
    'changed', true,
    'price_id', v_price_id,
    'audit_id', v_audit_id,
    'previous_price', v_previous
  );
end;
$$;

revoke all on function public.record_seller_offer_atomic(uuid, numeric, text, text, timestamptz, jsonb) from public;
revoke all on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) from public;

do $grant$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.record_seller_offer_atomic(uuid, numeric, text, text, timestamptz, jsonb) from anon';
    execute 'revoke all on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.record_seller_offer_atomic(uuid, numeric, text, text, timestamptz, jsonb) from authenticated';
    execute 'revoke all on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.record_seller_offer_atomic(uuid, numeric, text, text, timestamptz, jsonb) to service_role';
    execute 'grant execute on function public.apply_material_price_atomic(uuid, uuid, numeric, text, uuid, jsonb, jsonb) to service_role';
  end if;
end
$grant$;
