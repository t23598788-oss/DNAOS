-- Atomic demand matching against the adapter-scoped shadow stock projection.
-- A successful demand appends one reservation, one negative movement, one
-- resulting balance observation, one demand attempt, and one technical meter
-- record in a single transaction. An out-of-stock decision is also recorded
-- with a meter record but does not mutate stock.

begin;

create table public.stock_shadow_demand_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  demand_adapter_id uuid not null,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 240),
  stock_adapter_id uuid not null,
  demand_reference text not null
    check (length(btrim(demand_reference)) between 1 and 240),
  external_item_code text not null
    check (length(btrim(external_item_code)) between 1 and 240),
  external_warehouse_key text not null
    check (length(btrim(external_warehouse_key)) between 1 and 240),
  requested_qty numeric(24, 8) not null check (requested_qty > 0),
  available_qty numeric(24, 8) not null check (available_qty >= 0),
  stock_uom text not null check (length(btrim(stock_uom)) between 1 and 40),
  outcome text not null check (outcome in ('reserved', 'out_of_stock')),
  movement_id uuid references public.stock_shadow_movements(shadow_movement_id) on delete restrict,
  requested_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (demand_adapter_id, idempotency_key),
  check (
    (outcome = 'reserved' and movement_id is not null and available_qty >= requested_qty)
    or (outcome = 'out_of_stock' and movement_id is null and available_qty < requested_qty)
  )
);

create table public.stock_shadow_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique
    references public.stock_shadow_demand_attempts(attempt_id) on delete restrict,
  demand_adapter_id uuid not null,
  stock_adapter_id uuid not null,
  demand_reference text not null
    check (length(btrim(demand_reference)) between 1 and 240),
  shadow_item_id uuid not null
    references public.stock_shadow_items(shadow_item_id) on delete restrict,
  shadow_location_id uuid not null
    references public.stock_shadow_locations(shadow_location_id) on delete restrict,
  quantity numeric(24, 8) not null check (quantity > 0),
  stock_uom text not null check (length(btrim(stock_uom)) between 1 and 40),
  movement_id uuid not null unique
    references public.stock_shadow_movements(shadow_movement_id) on delete restrict,
  reserved_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

create index stock_shadow_demand_attempts_recorded_idx
  on public.stock_shadow_demand_attempts (recorded_at desc);
create index stock_shadow_reservations_item_time_idx
  on public.stock_shadow_reservations
    (stock_adapter_id, shadow_item_id, shadow_location_id, reserved_at desc);

alter table public.stock_shadow_demand_attempts enable row level security;
alter table public.stock_shadow_reservations enable row level security;
revoke all on public.stock_shadow_demand_attempts from public, anon, authenticated;
revoke all on public.stock_shadow_reservations from public, anon, authenticated;
grant select, insert on public.stock_shadow_demand_attempts to service_role;
grant select, insert on public.stock_shadow_reservations to service_role;
revoke update, delete, truncate on public.stock_shadow_demand_attempts from service_role;
revoke update, delete, truncate on public.stock_shadow_reservations from service_role;

create or replace function public.match_and_reserve_stock_demand(
  p_demand_adapter_id uuid,
  p_stock_adapter_id uuid,
  p_idempotency_key text,
  p_demand_reference text,
  p_external_item_code text,
  p_external_warehouse_key text,
  p_requested_qty numeric,
  p_stock_uom text,
  p_requested_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, system
as $$
declare
  v_demand_status text;
  v_demand_scope jsonb;
  v_stock_status text;
  v_stock_scope jsonb;
  v_item_id uuid;
  v_location_id uuid;
  v_item_uom text;
  v_previous_qty numeric(24, 8);
  v_previous_observed_at timestamptz;
  v_next_qty numeric(24, 8);
  v_existing public.stock_shadow_demand_attempts%rowtype;
  v_attempt_id uuid;
  v_movement_id uuid;
  v_observation_id uuid;
  v_reservation_id uuid;
  v_meter_key text;
  v_external_entry_key text;
  v_now timestamptz := clock_timestamp();
begin
  if p_demand_adapter_id is null or p_stock_adapter_id is null
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 240
     or p_demand_reference is null or length(btrim(p_demand_reference)) not between 1 and 240
     or p_external_item_code is null or length(btrim(p_external_item_code)) not between 1 and 240
     or p_external_warehouse_key is null or length(btrim(p_external_warehouse_key)) not between 1 and 240
     or p_requested_qty is null or p_requested_qty <= 0
     or p_stock_uom is null or length(btrim(p_stock_uom)) not between 1 and 40
     or p_requested_at is null then
    raise exception 'invalid demand input' using errcode = '22023';
  end if;

  select a.status, a.capability_scope
    into v_demand_status, v_demand_scope
    from system.system_adapters a
   where a.adapter_id = p_demand_adapter_id;
  if not found or v_demand_status <> 'ready'
     or not ((jsonb_typeof(v_demand_scope) = 'array' and v_demand_scope ? 'demand.submit')
       or (jsonb_typeof(v_demand_scope) = 'object' and v_demand_scope -> 'demand.submit' = 'true'::jsonb)) then
    raise exception 'demand adapter is not registered and authorized' using errcode = '42501';
  end if;

  select a.status, a.capability_scope
    into v_stock_status, v_stock_scope
    from system.system_adapters a
   where a.adapter_id = p_stock_adapter_id;
  if not found or v_stock_status <> 'ready'
     or not ((jsonb_typeof(v_stock_scope) = 'array' and v_stock_scope ? 'stock.ingest')
       or (jsonb_typeof(v_stock_scope) = 'object' and v_stock_scope -> 'stock.ingest' = 'true'::jsonb)) then
    raise exception 'stock adapter is not registered and authorized' using errcode = '42501';
  end if;

  -- Serialize retries of one demand before locking the relevant inventory key.
  perform pg_advisory_xact_lock(hashtextextended(
    'demand:' || p_demand_adapter_id::text || ':' || p_idempotency_key, 0
  ));
  select a.* into v_existing
    from public.stock_shadow_demand_attempts a
   where a.demand_adapter_id = p_demand_adapter_id
     and a.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.stock_adapter_id <> p_stock_adapter_id
       or v_existing.demand_reference <> p_demand_reference
       or v_existing.external_item_code <> p_external_item_code
       or v_existing.external_warehouse_key <> p_external_warehouse_key
       or v_existing.requested_qty <> p_requested_qty
       or v_existing.stock_uom <> p_stock_uom then
      raise exception 'idempotency key was reused with different demand data' using errcode = '23505';
    end if;
    select r.reservation_id into v_reservation_id
      from public.stock_shadow_reservations r
     where r.attempt_id = v_existing.attempt_id;
    return jsonb_build_object(
      'ok', true,
      'outcome', case when v_existing.outcome = 'reserved' then 'RESERVED' else 'OUT_OF_STOCK' end,
      'replayed', true,
      'reservation_id', v_reservation_id,
      'movement_id', v_existing.movement_id,
      'quantity_requested', v_existing.requested_qty,
      'quantity_available', v_existing.available_qty,
      'quantity_after', case when v_existing.outcome = 'reserved'
        then v_existing.available_qty - v_existing.requested_qty
        else v_existing.available_qty end,
      'stock_uom', v_existing.stock_uom
    );
  end if;

  select i.shadow_item_id, i.stock_uom
    into v_item_id, v_item_uom
    from public.stock_shadow_items i
   where i.adapter_id = p_stock_adapter_id
     and i.external_item_code = p_external_item_code
     and i.is_stock_item and not i.is_disabled;
  if not found then
    raise exception 'item reference is not registered for the stock adapter' using errcode = 'P0002';
  end if;
  select l.shadow_location_id
    into v_location_id
    from public.stock_shadow_locations l
   where l.adapter_id = p_stock_adapter_id
     and l.external_warehouse_key = p_external_warehouse_key;
  if not found then
    raise exception 'warehouse reference is not registered for the stock adapter' using errcode = 'P0002';
  end if;
  if p_stock_uom <> v_item_uom then
    raise exception 'requested stock unit does not match item unit' using errcode = '22023';
  end if;

  -- Match the same per-stock-key lock used by apply_stock_shadow_movement so
  -- inbound stock and demand reservations cannot race each other.
  perform pg_advisory_xact_lock(hashtextextended(
    p_stock_adapter_id::text || ':' || v_item_id::text || ':' || v_location_id::text,
    0
  ));
  select b.actual_qty, b.observed_at
    into v_previous_qty, v_previous_observed_at
    from public.stock_shadow_balance_observations b
   where b.adapter_id = p_stock_adapter_id
     and b.shadow_item_id = v_item_id
     and b.shadow_location_id = v_location_id
   order by b.observed_at desc, b.recorded_at desc
   limit 1;
  if not found then
    raise exception 'authoritative starting balance is required before matching demand' using errcode = 'P0002';
  end if;
  if p_requested_at <= v_previous_observed_at then
    raise exception 'out-of-order demand requires source reconciliation' using errcode = '22023';
  end if;

  v_meter_key := 'demand:' || md5(p_demand_adapter_id::text || ':' || p_idempotency_key);
  if v_previous_qty < p_requested_qty then
    insert into public.stock_shadow_demand_attempts (
      demand_adapter_id, idempotency_key, stock_adapter_id, demand_reference,
      external_item_code, external_warehouse_key, requested_qty, available_qty,
      stock_uom, outcome, movement_id, requested_at
    ) values (
      p_demand_adapter_id, p_idempotency_key, p_stock_adapter_id, p_demand_reference,
      p_external_item_code, p_external_warehouse_key, p_requested_qty, v_previous_qty,
      p_stock_uom, 'out_of_stock', null, p_requested_at
    ) returning attempt_id into v_attempt_id;

    insert into system.usage_meter_logs (
      idempotency_key, adapter_id, operation_key, usage_quantity, usage_unit,
      cost_basis, status, started_at, completed_at, metadata
    ) values (
      v_meter_key, p_demand_adapter_id, 'demand.match_reserve', 1, 'compute_unit',
      'unknown', 'succeeded', p_requested_at, v_now,
      jsonb_build_object('attempt_id', v_attempt_id, 'demand_reference', p_demand_reference,
        'outcome', 'OUT_OF_STOCK')
    );
    return jsonb_build_object(
      'ok', true, 'outcome', 'OUT_OF_STOCK', 'replayed', false,
      'attempt_id', v_attempt_id, 'quantity_requested', p_requested_qty,
      'quantity_available', v_previous_qty, 'quantity_after', v_previous_qty,
      'stock_uom', p_stock_uom
    );
  end if;

  v_next_qty := v_previous_qty - p_requested_qty;
  v_external_entry_key := 'demand-' || md5(p_demand_adapter_id::text || ':' || p_idempotency_key);
  insert into public.stock_shadow_movements (
    adapter_id, idempotency_key, external_entry_key, shadow_item_id,
    shadow_location_id, quantity_delta, quantity_after_transaction,
    stock_uom, source_document_type, source_document_key, occurred_at
  ) values (
    p_stock_adapter_id, v_external_entry_key, v_external_entry_key, v_item_id,
    v_location_id, -p_requested_qty, v_next_qty, p_stock_uom,
    'demand_reservation', p_demand_reference, p_requested_at
  ) returning shadow_movement_id into v_movement_id;

  insert into public.stock_shadow_balance_observations (
    adapter_id, idempotency_key, shadow_item_id, shadow_location_id,
    actual_qty, stock_uom, observed_at, source_event_id
  ) values (
    p_stock_adapter_id, v_external_entry_key, v_item_id, v_location_id,
    v_next_qty, p_stock_uom, p_requested_at, null
  ) returning balance_observation_id into v_observation_id;

  insert into public.stock_shadow_demand_attempts (
    demand_adapter_id, idempotency_key, stock_adapter_id, demand_reference,
    external_item_code, external_warehouse_key, requested_qty, available_qty,
    stock_uom, outcome, movement_id, requested_at
  ) values (
    p_demand_adapter_id, p_idempotency_key, p_stock_adapter_id, p_demand_reference,
    p_external_item_code, p_external_warehouse_key, p_requested_qty, v_previous_qty,
    p_stock_uom, 'reserved', v_movement_id, p_requested_at
  ) returning attempt_id into v_attempt_id;

  insert into public.stock_shadow_reservations (
    attempt_id, demand_adapter_id, stock_adapter_id, demand_reference,
    shadow_item_id, shadow_location_id, quantity, stock_uom, movement_id, reserved_at
  ) values (
    v_attempt_id, p_demand_adapter_id, p_stock_adapter_id, p_demand_reference,
    v_item_id, v_location_id, p_requested_qty, p_stock_uom, v_movement_id, p_requested_at
  ) returning reservation_id into v_reservation_id;

  insert into system.usage_meter_logs (
    idempotency_key, adapter_id, operation_key, usage_quantity, usage_unit,
    cost_basis, status, started_at, completed_at, metadata
  ) values (
    v_meter_key, p_demand_adapter_id, 'demand.match_reserve', 1, 'compute_unit',
    'unknown', 'succeeded', p_requested_at, v_now,
    jsonb_build_object('attempt_id', v_attempt_id, 'reservation_id', v_reservation_id,
      'demand_reference', p_demand_reference, 'outcome', 'RESERVED')
  );

  return jsonb_build_object(
    'ok', true, 'outcome', 'RESERVED', 'replayed', false,
    'attempt_id', v_attempt_id, 'reservation_id', v_reservation_id,
    'movement_id', v_movement_id, 'balance_observation_id', v_observation_id,
    'quantity_requested', p_requested_qty, 'quantity_available', v_previous_qty,
    'quantity_after', v_next_qty, 'stock_uom', p_stock_uom
  );
end;
$$;

revoke all on function public.match_and_reserve_stock_demand(
  uuid, uuid, text, text, text, text, numeric, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.match_and_reserve_stock_demand(
  uuid, uuid, text, text, text, text, numeric, text, timestamptz
) to service_role;

comment on table public.stock_shadow_demand_attempts is
  'Append-only decisions for stock demand matching, including out-of-stock outcomes; no caller payload is stored.';
comment on table public.stock_shadow_reservations is
  'Append-only successful reservations paired atomically with a negative stock movement and resulting balance observation.';
comment on function public.match_and_reserve_stock_demand(uuid, uuid, text, text, text, text, numeric, text, timestamptz) is
  'Atomically evaluates stock demand, reserves available quantity, appends a stock movement and balance observation, and meters one compute unit.';

commit;
