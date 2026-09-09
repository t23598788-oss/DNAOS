CREATE OR REPLACE FUNCTION public.reconcile_receipt_payment(p_receipt_id uuid, p_actor text DEFAULT 'system:line-slip'::text)
 RETURNS TABLE(receipt_id uuid, company_id uuid, amount numeric, previous_outstanding numeric, new_outstanding numeric, debt_event_id uuid, already_reconciled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      declare
        r public.receipt_documents%rowtype;
        s public.debt_snapshots%rowtype;
        e public.debt_events%rowtype;
        v_principal_portion numeric;
        v_interest_penalty_portion numeric;
      begin
        select * into r from public.receipt_documents where id = p_receipt_id for update;
        if not found then raise exception 'receipt_not_found'; end if;
        if r.matched_debt_event_id is not null or r.status = 'confirmed' then
          receipt_id := r.id;
          company_id := r.customer_company_id;
          amount := coalesce(r.amount, 0);
          debt_event_id := r.matched_debt_event_id;
          already_reconciled := true;
          select ds.total_outstanding into new_outstanding from public.debt_snapshots ds
            where ds.customer_company_id = r.customer_company_id;
          previous_outstanding := new_outstanding + amount;
          return next;
          return;
        end if;
        if r.document_type not in ('transfer_slip', 'payment_advice') or r.customer_company_id is null or coalesce(r.amount, 0) <= 0 then
          raise exception 'receipt_not_reconcilable';
        end if;

        select * into s from public.debt_snapshots
          where customer_company_id = r.customer_company_id for update;
        if not found then raise exception 'debt_snapshot_not_found'; end if;

        previous_outstanding := coalesce(s.total_outstanding, 0);
        amount := r.amount;
        v_principal_portion := least(amount, previous_outstanding);
        v_interest_penalty_portion := round(amount - v_principal_portion, 2);
        -- Naive same-transaction estimate only — kept for RETURNS TABLE
        -- compatibility, NOT written to debt_snapshots (see migration
        -- header). The authoritative number comes from
        -- engines/debt/replay.ts, run by the caller right after this
        -- returns, over the full event history including the row(s)
        -- inserted below.
        new_outstanding := greatest(previous_outstanding - v_principal_portion, 0);

        insert into public.debt_events
          (customer_company_id, event_type, amount, occurred_at, note, source)
        values
          (r.customer_company_id, 'receipt_received', v_principal_portion,
           coalesce(r.transaction_datetime::date, now()::date),
           'LINE slip auto-reconciled; receipt ' || r.id::text, 'line_chat')
        returning * into e;

        if v_interest_penalty_portion > 0 then
          insert into public.debt_events
            (customer_company_id, event_type, amount, occurred_at, note, source)
          values
            (r.customer_company_id, 'interest_penalty_received', v_interest_penalty_portion,
             coalesce(r.transaction_datetime::date, now()::date),
             'ดอกเบี้ย/ค่าปรับที่ได้รับพร้อมเงินต้น (สลิป ' || r.id::text || ', ยอดรวมที่โอนมาจริง ' || amount::text || ' บาท)',
             'line_chat');
        end if;

        -- debt_snapshots write and 'debt_closed' event now belong to the
        -- caller's replay step (see migration header) — this RPC's job
        -- ends at "the event history is correct", not "the snapshot cache
        -- is correct".

        update public.receipt_documents
          set status = 'confirmed', matched_debt_event_id = e.id,
              confirmed_by = p_actor, payment_verified = true, updated_at = now()
          where id = r.id;

        receipt_id := r.id;
        company_id := r.customer_company_id;
        debt_event_id := e.id;
        already_reconciled := false;
        return next;
      end;
      $function$
