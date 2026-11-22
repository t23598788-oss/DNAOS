-- Applied to Supabase project xeytcavxejhyzxwevgto on 2026-11-16 and recorded
-- in supabase_migrations.schema_migrations as 20261116130000.
-- Atomically record an adapter-reported stock movement and its resulting
-- point-in-time balance using the existing stock_shadow_* tables.
-- No duplicate shadow_stock_state/events tables are created.

begin;

create or replace function public.apply_stock_shadow_movement(
  p_adapter_id uuid,
  p_idempotency_key text,
  p_external_entry_key text,
  p_external_item_code text,
  p_external_warehouse_key text,
  p_quantity_delta numeric,
  p_stock_uom text,
  p_occurred_at timestamptz,
  p_source_document_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, system
as $$
declare
  v_adapter_status text;
  v_capability_scope jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_previous_qty numeric(24, 8);
  v_previous_observed_at timestamptz;
  v_next_qty numeric(24, 8);
  v_existing public.stock_shadow_movements%rowtype;
  v_movement_id uuid;
  v_observation_id uuid;
begin
  if p_adapter_id is null
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 240
     or p_external_entry_key is null or length(btrim(p_external_entry_key)) not between 1 and 240
     or p_external_item_code is null or length(btrim(p_external_item_code)) not between 1 and 240
     or p_external_warehouse_key is null or length(btrim(p_external_warehouse_key)) not between 1 and 240
     or p_quantity_delta is null or p_quantity_delta = 0
     or p_stock_uom is null or length(btrim(p_stock_uom)) not between 1 and 40
     or p_occurred_at is null then
    raise exception 'invalid stock movement input' using errcode = '22023';
  end if;

  select a.status, a.capability_scope
    into v_adapter_status, v_capability_scope
    from system.system_adapters a
   where a.adapter_id = p_adapter_id;

  if not found or v_adapter_status <> 'ready' then
    raise exception 'adapter is not registered and ready' using errcode = '42501';
  end if;

  if not (
    (jsonb_typeof(v_capability_scope) = 'array'
      and v_capability_scope ? 'stock.ingest')
    or
    (jsonb_typeof(v_capability_scope) = 'object'
      and v_capability_scope -> 'stock.ingest' = 'true'::jsonb)
  ) then
    raise exception 'adapter is not authorized for stock.ingest' using errcode = '42501';
  end if;

  select i.shadow_item_id
    into v_item_id
    from public.stock_shadow_items i
   where i.adapter_id = p_adapter_id
     and i.external_item_code = p_external_item_code
     and i.is_stock_item
     and not i.is_disabled;
  if not found then
    raise exception 'item reference is not registered for this adapter' using errcode = 'P0002';
  end if;

  select l.shadow_location_id
    into v_location_id
    from public.stock_shadow_locations l
   where l.adapter_id = p_adapter_id
     and l.external_warehouse_key = p_external_warehouse_key;
  if not found then
    raise exception 'warehouse reference is not registered for this adapter' using errcode = 'P0002';
  end if;

  -- Serialize movements for this adapter/item/location tuple while keeping
  -- separate tuples independent. This makes the latest balance calculation
  -- and the two append-only inserts one atomic operation.
  perform pg_advisory_xact_lock(hashtextextended(
    p_adapter_id::text || ':' || v_item_id::text || ':' || v_location_id::text,
    0
  ));

  select m.*
    into v_existing
    from public.stock_shadow_movements m
   where m.adapter_id = p_adapter_id
     and m.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.external_entry_key <> p_external_entry_key
       or v_existing.shadow_item_id <> v_item_id
       or v_existing.shadow_location_id <> v_location_id
       or v_existing.quantity_delta <> p_quantity_delta
       or v_existing.stock_uom <> p_stock_uom then
      raise exception 'idempotency key was reused with different movement data'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'movement_id', v_existing.shadow_movement_id,
      'quantity_after', v_existing.quantity_after_transaction
    );
  end if;

  select b.actual_qty, b.observed_at
    into v_previous_qty, v_previous_observed_at
    from public.stock_shadow_balance_observations b
   where b.adapter_id = p_adapter_id
     and b.shadow_item_id = v_item_id
     and b.shadow_location_id = v_location_id
   order by b.observed_at desc, b.recorded_at desc
   limit 1;
  if not found then
    raise exception 'authoritative starting balance is required before applying a delta'
      using errcode = 'P0002';
  end if;
  if p_occurred_at <= v_previous_observed_at then
    raise exception 'out-of-order movement requires source reconciliation'
      using errcode = '22023';
  end if;

  v_next_qty := v_previous_qty + p_quantity_delta;

  insert into public.stock_shadow_movements (
    adapter_id, idempotency_key, external_entry_key, shadow_item_id,
    shadow_location_id, quantity_delta, quantity_after_transaction,
    stock_uom, source_document_type, source_document_key, occurred_at
  ) values (
    p_adapter_id, p_idempotency_key, p_external_entry_key, v_item_id,
    v_location_id, p_quantity_delta, v_next_qty, p_stock_uom,
    'adapter_ingestion', p_source_document_key, p_occurred_at
  ) returning shadow_movement_id into v_movement_id;

  insert into public.stock_shadow_balance_observations (
    adapter_id, idempotency_key, shadow_item_id, shadow_location_id,
    actual_qty, stock_uom, observed_at, source_event_id
  ) values (
    p_adapter_id, p_idempotency_key, v_item_id, v_location_id,
    v_next_qty, p_stock_uom, p_occurred_at, null
  ) returning balance_observation_id into v_observation_id;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'movement_id', v_movement_id,
    'balance_observation_id', v_observation_id,
    'quantity_before', v_previous_qty,
    'quantity_delta', p_quantity_delta,
    'quantity_after', v_next_qty
  );
end;
$$;

revoke all on function public.apply_stock_shadow_movement(
  uuid, text, text, text, text, numeric, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_stock_shadow_movement(
  uuid, text, text, text, text, numeric, text, timestamptz, text
) to service_role;

comment on function public.apply_stock_shadow_movement(
  uuid, text, text, text, text, numeric, text, timestamptz, text
) is 'Atomically appends one stock movement and the resulting balance observation after adapter/capability validation.';

commit;
