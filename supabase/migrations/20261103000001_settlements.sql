-- settlements: one row per completed transaction. Records what the customer
-- paid, the platform fee rate applied at that moment, and what the partner
-- received. The rate is snapshotted so historical rows never change when
-- config changes.
-- Created 2026-11-03.

create table if not exists public.settlements (
  id                uuid primary key default gen_random_uuid(),

  provider          text not null default 'kbank',
  bank_reference    text,
  payment_callback_id uuid references public.payment_callbacks(id) on delete set null,

  source_type       text not null check (source_type in ('business_event','contract','manual')),
  source_id         uuid,
  partner_id        uuid references public.partners(id) on delete set null,

  customer_paid     numeric(14,2) not null check (customer_paid >= 100),
  fee_rate          numeric(6,4)  not null check (fee_rate >= 0 and fee_rate <= 0.5),
  platform_fee      numeric(14,2) not null check (platform_fee >= 0),
  partner_paid      numeric(14,2) not null check (partner_paid >= 0),
  currency          text not null default 'THB' check (currency ~ '^[A-Z]{3}$'),

  status            text not null default 'pending'
                    check (status in ('pending','partner_paid','failed','reversed')),
  settled_at        timestamptz,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint settlements_math_consistent
    check (abs((customer_paid - platform_fee) - partner_paid) < 0.01)
);

create index if not exists settlements_source_idx
  on public.settlements (source_type, source_id);
create index if not exists settlements_partner_idx
  on public.settlements (partner_id, created_at desc);
create index if not exists settlements_status_idx
  on public.settlements (status, created_at desc);

create or replace function public.touch_settlements_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_settlements_touch on public.settlements;
create trigger trg_settlements_touch
  before update on public.settlements
  for each row execute function public.touch_settlements_updated_at();

-- 1. Financial amounts on settlements are immutable after insert.
create or replace function public.settlements_amounts_immutable()
returns trigger language plpgsql as $$
begin
  if (new.customer_paid <> old.customer_paid)
     or (new.fee_rate <> old.fee_rate)
     or (new.platform_fee <> old.platform_fee)
     or (new.partner_paid <> old.partner_paid) then
    raise exception 'SETTLEMENT_AMOUNTS_IMMUTABLE: cannot change customer_paid/fee_rate/platform_fee/partner_paid after creation'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_settlements_immutable on public.settlements;
create trigger trg_settlements_immutable
  before update on public.settlements
  for each row execute function public.settlements_amounts_immutable();

-- 2. Status may only move forward.
create or replace function public.settlements_status_forward()
returns trigger language plpgsql as $$
declare
  allowed boolean;
begin
  if new.status = old.status then return new; end if;
  allowed := (old.status = 'pending' and new.status in ('partner_paid','failed'))
          or (old.status = 'partner_paid' and new.status = 'reversed')
          or (old.status = 'failed' and new.status = 'reversed');
  if not allowed then
    raise exception 'SETTLEMENT_STATUS_ILLEGAL_TRANSITION: % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_settlements_status on public.settlements;
create trigger trg_settlements_status
  before update on public.settlements
  for each row execute function public.settlements_status_forward();

-- 3. payment_callbacks status also forward-only.
create or replace function public.payment_callbacks_status_forward()
returns trigger language plpgsql as $$
declare
  allowed boolean;
begin
  if new.status = old.status then return new; end if;
  allowed := (old.status = 'pending_bank_confirmation' and new.status in ('confirmed','failed'))
          or (old.status = 'confirmed' and new.status = 'refunded');
  if not allowed then
    raise exception 'PAYMENT_CALLBACK_STATUS_ILLEGAL: % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_payment_callbacks_status on public.payment_callbacks;
create trigger trg_payment_callbacks_status
  before update on public.payment_callbacks
  for each row execute function public.payment_callbacks_status_forward();

alter table public.settlements enable row level security;

drop policy if exists settlements_service_all on public.settlements;
create policy settlements_service_all on public.settlements
  for all to service_role using (true) with check (true);

drop policy if exists settlements_authenticated_read on public.settlements;
create policy settlements_authenticated_read on public.settlements
  for select to authenticated using (true);
