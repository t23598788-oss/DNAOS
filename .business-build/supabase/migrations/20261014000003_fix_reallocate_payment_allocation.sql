-- BOM-070 — Fix reallocate_payment_allocation: NULL invoice list in the FOREACH
-- (owner approved 2026-10-14 · fixes error 22004 for debt_event → debt_event re-point)
--
-- WHY: the v1.1 RPC's invoice re-projection loop did
--   FOREACH v_inv IN ARRAY (SELECT array_agg(...) FROM unnest(array[v_old_invoice, v_new_invoice]) ... WHERE x IS NOT NULL) LOOP
-- When BOTH v_old_invoice and v_new_invoice are NULL (a debt_event → debt_event move —
-- no invoice on either side), array_agg() returns NULL and FOREACH raises
-- 22004 "FOREACH expression must not be null".
--
-- FIX: guard the loop with `IF v_old_invoice IS NOT NULL OR v_new_invoice IS NOT NULL THEN`.
-- Nothing else changes: same signature, SECURITY DEFINER, search_path, guards, lock order,
-- receipt/invoice projection, audit, and return shape. This is a bug fix to the ONE
-- canonical reallocation RPC — no new writer. grants/revokes persist across
-- CREATE OR REPLACE (same rule as 20261008000001) and are not repeated here.
create or replace function public.reallocate_payment_allocation(
  p_allocation_id uuid,
  p_target_kind text,     -- invoice | standalone_document | debt_event
  p_target_id uuid,
  p_amount numeric,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a                 public.payment_allocations%rowtype;
  r                 public.receipt_documents%rowtype;
  v_amount          numeric;
  v_persisted       numeric;
  v_after           numeric;
  v_inv_company     uuid;
  v_inv_status      text;
  v_inv_receivable  numeric;
  v_inv_paid        numeric;
  v_inv_outstanding numeric;
  v_old_invoice     uuid;
  v_new_invoice     uuid;
  v_state           text;
  v_total           numeric;
  v_invoices        jsonb := '[]'::jsonb;
  v_inv             uuid;
begin
  if p_actor is null or btrim(p_actor) = '' then raise exception 'actor_required'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'reallocation_reason_required'; end if;
  if p_target_kind not in ('invoice', 'standalone_document', 'debt_event') then
    raise exception 'target_invalid';
  end if;
  if p_target_id is null then raise exception 'target_invalid'; end if;

  -- LOCK 1: the allocation row being moved
  select * into a from public.payment_allocations pa where pa.id = p_allocation_id for update;
  if not found then raise exception 'allocation_not_found'; end if;
  -- LOCK 2: its receipt
  select * into r from public.receipt_documents rd where rd.id = a.receipt_document_id for update;
  if not found then raise exception 'receipt_not_found'; end if;

  v_amount := coalesce(p_amount, a.amount);
  if v_amount <= 0 then raise exception 'allocation_amount_invalid'; end if;

  -- A11: Σ allocations of the receipt must stay <= receipt.amount (move is not new money)
  select coalesce(sum(pa.amount), 0) into v_persisted
    from public.payment_allocations pa where pa.receipt_document_id = a.receipt_document_id;
  v_after := round(v_persisted - a.amount + v_amount, 2);
  if v_after > round(coalesce(r.amount, 0), 2) then
    raise exception 'receipt_total_exceeded:%>%', v_after, r.amount;
  end if;

  -- LOCK 3: destination invoice, then revalidate from the DB
  if p_target_kind = 'invoice' then
    select i.customer_company_id, i.invoice_status::text,
           coalesce(i.net_payable, i.gross_amount, i.total_amount)
      into v_inv_company, v_inv_status, v_inv_receivable
      from public.invoices i where i.id = p_target_id for update;
    if not found then raise exception 'invoice_not_found'; end if;
    if v_inv_status = 'VOID' then raise exception 'invoice_void'; end if;
    if v_inv_company is distinct from r.customer_company_id then raise exception 'company_mismatch'; end if;

    -- outstanding EXCLUDING the row being moved (it may already sit on this invoice)
    select coalesce(sum(pa.amount), 0) into v_inv_paid
      from public.payment_allocations pa
     where pa.invoice_id = p_target_id and pa.id <> p_allocation_id;
    v_inv_outstanding := round(coalesce(v_inv_receivable, 0) - v_inv_paid, 2);
    if v_amount > v_inv_outstanding then
      raise exception 'overpayment_not_allowed:%>%', v_amount, v_inv_outstanding;
    end if;
  end if;

  v_old_invoice := a.invoice_id;
  v_new_invoice := case when p_target_kind = 'invoice' then p_target_id else null end;


  -- exactly ONE target id survives the move (DB CHECK one_target_chk)
  update public.payment_allocations
     set invoice_id            = case when p_target_kind = 'invoice' then p_target_id else null end,
         standalone_document_id = case when p_target_kind = 'standalone_document' then p_target_id else null end,
         debt_event_id          = case when p_target_kind = 'debt_event' then p_target_id else null end,
         amount                 = v_amount
   where id = p_allocation_id;

  -- receipt allocation_state from the persisted rows
  select coalesce(sum(pa.amount), 0) into v_total
    from public.payment_allocations pa where pa.receipt_document_id = a.receipt_document_id;
  v_state := case when v_total <= 0 then 'unallocated'
                  when v_total >= coalesce(r.amount, 0) then 'allocated'
                  else 'partial' end;
  update public.receipt_documents set allocation_state = v_state where id = a.receipt_document_id;

  -- refresh BOTH sides: the invoice the money left and the one it moved to
  -- (BOM-070 fix: debt_event → debt_event has no invoice on either side — guard the
  --  FOREACH so it never receives a NULL array)
  if v_old_invoice is not null or v_new_invoice is not null then
    foreach v_inv in array (select array_agg(distinct x order by x) from unnest(array[v_old_invoice, v_new_invoice]) x where x is not null) loop
      select coalesce(sum(pa.amount), 0) into v_inv_paid
        from public.payment_allocations pa
       where pa.invoice_id = v_inv and pa.allocation_kind = 'principal';
      select coalesce(i.net_payable, i.gross_amount, i.total_amount), i.invoice_status::text
        into v_inv_receivable, v_inv_status
        from public.invoices i where i.id = v_inv;
      if v_inv_status <> 'VOID' then
        v_inv_status := case when v_inv_paid >= coalesce(v_inv_receivable, 0) and coalesce(v_inv_receivable, 0) > 0 then 'PAID'
                             when v_inv_paid > 0 then 'PARTIALLY_PAID'
                             else 'SENT' end;
      end if;
      update public.invoices set paid_amount = round(v_inv_paid, 2), invoice_status = v_inv_status::public."InvoiceStatus"
       where id = v_inv;
      v_invoices := v_invoices || jsonb_build_object(
        'invoice_id', v_inv, 'paid_amount', round(v_inv_paid, 2), 'invoice_status', v_inv_status);
    end loop;
  end if;

  insert into public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  values
    (null, r.customer_company_id, 'payment_allocation', p_allocation_id::text,
     'payment.reallocated', null,
     jsonb_build_object('invoice_id', v_old_invoice, 'amount', a.amount)::text,
     jsonb_build_object(
       'value', jsonb_build_object('invoice_id', v_new_invoice, 'target_kind', p_target_kind,
                                   'target_id', p_target_id, 'amount', round(v_amount, 2)),
       'evidence', jsonb_build_object('actor', p_actor, 'reason', p_reason,
                                      'receipt_document_id', a.receipt_document_id)
     )::text,
     now());

  return jsonb_build_object(
    'allocation_id', p_allocation_id,
    'receipt_document_id', a.receipt_document_id,
    'amount', round(v_amount, 2),
    'target_kind', p_target_kind,
    'target_id', p_target_id,
    'receipt_allocation_state', v_state,
    'receipt_allocated_total', round(v_total, 2),
    'invoices', v_invoices
  );
end;
$$;
