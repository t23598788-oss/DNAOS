-- CONFIRM PAYMENT ANCHOR — principal-only booking (BATCH 35, owner 2026-10-08)
--
-- WHY: the v1.1 anchor event amount was Σ ALL anchor allocations of the receipt
-- (principal + penalty), while engines/canonical/receipt-confirm-flow.ts ALSO appends
-- a separate interest_penalty_received row for the penalty part. The penalty money was
-- therefore booked TWICE against the ledger: for the real incident (receipt
-- 0722ae13-2309-4e01-b640-6e8a6b9256d9, ฿10,000 on debt of ฿5,500) the RPC wrote
-- receipt_received(10,000 = 5,500 principal + 4,500 penalty) PLUS
-- interest_penalty_received(4,500) → the snapshot fell to −9,000 instead of −4,500
-- (the honest over-paid balance). Double-count = the 4,500 penalty.
--
-- FIX (matches the legacy reconcile_receipt_payment contract the flow inherited:
-- "legacy RPC เขียน receipt_received(principal)"): the anchor debt event now books
--   · receipt_received          → Σ anchor allocations with allocation_kind = 'principal'
--   · interest_penalty_received → Σ anchor allocations that are NOT principal
--   · neither sum > 0           → legacy fallback to Σ ALL anchor allocations
--     (principal-less direct calls keep the old total basis; the canonical flow can
--      never reach this branch — its principal allocation is validated > 0 first)
-- Money booked on the ledger therefore always equals money received: anchor event
-- + the flow's separate penalty event = principal + penalty = the receipt total.
--
-- Same signature, same security model, same lock order, same guards as v1.1 —
-- grants/revokes persist across CREATE OR REPLACE and are not repeated here.
-- Owner approval for touching the payment RPC: batch 35 instruction
-- ("แก้ double-count ให้ยอดหนี้ถูกก่อน").
create or replace function public.confirm_payment_allocation(
  p_receipt_document_id uuid,
  p_allocations jsonb,
  p_actor text,
  p_debt_event_anchor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt           public.receipt_documents%rowtype;
  v_existing_total    numeric;
  v_total             numeric;
  v_alloc             jsonb;
  v_target_kind       text;
  v_target_id         uuid;
  v_kind              text;
  v_amount            numeric;
  v_note              text;
  v_invoice_ids       uuid[];
  v_inv_company       uuid;
  v_inv_status        text;
  v_inv_receivable    numeric;
  v_inv_paid          numeric;
  v_inv_outstanding   numeric;
  v_requested         numeric;
  v_anchor_amount     numeric;
  v_anchor_id         uuid;
  v_allocation_ids    uuid[] := '{}';
  v_new_id            uuid;
  v_state             text;
  v_invoices          jsonb := '[]'::jsonb;
  v_ledger            numeric;
  v_snapshot_state    text;
begin
  if p_actor is null or btrim(p_actor) = '' then
    raise exception 'actor_required';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'allocation_required';
  end if;
  if p_debt_event_anchor is not null
     and p_debt_event_anchor not in ('receipt_received', 'interest_penalty_received') then
    raise exception 'anchor_event_type_invalid';
  end if;

  -- ── LOCK 1: the receipt row. Every read below happens AFTER this lock. ──────
  select * into v_receipt from public.receipt_documents rd
   where rd.id = p_receipt_document_id for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if v_receipt.document_type not in ('transfer_slip', 'payment_advice') then
    raise exception 'receipt_not_eligible';
  end if;
  if v_receipt.amount is null then raise exception 'receipt_amount_required'; end if;

  select coalesce(sum(pa.amount), 0) into v_existing_total
    from public.payment_allocations pa
   where pa.receipt_document_id = p_receipt_document_id;
  if v_existing_total > 0 then raise exception 'receipt_already_allocated'; end if;

  -- ── shape + target validation, and the sorted invoice id set to lock ───────
  v_invoice_ids := '{}';
  for v_alloc in select * from jsonb_array_elements(p_allocations) loop
    v_target_kind := v_alloc->>'target_kind';
    v_kind        := v_alloc->>'allocation_kind';
    v_amount      := coalesce(nullif(v_alloc->>'amount', '')::numeric, 0);
    v_target_id   := nullif(v_alloc->>'target_id', '')::uuid;
    if v_kind not in ('principal', 'interest', 'penalty', 'other') then
      raise exception 'allocation_kind_invalid';
    end if;
    if v_amount <= 0 then raise exception 'allocation_amount_invalid'; end if;
    if v_target_kind = 'invoice' then
      if v_target_id is null then raise exception 'target_invalid'; end if;
      v_invoice_ids := v_invoice_ids || v_target_id;
    elsif v_target_kind = 'standalone_document' then
      if v_target_id is null then raise exception 'target_invalid'; end if;
    elsif v_target_kind = 'anchor' then
      if p_debt_event_anchor is null then raise exception 'anchor_required'; end if;
    else
      raise exception 'target_invalid';
    end if;
  end loop;

  v_total := (select coalesce(sum((a->>'amount')::numeric), 0) from jsonb_array_elements(p_allocations) a);
  if v_total <= 0 then raise exception 'allocation_amount_invalid'; end if;
  -- A5: Σ allocations of this receipt must never exceed the receipt's canonical amount
  if v_total > v_receipt.amount then
    raise exception 'receipt_total_exceeded:%>%', v_total, v_receipt.amount;
  end if;

  -- ── LOCK 2: target invoices, sorted by id (deterministic order) ────────────
  if coalesce(array_length(v_invoice_ids, 1), 0) > 0 then
    perform 1 from public.invoices i
       where i.id = any (v_invoice_ids)
       order by i.id
         for update;
  end if;


  -- ── A6/A7/A8/A9 revalidated from the DB AFTER both locks ───────────────────
  if coalesce(array_length(v_invoice_ids, 1), 0) > 0 then
    foreach v_target_id in array v_invoice_ids loop
      select i.customer_company_id,
             i.invoice_status,
             coalesce(i.net_payable, i.gross_amount, i.total_amount)
        into v_inv_company, v_inv_status, v_inv_receivable
        from public.invoices i where i.id = v_target_id;
      if not found then raise exception 'invoice_not_found'; end if;
      if v_inv_status = 'VOID' then raise exception 'invoice_void'; end if;
      if v_inv_company is distinct from v_receipt.customer_company_id then
        raise exception 'company_mismatch';
      end if;

      select coalesce(sum(pa.amount), 0) into v_inv_paid
        from public.payment_allocations pa where pa.invoice_id = v_target_id;
      v_inv_outstanding := round(coalesce(v_inv_receivable, 0) - v_inv_paid, 2);

      v_requested := (
        select coalesce(sum((a->>'amount')::numeric), 0)
          from jsonb_array_elements(p_allocations) a
         where a->>'target_kind' = 'invoice' and nullif(a->>'target_id', '')::uuid = v_target_id
      );
      -- A9: never allow invoice overpayment — no clamp, no penalty, no re-routing
      if v_requested > v_inv_outstanding then
        raise exception 'overpayment_not_allowed:%>%', v_requested, v_inv_outstanding;
      end if;
    end loop;
  end if;

  -- ── LOCK 3 (only when a ledger event is created): the company's snapshot ───
  if p_debt_event_anchor is not null then
    -- BATCH 35 (principal-only booking): the anchor event books only the part of
    -- the money it represents — receipt_received = principal, a penalty-anchored
    -- event = everything that is not principal — so the canonical flow's separate
    -- interest_penalty_received row never counts the penalty twice.
    if p_debt_event_anchor = 'receipt_received' then
      v_anchor_amount := (
        select coalesce(sum((a->>'amount')::numeric), 0)
          from jsonb_array_elements(p_allocations) a
         where a->>'target_kind' = 'anchor' and a->>'allocation_kind' = 'principal'
      );
    else
      v_anchor_amount := (
        select coalesce(sum((a->>'amount')::numeric), 0)
          from jsonb_array_elements(p_allocations) a
         where a->>'target_kind' = 'anchor' and a->>'allocation_kind' <> 'principal'
      );
    end if;
    if v_anchor_amount <= 0 then
      -- legacy fallback: this call carries no matching allocation kind → old total basis
      v_anchor_amount := (
        select coalesce(sum((a->>'amount')::numeric), 0)
          from jsonb_array_elements(p_allocations) a where a->>'target_kind' = 'anchor'
      );
    end if;
    if v_anchor_amount <= 0 then raise exception 'anchor_amount_required'; end if;
    insert into public.debt_events
      (customer_company_id, event_type, amount, occurred_at, note, source, created_by)
    values
      (v_receipt.customer_company_id, p_debt_event_anchor, v_anchor_amount, current_date,
       v_receipt.reference_number, 'payment_confirmation', p_actor)
    returning id into v_anchor_id;
    perform 1 from public.debt_snapshots ds
       where ds.customer_company_id = v_receipt.customer_company_id for update;
  end if;

  -- ── atomic mutation: exactly ONE target id per row (DB CHECK enforced) ─────
  for v_alloc in select * from jsonb_array_elements(p_allocations) loop
    v_target_kind := v_alloc->>'target_kind';
    v_amount      := (v_alloc->>'amount')::numeric;
    v_note        := v_alloc->>'note';
    v_new_id      := null;
    insert into public.payment_allocations
      (receipt_document_id, invoice_id, standalone_document_id, debt_event_id,
       allocation_kind, amount, allocated_by, note)
    values
      (p_receipt_document_id,
       case when v_target_kind = 'invoice' then nullif(v_alloc->>'target_id', '')::uuid else null end,
       case when v_target_kind = 'standalone_document' then nullif(v_alloc->>'target_id', '')::uuid else null end,
       case when v_target_kind = 'anchor' then v_anchor_id else null end,
       v_alloc->>'allocation_kind', v_amount, p_actor, v_note)
    returning id into v_new_id;
    v_allocation_ids := v_allocation_ids || v_new_id;
  end loop;

  -- receipt allocation_state = Σ allocations vs the receipt's own amount
  select coalesce(sum(pa.amount), 0) into v_total
    from public.payment_allocations pa where pa.receipt_document_id = p_receipt_document_id;
  v_state := case when v_total <= 0 then 'unallocated'
                  when v_total >= v_receipt.amount then 'allocated'
                  else 'partial' end;
  update public.receipt_documents set allocation_state = v_state where id = p_receipt_document_id;


  -- invoice projections recomputed from the allocation rows (canonical basis)
  if coalesce(array_length(v_invoice_ids, 1), 0) > 0 then
    foreach v_target_id in array v_invoice_ids loop
      select coalesce(sum(pa.amount), 0) into v_inv_paid
        from public.payment_allocations pa
       where pa.invoice_id = v_target_id and pa.allocation_kind = 'principal';
      select coalesce(i.net_payable, i.gross_amount, i.total_amount), i.invoice_status::text
        into v_inv_receivable, v_inv_status
        from public.invoices i where i.id = v_target_id;
      if v_inv_status <> 'VOID' then
        v_inv_status := case when v_inv_paid >= coalesce(v_inv_receivable, 0) and coalesce(v_inv_receivable, 0) > 0 then 'PAID'
                             when v_inv_paid > 0 then 'PARTIALLY_PAID'
                             else v_inv_status end;
      end if;
      update public.invoices set paid_amount = round(v_inv_paid, 2), invoice_status = v_inv_status::public."InvoiceStatus"
       where id = v_target_id;
      v_invoices := v_invoices || jsonb_build_object(
        'invoice_id', v_target_id, 'paid_amount', round(v_inv_paid, 2), 'invoice_status', v_inv_status);
    end loop;
  end if;

  -- debt snapshot projection from the ledger only (never derived from invoice AR)
  if p_debt_event_anchor is not null then
    select coalesce(sum(case de.event_type
                          when 'debt_started' then coalesce(de.amount, 0)
                          when 'manual_adjustment' then coalesce(de.amount, 0)
                          when 'manual_interest_adjustment' then coalesce(de.amount, 0)
                          when 'receipt_received' then -coalesce(de.amount, 0)
                          when 'interest_penalty_received' then -coalesce(de.amount, 0)
                          else 0 end), 0)
      into v_ledger
      from public.debt_events de where de.customer_company_id = v_receipt.customer_company_id;
    update public.debt_snapshots
       set total_outstanding = round(v_ledger, 2),
           collection_state = (case when v_ledger <= 0 then 'CLOSED' else 'CURRENT' end)::public."CollectionState",
           updated_at = now()
     where customer_company_id = v_receipt.customer_company_id;
  end if;

  -- evidence: audit_logs is the single audit owner; the actor travels inside the
  -- evidence text because the table has no actor text column (same shape
  -- recordCanonicalAudit writes: actor_user_id null + new_value JSON text)
  insert into public.audit_logs
    (actor_user_id, company_id, entity_type, entity_id, action, field, old_value, new_value, created_at)
  values
    (null, v_receipt.customer_company_id, 'receipt_document', p_receipt_document_id::text,
     'payment.allocated', null, null,
     jsonb_build_object(
       'value', jsonb_build_object(
         'allocations', jsonb_array_length(p_allocations),
         'total', round(v_total, 2),
         'allocation_state', v_state),
       'evidence', jsonb_build_object(
         'actor', p_actor,
         'allocation_ids', to_jsonb(v_allocation_ids),
         'debt_event_id', v_anchor_id,
         'media_path', v_receipt.media_path)
     )::text,
     now());

  return jsonb_build_object(
    'receipt_document_id', p_receipt_document_id,
    'allocations_written', jsonb_array_length(p_allocations),
    'allocation_ids', to_jsonb(v_allocation_ids),
    'debt_event_id', v_anchor_id,
    'receipt_allocation_state', v_state,
    'invoices', v_invoices
  );
end;
$$;

