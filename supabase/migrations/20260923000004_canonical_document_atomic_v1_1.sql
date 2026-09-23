-- ============================================================================
-- DNA OS — canonical document creation, atomic (v1.1) — PHASE E
--
-- PROMOTION, not duplication: the existing public.confirm_invoice()
-- (supabase/migrations/20260717000003_invoice_items.sql) already owns the
-- Postgres single-transaction invariant this system needs for invoice creation.
-- This migration raises that same function to the canonical document contract
-- and makes it the DB atomic primitive *underneath* the canonical authority
-- (engines/canonical/document-write.ts#createDocument) — it stops being a
-- second, parallel application authority.
--
-- Preserved exactly: same function name (no second RPC), same transaction and
-- rollback behaviour, same header + line-items writes, same GENERATED
-- line_total (never hand-written), same privilege posture (service_role only).
-- Added (canonical columns the TS layer already computes): discount_amount,
-- vat_mode, gross_amount, wht_rate, wht_amount, net_payable, data_completeness,
-- reference_no, project_id, customer_order_id, due_date, caller status, and
-- version 1 (document_versions) INSIDE the same transaction — the canonical
-- contract requires every document to carry a version, so a document that
-- committed without one would be incomplete by contract (PHASE E §5).
--
-- Migration history is NOT touched: 20260717000003 stays exactly as written.
-- Only the OLD FUNCTION SIGNATURE is dropped, so exactly one live definition
-- remains (otherwise CREATE OR REPLACE would leave an overload behind).
--
-- NOT APPLIED to any live/staging database. Local proof only.
-- ============================================================================

drop function if exists public.confirm_invoice(
  text, uuid, date, numeric, numeric, numeric, numeric, text, jsonb
);

create or replace function public.confirm_invoice(
  p_invoice_no text,
  p_customer_company_id uuid,
  p_invoice_date date,
  p_vat_rate numeric,
  p_subtotal numeric,
  p_vat_amount numeric,
  p_total_amount numeric,
  p_notes text,
  p_items jsonb,
  p_status text default 'DRAFT',
  p_discount_amount numeric default 0,
  p_vat_mode text default 'exclusive',
  p_gross_amount numeric default null,
  p_wht_rate numeric default 0,
  p_wht_amount numeric default 0,
  p_net_payable numeric default null,
  p_data_completeness text default 'FULL',
  p_reference_no text default null,
  p_project_id uuid default null,
  p_customer_order_id uuid default null,
  p_due_date date default null,
  p_actor text default null,
  p_version_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
  v_item jsonb;
  v_sort int := 0;
  v_version_id uuid;
  v_version_no int := 0;
  v_prev uuid;
begin
  -- 1) header — every canonical money column comes from the TS ladder
  --    (computeCanonicalTotals). This function NEVER recomputes money.
  insert into public.invoices (
    invoice_no, customer_company_id, invoice_date, due_date,
    reference_no, notes, project_id, customer_order_id,
    invoice_status,
    subtotal, discount_amount, vat_mode, vat_rate, vat_amount,
    gross_amount, total_amount, wht_rate, wht_amount, net_payable,
    data_completeness, updated_at
  ) values (
    p_invoice_no, p_customer_company_id, p_invoice_date, p_due_date,
    p_reference_no, p_notes, p_project_id, p_customer_order_id,
    -- invoice_status is a real Postgres ENUM (InvoiceStatus), so the caller's
    -- text status must be cast explicitly — found live by the PHASE E proof
    -- run (without the cast every call failed at the header insert).
    coalesce(p_status, 'DRAFT')::public."InvoiceStatus",
    p_subtotal, coalesce(p_discount_amount, 0), coalesce(p_vat_mode, 'exclusive'),
    coalesce(p_vat_rate, 0), coalesce(p_vat_amount, 0),
    coalesce(p_gross_amount, p_total_amount), p_total_amount,
    coalesce(p_wht_rate, 0), coalesce(p_wht_amount, 0),
    coalesce(p_net_payable, p_total_amount),
    coalesce(p_data_completeness, 'FULL'), now()
  ) returning id into v_invoice_id;

  -- 2) line items — real rows only (D2: never a fake row derived from a total)
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.invoice_items (invoice_id, description, qty, unit, unit_price, sort_order)
    values (
      v_invoice_id,
      v_item->>'description',
      coalesce((v_item->>'qty')::numeric, 1),
      coalesce(v_item->>'unit', 'รายการ'),
      coalesce((v_item->>'unit_price')::numeric, (v_item->>'unitPrice')::numeric, 0),
      coalesce((v_item->>'sort_order')::int, v_sort)
    );
    v_sort := v_sort + 1;
  end loop;

  -- 3) initial version — same transaction, so a document without a version can
  --    never commit. The snapshot shape is built by the canonical TS layer
  --    (single source for the snapshot contract), not re-derived here.
  select dv.id, dv.version_no into v_prev, v_version_no
    from public.document_versions dv
   where dv.invoice_id = v_invoice_id
   order by dv.version_no desc
   limit 1;
  v_version_no := coalesce(v_version_no, 0) + 1;

  insert into public.document_versions (
    invoice_id, version_no, previous_version_id, status, data_completeness, snapshot, created_by
  ) values (
    v_invoice_id, v_version_no, v_prev, 'active',
    coalesce(p_data_completeness, 'FULL'),
    coalesce(p_version_snapshot, '{}'::jsonb),
    p_actor
  ) returning id into v_version_id;

  return jsonb_build_object(
    'document_id', v_invoice_id,
    'status', coalesce(p_status, 'DRAFT'),
    'version_id', v_version_id,
    'version_no', v_version_no,
    'items_written', v_sort
  );
end;
$$;

-- Same privilege posture as the pre-promotion definition (service_role only).
revoke all on function public.confirm_invoice(
  text, uuid, date, numeric, numeric, numeric, numeric, text, jsonb,
  text, numeric, text, numeric, numeric, numeric, numeric, text,
  text, uuid, uuid, date, text, jsonb
) from public;
do $grant$
begin
  -- Supabase roles exist in production; a plain local Postgres may not have them.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.confirm_invoice(text, uuid, date, numeric, numeric, numeric, numeric, text, jsonb, text, numeric, text, numeric, numeric, numeric, numeric, text, text, uuid, uuid, date, text, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.confirm_invoice(text, uuid, date, numeric, numeric, numeric, numeric, text, jsonb, text, numeric, text, numeric, numeric, numeric, numeric, text, text, uuid, uuid, date, text, jsonb) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.confirm_invoice(text, uuid, date, numeric, numeric, numeric, numeric, text, jsonb, text, numeric, text, numeric, numeric, numeric, numeric, text, text, uuid, uuid, date, text, jsonb) to service_role';
  end if;
end
$grant$;

