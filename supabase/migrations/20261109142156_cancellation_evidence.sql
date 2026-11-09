-- Fault-based cancellation (2026-11-09).
--
-- Owner's rule: DNA OS is a Tool, not a Judge — it routes the money and
-- records the proof, it does not arbitrate.
--   CUSTOMER_FAULT -> customer pays the stage-based deduction
--   SELLER_FAULT   -> seller pays ALL costs (full refund, customer pays 0)
--
-- This migration:
--   1. adds the two cancelled-with-refund statuses to CustomerOrderStatus
--   2. creates the cancellation_evidence table (proof + reason per decision)

-- 1. Cancel-with-refund statuses.
do $$
begin
  alter type public."CustomerOrderStatus" add value if not exists 'CANCELLED_REFUNDED' after 'CANCELLED';
  alter type public."CustomerOrderStatus" add value if not exists 'CANCELLED_PARTIAL_REFUND' after 'CANCELLED_REFUNDED';
exception when others then
  -- 42710 = duplicate_object (enum value already present)
  if sqlstate <> '42710' then
    raise;
  end if;
end
$$;

-- 2. Cancellation evidence — why an order was cancelled and the proof held.
--
--   id          uuid
--   order_id    uuid  (FK -> customer_orders.id)
--   reason_type text  ('CUSTOMER_FAULT' | 'SELLER_FAULT')
--   proof_url   text  (required by the worker for SELLER_FAULT)
--   reason_text text
--   created_at  timestamptz
create table if not exists public.cancellation_evidence (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  reason_type text not null check (reason_type in ('CUSTOMER_FAULT', 'SELLER_FAULT')),
  proof_url text,
  reason_text text,
  created_at timestamptz not null default now(),
  constraint fk_cancellation_evidence_order foreign key (order_id)
    references public.customer_orders (id) on delete cascade
);

create index if not exists idx_cancellation_evidence_order
  on public.cancellation_evidence (order_id);
create index if not exists idx_cancellation_evidence_reason_type
  on public.cancellation_evidence (reason_type);
create index if not exists idx_cancellation_evidence_created_at
  on public.cancellation_evidence (created_at desc);
