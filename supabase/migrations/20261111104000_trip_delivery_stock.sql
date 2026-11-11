-- Trip delivery → stock deduction (owner expansion 2026-11-11, item 2).
--
-- public.trips exists (20261103000002) with a forward-only status trigger
-- (arrived → delivered). What was missing is the ONE write path that makes a
-- successful delivery actually consume stock. This migration adds:
--
--   1. public.trips.material_type_id — which material the trip carried, so the
--      delivery can be reconciled against public.inventory later without guessing.
--   2. public.complete_trip_delivery(...) — locks the trip, refuses any status
--      other than 'arrived', calls the existing atomic stock RPC
--      (apply_inventory_deduction_atomic, 20261111101000) and only then moves the
--      trip to 'delivered' IN THE SAME TRANSACTION. If stock is missing,
--      insufficient, mismatched in unit, or the trip is not arrived, the whole
--      call rolls back: no delivered trip without deducted stock.
--
-- Idempotency: the stock movement is keyed by ('trip_delivery', source_event_id),
-- which defaults to the trip id. A replay of an already-delivered trip returns
-- duplicate=true instead of deducting twice or mutating the terminal status.
--
-- No business thresholds/prices live here. Status vocabulary ('arrived',
-- 'delivered') is the existing CHECK constraint on public.trips.
--
-- Status: APPLIED 2026-11-11 to the linked project (supabase db query, then
-- migration repair --status applied). Verified post-apply: column + RPC exist
-- and the trip RPC rejects a missing trip before any write; trips had 0 rows at
-- apply time, so no delivery/status was changed.

alter table public.trips
  add column if not exists material_type_id uuid
  references public.material_types (id) on delete restrict;

create index if not exists trips_material_idx
  on public.trips (material_type_id)
  where material_type_id is not null;

comment on column public.trips.material_type_id is
  'Material carried by the trip; required (directly or via complete_trip_delivery argument) before stock can be deducted on delivery.';

create or replace function public.complete_trip_delivery(
  p_trip_id          uuid,
  p_material_type_id uuid default null,
  p_source_event_id  text default null,
  p_actor            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip      public.trips%rowtype;
  v_material  uuid;
  v_event     text;
  v_stock     jsonb;
  v_existing  public.stock_movements%rowtype;
begin
  if p_trip_id is null then
    raise exception 'TRIP_ID_REQUIRED: ต้องระบุ trip_id';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor';
  end if;

  -- The trip id is the natural idempotency key of the delivery event.
  v_event := coalesce(nullif(btrim(p_source_event_id), ''), p_trip_id::text);

  select * into v_trip
  from public.trips
  where id = p_trip_id
  for update;

  if not found then
    raise exception 'TRIP_NOT_FOUND: ไม่พบเที่ยววิ่ง %', p_trip_id;
  end if;

  -- Replay of a completed delivery: return the existing movement, never deduct again.
  if v_trip.status = 'delivered' then
    select * into v_existing
    from public.stock_movements
    where source = 'trip_delivery'
      and source_event_id = v_event
    for update;
    if found then
      return jsonb_build_object(
        'trip_id', v_trip.id,
        'status', v_trip.status,
        'duplicate', true,
        'movement_id', v_existing.id,
        'quantity_before', v_existing.quantity_before,
        'quantity_after', v_existing.quantity_after
      );
    end if;
    raise exception 'TRIP_ALREADY_DELIVERED: เที่ยววิ่ง % ส่งถึงแล้วแต่ไม่พบ movement ของ event %', p_trip_id, v_event;
  end if;

  -- Only arrived → delivered is legal (enforced by trips_status_forward too).
  if v_trip.status <> 'arrived' then
    raise exception 'TRIP_STATUS_NOT_ARRIVED: ต้องอยู่ในสถานะ arrived ก่อนส่งถึง (ได้ %)', v_trip.status;
  end if;

  v_material := coalesce(p_material_type_id, v_trip.material_type_id);
  if v_material is null then
    raise exception 'TRIP_MATERIAL_REQUIRED: ต้องระบุ material_type_id (ในเที่ยววิ่งหรือในคำขอ) เพื่อตัดสต็อก';
  end if;
  if v_trip.pit_profile_id is null then
    raise exception 'TRIP_PIT_REQUIRED: เที่ยววิ่ง % ไม่มี pit_profile_id จึงตัดสต็อกไม่ได้', p_trip_id;
  end if;
  if v_trip.material_quantity is null or v_trip.material_quantity <= 0 then
    raise exception 'STOCK_QUANTITY_INVALID: material_quantity ต้องมากกว่า 0 (ได้ %)', v_trip.material_quantity;
  end if;
  if v_trip.material_unit is null then
    raise exception 'STOCK_UNIT_INVALID: material_unit ว่าง';
  end if;

  -- Raises STOCK_ROW_NOT_FOUND / STOCK_UNIT_MISMATCH / STOCK_INSUFFICIENT on failure,
  -- which aborts this transaction before the status change below.
  v_stock := public.apply_inventory_deduction_atomic(
    v_trip.pit_profile_id,
    v_material,
    v_trip.material_quantity,
    v_trip.material_unit,
    'trip_delivery',
    v_event,
    v_trip.job_id,
    p_actor
  );

  update public.trips
     set status = 'delivered',
         material_type_id = v_material,
         actual_arrival_at = coalesce(actual_arrival_at, now())
   where id = p_trip_id;

  return jsonb_build_object(
    'trip_id', p_trip_id,
    'status', 'delivered',
    'duplicate', coalesce((v_stock ->> 'duplicate')::boolean, false),
    'movement_id', v_stock ->> 'movement_id',
    'quantity_before', (v_stock ->> 'quantity_before')::numeric,
    'quantity_after', (v_stock ->> 'quantity_after')::numeric
  );
end;
$$;

revoke all on function public.complete_trip_delivery(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_trip_delivery(uuid, uuid, text, text) to service_role;

comment on function public.complete_trip_delivery(uuid, uuid, text, text) is
  'The only path that marks a trip delivered: atomically deducts inventory via apply_inventory_deduction_atomic and moves arrived → delivered. Rolls back everything on any rejection; replay is idempotent on (trip_delivery, trip id).';
