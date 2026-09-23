-- Canonical payment allocation — ATOMIC COMMIT BOUNDARY (owner decision 2026-09-23, B-04R2)
--
-- WHY THIS EXISTS: the application guards in engines/canonical/payment-write.ts are
-- read-then-write. They are correct single-threaded but cannot give an atomicity
-- guarantee (two concurrent confirmations can both pass their checks before either
-- writes). This function is the transactional commit boundary: it acquires the locks,
-- RE-READS every monetary fact inside the transaction and revalidates the invariants
-- before mutating. The TypeScript writer stays the orchestration/business API — this
-- SQL is its transactional implementation, not a second payment authority, and it
-- carries no business vocabulary of its own (no UI, no token, no auth, no rates).
--
-- NOT APPLIED TO ANY DATABASE YET. The writer is deliberately NOT wired to it (wiring
-- before the function exists on a target database would break the live confirm path).
-- Ordered release: apply to local/staging → run the concurrency tests → wire the
-- adapter → apply to production (same release).
--
-- LOCK ORDER (deterministic, deadlock-safe):
--   1. receipt_documents row (FOR UPDATE)
--   2. target invoice rows, sorted by id (FOR UPDATE ... ORDER BY id)
--   3. debt_snapshots row of the receipt company (only when a ledger event is created)
--
-- Follows the existing repo pattern verbatim: `security definer` + explicit
-- `set search_path = public` (see public.confirm_invoice / reconcile_receipt_payment)
-- and the same revoke/grant shape used by 20260723000001 for financial functions.
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
    v_anchor_amount := (
      select coalesce(sum((a->>'amount')::numeric), 0)
        from jsonb_array_elements(p_allocations) a where a->>'target_kind' = 'anchor'
    );
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

revoke all on function public.confirm_payment_allocation(uuid, jsonb, text, text) from public;
do $grant$
begin
  -- Supabase roles exist in production; a plain local Postgres may not have them.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.confirm_payment_allocation(uuid, jsonb, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.confirm_payment_allocation(uuid, jsonb, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.confirm_payment_allocation(uuid, jsonb, text, text) to service_role';
  end if;
end
$grant$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reallocation — same atomic boundary, same lock order, same invariant revalidation.
-- Moving money is NOT new money: the row being moved is subtracted before the
-- destination amount is re-added, and exactly one target id is left non-null.
-- ─────────────────────────────────────────────────────────────────────────────
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

revoke all on function public.reallocate_payment_allocation(uuid, text, uuid, numeric, text, text) from public;
do $grant2$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.reallocate_payment_allocation(uuid, text, uuid, numeric, text, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.reallocate_payment_allocation(uuid, text, uuid, numeric, text, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.reallocate_payment_allocation(uuid, text, uuid, numeric, text, text) to service_role';
  end if;
end
$grant2$;
