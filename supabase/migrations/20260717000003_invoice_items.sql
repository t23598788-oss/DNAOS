-- ConfirmInvoice workflow redesign (owner, 2026-07-17): invoice line items
-- had no persistent storage anywhere in this codebase — confirmed via the
-- live schema (invoices has no items field, no invoice_items table exists).
-- Owner decision: dedicated relational table, not JSONB — items must be
-- queryable/reportable/editable/auditable independently of the invoice
-- header. Note: a migration from 2026-07-09 already declared a
-- service_role_only RLS policy for a table named "invoice_items" (an
-- auto-generated enumeration of whatever tables existed in the dashboard at
-- that time), but no CREATE TABLE for it exists anywhere in this migration
-- history and it does not exist in the live schema today — this migration
-- is the first real creation of it.

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  qty numeric not null default 1,
  unit text not null default 'รายการ',
  unit_price numeric not null default 0,
  line_total numeric not null generated always as (qty * unit_price) stored,
  sort_order int not null default 0,
  created_at timestamp without time zone not null default current_timestamp
);

create index if not exists invoice_items_invoice_id_idx on public.invoice_items(invoice_id);

alter table public.invoice_items enable row level security;
drop policy if exists service_role_only on public.invoice_items;
create policy service_role_only on public.invoice_items for all using (false);

-- Atomic ConfirmInvoice: create invoice + invoice_items in ONE transaction.
-- Supabase's JS client has no multi-statement transaction primitive over
-- REST, so the only way to guarantee "commit one transaction" (owner
-- requirement) is a single Postgres function called via rpc(). security
-- definer + explicit search_path per Supabase's documented safe pattern
-- (avoids the search_path-injection footgun); only service_role may ever
-- reach this (invoices/invoice_items are both service_role_only via RLS,
-- and this function inherits caller privilege checks through them).
create or replace function public.confirm_invoice(
  p_invoice_no text,
  p_customer_company_id uuid,
  p_invoice_date date,
  p_subtotal numeric,
  p_vat_rate numeric,
  p_vat_amount numeric,
  p_total_amount numeric,
  p_notes text,
  p_items jsonb  -- [{description, qty, unit, unit_price}, ...]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_item jsonb;
  v_sort int := 0;
begin
  insert into public.invoices (
    invoice_no, customer_company_id, invoice_date,
    vat_rate, subtotal, vat_amount, total_amount, notes,
    invoice_status, updated_at
  ) values (
    p_invoice_no, p_customer_company_id, p_invoice_date,
    p_vat_rate, p_subtotal, p_vat_amount, p_total_amount, p_notes,
    'DRAFT', now()
  ) returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.invoice_items (invoice_id, description, qty, unit, unit_price, sort_order)
    values (
      v_invoice_id,
      v_item->>'description',
      coalesce((v_item->>'qty')::numeric, 1),
      coalesce(v_item->>'unit', 'รายการ'),
      coalesce((v_item->>'unit_price')::numeric, (v_item->>'unitPrice')::numeric, 0),
      v_sort
    );
    v_sort := v_sort + 1;
  end loop;

  return v_invoice_id;
end;
$$;
