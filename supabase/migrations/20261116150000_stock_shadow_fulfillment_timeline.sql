-- Append-only event timeline for demand, reservation, stock movement, metering,
-- and fulfillment. Existing source rows keep their authoritative timestamps;
-- unavailable historical receive times are left null rather than fabricated.

begin;

create table public.shadow_stock_events (
  event_id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in (
    'demand.requested', 'stock.reserved', 'stock.movement.recorded',
    'meter.usage.recorded', 'fulfillment.confirmed'
  )),
  idempotency_key text not null unique
    check (length(btrim(idempotency_key)) between 1 and 240),
  adapter_id uuid,
  actor_type text not null check (length(btrim(actor_type)) between 1 and 80),
  actor_id text check (actor_id is null or length(btrim(actor_id)) between 1 and 240),
  source_channel text not null check (length(btrim(source_channel)) between 1 and 120),
  attempt_id uuid references public.stock_shadow_demand_attempts(attempt_id) on delete restrict,
  reservation_id uuid references public.stock_shadow_reservations(reservation_id) on delete restrict,
  movement_id uuid references public.stock_shadow_movements(shadow_movement_id) on delete restrict,
  balance_observation_id uuid references public.stock_shadow_balance_observations(balance_observation_id) on delete restrict,
  usage_log_id uuid references system.usage_meter_logs(usage_log_id) on delete restrict,
  document_reference text check (document_reference is null or length(btrim(document_reference)) between 1 and 240),
  document_created_at timestamptz,
  arrived_at timestamptz,
  occurred_at timestamptz not null,
  received_at timestamptz,
  recorded_at timestamptz not null default clock_timestamp(),
  fulfilled_at timestamptz,
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  check (actor_id is not null or source_channel <> ''),
  check (num_nonnulls(attempt_id, reservation_id, movement_id, balance_observation_id, usage_log_id) > 0),
  check (document_created_at is null or arrived_at is null or document_created_at <= arrived_at),
  check (arrived_at is null or occurred_at >= arrived_at),
  check (fulfilled_at is null or fulfilled_at = arrived_at or fulfilled_at = occurred_at)
);

create index shadow_stock_events_timeline_idx
  on public.shadow_stock_events (occurred_at, recorded_at, event_id);
create index shadow_stock_events_reservation_idx
  on public.shadow_stock_events (reservation_id, occurred_at)
  where reservation_id is not null;
create index shadow_stock_events_adapter_idx
  on public.shadow_stock_events (adapter_id, event_type, recorded_at desc);

alter table public.shadow_stock_events enable row level security;
revoke all on public.shadow_stock_events from public, anon, authenticated;
grant select, insert on public.shadow_stock_events to service_role;
revoke update, delete, truncate on public.shadow_stock_events from service_role;

-- Preserve the reservation as an immutable fact. Its lifecycle state is
-- derived from the presence of an append-only fulfillment event.
create or replace view public.stock_shadow_reservation_status
with (security_invoker = true)
as
select
  r.reservation_id,
  r.attempt_id,
  r.demand_adapter_id,
  r.stock_adapter_id,
  r.demand_reference,
  r.shadow_item_id,
  r.shadow_location_id,
  r.quantity,
  r.stock_uom,
  r.movement_id,
  r.reserved_at,
  r.recorded_at,
  case when f.event_id is null then 'RESERVED' else 'CONSUMED' end as status,
  f.fulfilled_at,
  f.event_id as fulfillment_event_id,
  f.actor_type as fulfillment_actor_type,
  f.actor_id as fulfillment_actor_id,
  f.source_channel as fulfillment_source_channel,
  f.occurred_at as fulfillment_occurred_at,
  f.received_at as fulfillment_received_at,
  f.recorded_at as fulfillment_recorded_at
from public.stock_shadow_reservations r
left join public.shadow_stock_events f
  on f.reservation_id = r.reservation_id
 and f.event_type = 'fulfillment.confirmed';
revoke all on public.stock_shadow_reservation_status from public, anon, authenticated;
grant select on public.stock_shadow_reservation_status to service_role;

create or replace function public.confirm_stock_shadow_fulfillment(
  p_reservation_id uuid,
  p_idempotency_key text,
  p_document_reference text,
  p_document_created_at timestamptz,
  p_arrived_at timestamptz,
  p_occurred_at timestamptz,
  p_received_at timestamptz,
  p_actor_type text,
  p_actor_id text,
  p_source_channel text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, system
as $$
declare
  v_reservation public.stock_shadow_reservations%rowtype;
  v_existing public.shadow_stock_events%rowtype;
  v_event_id uuid;
  v_meter_id uuid;
  v_meter_key text;
  v_event_key text;
  v_recorded_at timestamptz := clock_timestamp();
  v_fulfilled_at timestamptz;
begin
  if p_reservation_id is null
     or p_idempotency_key is null or length(btrim(p_idempotency_key)) not between 1 and 240
     or p_document_reference is null or length(btrim(p_document_reference)) not between 1 and 240
     or p_arrived_at is null or p_occurred_at is null or p_received_at is null
     or p_actor_type is null or length(btrim(p_actor_type)) not between 1 and 80
     or (p_actor_id is null and (p_source_channel is null or btrim(p_source_channel) = ''))
     or (p_actor_id is not null and length(btrim(p_actor_id)) > 240)
     or (p_source_channel is not null and length(btrim(p_source_channel)) not between 1 and 120) then
    raise exception 'invalid fulfillment input' using errcode = '22023';
  end if;
  if p_document_created_at is not null and p_document_created_at > p_arrived_at then
    raise exception 'document_created_at must not be later than arrived_at' using errcode = '22023';
  end if;
  if p_occurred_at < p_arrived_at or p_received_at < p_occurred_at then
    raise exception 'fulfillment timestamps are out of order' using errcode = '22023';
  end if;

  v_event_key := 'fulfillment:' || md5(p_reservation_id::text || ':' || p_idempotency_key);
  v_meter_key := 'fulfillment:' || md5(p_reservation_id::text || ':' || p_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended('fulfillment:' || p_reservation_id::text, 0));

  select e.* into v_existing
    from public.shadow_stock_events e
   where e.idempotency_key = v_event_key;
  if found then
    if v_existing.event_type <> 'fulfillment.confirmed'
       or v_existing.reservation_id <> p_reservation_id
       or v_existing.document_reference <> p_document_reference
       or v_existing.arrived_at <> p_arrived_at
       or v_existing.occurred_at <> p_occurred_at
       or v_existing.actor_id is distinct from p_actor_id
       or v_existing.source_channel is distinct from p_source_channel then
      raise exception 'idempotency key was reused with different fulfillment data' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok', true, 'status', 'CONSUMED', 'replayed', true,
      'reservation_id', p_reservation_id, 'event_id', v_existing.event_id,
      'fulfilled_at', v_existing.fulfilled_at,
      'occurred_at', v_existing.occurred_at,
      'received_at', v_existing.received_at,
      'recorded_at', v_existing.recorded_at,
      'actor_id', v_existing.actor_id,
      'source_channel', v_existing.source_channel
    );
  end if;

  if exists (
    select 1 from public.shadow_stock_events e
     where e.reservation_id = p_reservation_id
       and e.event_type = 'fulfillment.confirmed'
  ) then
    raise exception 'reservation has already been fulfilled' using errcode = '23505';
  end if;

  select r.* into v_reservation
    from public.stock_shadow_reservations r
   where r.reservation_id = p_reservation_id;
  if not found then
    raise exception 'reservation not found' using errcode = 'P0002';
  end if;

  v_fulfilled_at := p_arrived_at;
  insert into system.usage_meter_logs (
    idempotency_key, adapter_id, operation_key, usage_quantity, usage_unit,
    cost_basis, status, started_at, completed_at, metadata
  ) values (
    v_meter_key, v_reservation.demand_adapter_id,
    'fulfillment.confirm_delivery', 1, 'compute_unit', 'unknown', 'succeeded',
    p_received_at, v_recorded_at,
    jsonb_build_object('reservation_id', p_reservation_id,
      'actor_type', p_actor_type, 'actor_id', p_actor_id,
      'source_channel', p_source_channel)
  ) returning usage_log_id into v_meter_id;

  insert into public.shadow_stock_events (
    event_type, idempotency_key, adapter_id, actor_type, actor_id, source_channel,
    reservation_id, movement_id, usage_log_id, document_reference,
    document_created_at, arrived_at, occurred_at, received_at, recorded_at,
    fulfilled_at, confirmed_at, metadata
  ) values (
    'fulfillment.confirmed', v_event_key, v_reservation.demand_adapter_id,
    p_actor_type, p_actor_id, coalesce(p_source_channel, 'unknown'),
    p_reservation_id, v_reservation.movement_id, v_meter_id, p_document_reference,
    p_document_created_at, p_arrived_at, p_occurred_at, p_received_at, v_recorded_at,
    v_fulfilled_at, v_recorded_at,
    jsonb_build_object('timestamp_basis', 'source_arrival_and_server_recording')
  ) returning event_id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'status', 'CONSUMED', 'replayed', false,
    'reservation_id', p_reservation_id, 'event_id', v_event_id,
    'usage_log_id', v_meter_id, 'fulfilled_at', v_fulfilled_at,
    'document_created_at', p_document_created_at,
    'arrived_at', p_arrived_at, 'occurred_at', p_occurred_at,
    'received_at', p_received_at, 'recorded_at', v_recorded_at,
    'actor_id', p_actor_id, 'source_channel', p_source_channel
  );
end;
$$;

revoke all on function public.confirm_stock_shadow_fulfillment(
  uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.confirm_stock_shadow_fulfillment(
  uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text, text
) to service_role;

-- Backfill a readable timeline from timestamps already stored by demand,
-- reservation, stock, and meter records. Historical receive times are unknown.
insert into public.shadow_stock_events (
  event_type, idempotency_key, adapter_id, actor_type, actor_id, source_channel,
  attempt_id, occurred_at, received_at, recorded_at, metadata
)
select 'demand.requested', 'demand:' || d.attempt_id::text,
       d.demand_adapter_id, 'adapter', coalesce(a.adapter_type, d.demand_adapter_id::text),
       'demand_api', d.attempt_id, d.requested_at, null, d.recorded_at,
       '{"backfilled":true,"receive_timestamp_available":false}'::jsonb
  from public.stock_shadow_demand_attempts d
  left join system.system_adapters a on a.adapter_id = d.demand_adapter_id
on conflict (idempotency_key) do nothing;

insert into public.shadow_stock_events (
  event_type, idempotency_key, adapter_id, actor_type, actor_id, source_channel,
  attempt_id, reservation_id, movement_id, occurred_at, received_at, recorded_at, metadata
)
select 'stock.reserved', 'reservation:' || r.reservation_id::text,
       r.demand_adapter_id, 'adapter', coalesce(a.adapter_type, r.demand_adapter_id::text),
       'demand_api', r.attempt_id, r.reservation_id, r.movement_id,
       r.reserved_at, null, r.recorded_at,
       '{"backfilled":true,"receive_timestamp_available":false}'::jsonb
  from public.stock_shadow_reservations r
  left join system.system_adapters a on a.adapter_id = r.demand_adapter_id
on conflict (idempotency_key) do nothing;

insert into public.shadow_stock_events (
  event_type, idempotency_key, adapter_id, actor_type, actor_id, source_channel,
  reservation_id, movement_id, balance_observation_id, occurred_at, received_at, recorded_at, metadata
)
select 'stock.movement.recorded', 'movement:' || m.shadow_movement_id::text,
       m.adapter_id, 'adapter', coalesce(a.adapter_type, m.adapter_id::text),
       case when m.source_document_type = 'demand_reservation' then 'demand_api' else 'stock_ingest' end,
       r.reservation_id, m.shadow_movement_id, b.balance_observation_id,
       m.occurred_at, null, m.recorded_at,
       jsonb_build_object('backfilled', true, 'receive_timestamp_available', false,
         'source_document_type', m.source_document_type)
  from public.stock_shadow_movements m
  left join system.system_adapters a on a.adapter_id = m.adapter_id
  left join public.stock_shadow_reservations r on r.movement_id = m.shadow_movement_id
  left join lateral (
    select bo.balance_observation_id
      from public.stock_shadow_balance_observations bo
     where bo.adapter_id = m.adapter_id and bo.idempotency_key = m.idempotency_key
     order by bo.recorded_at desc limit 1
  ) b on true
on conflict (idempotency_key) do nothing;

insert into public.shadow_stock_events (
  event_type, idempotency_key, adapter_id, actor_type, actor_id, source_channel,
  attempt_id, reservation_id, usage_log_id, occurred_at, received_at, recorded_at, metadata
)
select 'meter.usage.recorded', 'meter:' || u.usage_log_id::text,
       u.adapter_id, 'adapter', coalesce(a.adapter_type, u.adapter_id::text),
       'demand_api', d.attempt_id, r.reservation_id, u.usage_log_id,
       coalesce(u.started_at, u.created_at), null, u.created_at,
       jsonb_build_object('backfilled', true, 'receive_timestamp_available', false,
         'operation_key', u.operation_key, 'usage_quantity', u.usage_quantity, 'usage_unit', u.usage_unit)
  from system.usage_meter_logs u
  left join system.system_adapters a on a.adapter_id = u.adapter_id
  left join public.stock_shadow_demand_attempts d on u.metadata ->> 'attempt_id' = d.attempt_id::text
  left join public.stock_shadow_reservations r on r.attempt_id = d.attempt_id
 where u.operation_key in ('demand.match_reserve', 'fulfillment.confirm_delivery')
on conflict (idempotency_key) do nothing;

comment on table public.shadow_stock_events is
  'Append-only stock workflow timeline with source/actor and occurred, received, and recorded timestamps. Historical receive times remain null when unavailable.';
comment on view public.stock_shadow_reservation_status is
  'Derived lifecycle status: RESERVED until an append-only fulfillment.confirmed event exists, then CONSUMED.';
comment on function public.confirm_stock_shadow_fulfillment(uuid, text, text, timestamptz, timestamptz, timestamptz, timestamptz, text, text, text) is
  'Atomically confirms delivery, appends a fulfillment event and one compute-unit meter record; reservation rows are not updated.';

commit;
