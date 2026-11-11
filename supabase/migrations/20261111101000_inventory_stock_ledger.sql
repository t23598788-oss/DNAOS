-- Automated Inventory & Stock Sync — append-only ledger + atomic deduction.
--
-- Owner expansion 2026-11-11: when a canonical Resource Transaction is written,
-- the material it consumed must leave the central stock immediately. The stock
-- authority itself already exists (public.inventory, 20261103000002), so this
-- migration adds only what was missing:
--
--   1. public.stock_movements — one immutable row per deduction, keyed by the
--      SOURCE event. (source, source_event_id) is unique, so a retried
--      resource transaction can never deduct twice.
--   2. public.apply_inventory_deduction_atomic(...) — the ONE write path:
--      row lock on inventory, unit match, insufficient-stock refusal,
--      update + movement insert in one transaction. Negative stock is
--      impossible because the check happens while the row is locked.
--
-- No business values (rates, prices, thresholds) live here. Called only by
-- engines/canonical/stock-write.ts, which owns validation + canonical audit.
--
-- Status: APPLIED 2026-11-11 to the linked project (supabase db query, then
-- migration repair --status applied). Verified post-apply: table, RPC, RLS and
-- service_role-only grants exist; inventory had 0 rows at apply time, so no
-- existing stock row was touched.

create table if not exists public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  pit_profile_id    uuid not null references public.pit_profiles (id) on delete restrict,
  material_type_id  uuid not null references public.material_types (id) on delete restrict,
  quantity_delta    numeric not null check (quantity_delta > 0),
  unit              text not null check (unit in ('CUBIC', 'TON')),
  quantity_before   numeric not null check (quantity_before >= 0),
  quantity_after    numeric not null check (quantity_after >= 0),
  source            text not null,
  source_event_id   text not null,
  job_id            uuid references public.jobs (id) on delete set null,
  actor             text not null,
  created_at        timestamptz not null default now(),
  unique (source, source_event_id)
);

create index if not exists stock_movements_pit_material_idx
  on public.stock_movements (pit_profile_id, material_type_id, created_at desc);

alter table public.stock_movements enable row level security;
drop policy if exists service_role_only on public.stock_movements;
create policy service_role_only on public.stock_movements for all using (false);

create or replace function public.apply_inventory_deduction_atomic(
  p_pit_profile_id  uuid,
  p_material_type_id uuid,
  p_quantity        numeric,
  p_unit            text,
  p_source          text,
  p_source_event_id text,
  p_job_id          uuid default null,
  p_actor           text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.stock_movements%rowtype;
  v_qty      numeric;
  v_unit     text;
  v_after    numeric;
  v_id       uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'STOCK_QUANTITY_INVALID: quantity ต้องมากกว่า 0 (ได้ %)', p_quantity;
  end if;
  if p_unit is null or p_unit not in ('CUBIC', 'TON') then
    raise exception 'STOCK_UNIT_INVALID: unit ต้องเป็น CUBIC หรือ TON (ได้ %)', p_unit;
  end if;
  if coalesce(btrim(p_source), '') = '' or coalesce(btrim(p_source_event_id), '') = '' then
    raise exception 'STOCK_SOURCE_EVENT_REQUIRED: ต้องมี source และ source_event_id';
  end if;
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'AUDIT_ACTOR_REQUIRED: every canonical write must carry an actor';
  end if;

  -- Idempotency first: the same source event is never deducted twice.
  select * into v_existing
  from public.stock_movements
  where source = p_source and source_event_id = p_source_event_id
  for update;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'movement_id', v_existing.id,
      'quantity_before', v_existing.quantity_before,
      'quantity_after', v_existing.quantity_after
    );
  end if;

  -- Lock the stock row, then verify unit + availability while locked.
  select quantity_available, unit into v_qty, v_unit
  from public.inventory
  where pit_profile_id = p_pit_profile_id
    and material_type_id = p_material_type_id
  for update;

  if not found then
    raise exception 'STOCK_ROW_NOT_FOUND: ไม่พบสต็อกของบ่อ % วัสดุ %', p_pit_profile_id, p_material_type_id;
  end if;
  if v_unit <> p_unit then
    raise exception 'STOCK_UNIT_MISMATCH: หน่วยสต็อก % ไม่ตรงกับที่ตัด %', v_unit, p_unit;
  end if;
  if v_qty < p_quantity then
    raise exception 'STOCK_INSUFFICIENT: คงเหลือ % % แต่ต้องตัด %', v_qty, v_unit, p_quantity;
  end if;

  v_after := v_qty - p_quantity;

  update public.inventory
     set quantity_available = v_after,
         updated_by = p_actor,
         last_updated_at = now()
   where pit_profile_id = p_pit_profile_id
     and material_type_id = p_material_type_id;

  insert into public.stock_movements (
    pit_profile_id, material_type_id, quantity_delta, unit,
    quantity_before, quantity_after, source, source_event_id, job_id, actor
  ) values (
    p_pit_profile_id, p_material_type_id, p_quantity, p_unit,
    v_qty, v_after, p_source, p_source_event_id, p_job_id, p_actor
  ) returning id into v_id;

  return jsonb_build_object(
    'duplicate', false,
    'movement_id', v_id,
    'quantity_before', v_qty,
    'quantity_after', v_after
  );
end;
$$;

revoke all on function public.apply_inventory_deduction_atomic(uuid, uuid, numeric, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_inventory_deduction_atomic(uuid, uuid, numeric, text, text, text, uuid, text) to service_role;

comment on table public.stock_movements is
  'Append-only material deductions from public.inventory. (source, source_event_id) is unique so a retried canonical write is idempotent.';
comment on function public.apply_inventory_deduction_atomic(uuid, uuid, numeric, text, text, text, uuid, text) is
  'The only write path that reduces inventory. Locks the row, refuses negative stock and unit mismatch, inserts one movement + update in the same transaction.';
