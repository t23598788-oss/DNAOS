-- payment_callbacks: bridge table mapping a bank transaction to a business document.
-- Created 2026-11-03.
--
-- This file is split out so that a fresh environment can create BOTH
-- payment_callbacks and settlements in the correct order (settlements
-- references payment_callbacks via payment_callback_id).
--
-- The table already exists in production (applied from the Management API
-- before this file was split out). This file is a defensive re-creation:
-- create table ... if not exists + drop/create policies, so it is safe to
-- run on an existing instance that already has the table.

create table if not exists public.payment_callbacks (
  id                      uuid primary key default gen_random_uuid(),
  provider                text not null,
  provider_transaction_id text not null,
  connector_id            uuid references public.connectors(id) on delete set null,
  webhook_event_id        uuid references public.connector_webhook_events(id) on delete set null,

  amount                  numeric(14,2) not null,
  currency                text not null default 'THB',
  status                  text not null default 'pending_bank_confirmation',

  invoice_id              uuid references public.invoices(id) on delete restrict,
  standalone_document_id  uuid references public.standalone_documents(id) on delete restrict,
  receipt_document_id     uuid references public.receipt_documents(id) on delete restrict,
  debt_event_id           uuid references public.debt_events(id) on delete restrict,

  matched_bank_reference  text,
  raw_payload             jsonb not null,
  received_at             timestamptz not null default now(),
  created_by              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint payment_callbacks_provider_txn_unique unique (provider, provider_transaction_id),
  constraint payment_callbacks_amount_positive    check (amount > 0),
  constraint payment_callbacks_currency_format     check (currency ~ '^[A-Z]{3}$'),
  constraint payment_callbacks_status_valid        check (status in ('pending_bank_confirmation','confirmed','failed','refunded')),

  constraint payment_callbacks_exactly_one_document check (
    (case when invoice_id             is not null then 1 else 0 end) +
    (case when standalone_document_id is not null then 1 else 0 end) +
    (case when receipt_document_id    is not null then 1 else 0 end) +
    (case when debt_event_id          is not null then 1 else 0 end) = 1
  )
);

create index if not exists payment_callbacks_provider_idx
  on public.payment_callbacks (provider, status, received_at desc);

create index if not exists payment_callbacks_invoice_idx
  on public.payment_callbacks (invoice_id) where invoice_id is not null;

create index if not exists payment_callbacks_receipt_idx
  on public.payment_callbacks (receipt_document_id) where receipt_document_id is not null;

create index if not exists payment_callbacks_connector_idx
  on public.payment_callbacks (connector_id) where connector_id is not null;

create index if not exists payment_callbacks_webhook_idx
  on public.payment_callbacks (webhook_event_id) where webhook_event_id is not null;

-- RLS: service role full access; authenticated admin read-only; anon denied.
alter table public.payment_callbacks enable row level security;

drop policy if exists payment_callbacks_service_all on public.payment_callbacks;
create policy payment_callbacks_service_all on public.payment_callbacks
  for all to service_role using (true) with check (true);

drop policy if exists payment_callbacks_authenticated_read on public.payment_callbacks;
create policy payment_callbacks_authenticated_read on public.payment_callbacks
  for select to authenticated using (true);
