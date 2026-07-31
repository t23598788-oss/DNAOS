-- Extends reconcile_receipt_payment (20260723000001) to accept payment_advice
-- as well as transfer_slip — same real bug found 2026-07-24 (บจก. เคที
-- คอนสตรัคชั่น, ฿5,000 slip): ocr-classify.ts's own DOCUMENT_TYPE_PROFILE
-- treats both as equally real incoming-payment evidence, but this function's
-- guard only accepted transfer_slip. create or replace keeps the exact same
-- row-locked, idempotent (already_reconciled) behavior — only the type check
-- changes.

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): same %ROWTYPE-at-parse-time
-- issue as 20260723000001 — guarded the same way. No-op in production.
do $outer$ begin
  if to_regclass('public.debt_snapshots') is not null then
    execute $sql$
      create or replace function public.reconcile_receipt_payment(
        p_receipt_id uuid,
        p_actor text default 'system:line-slip'
      )
      returns table (
        receipt_id uuid,
        company_id uuid,
        amount numeric,
        previous_outstanding numeric,
        new_outstanding numeric,
        debt_event_id uuid,
        already_reconciled boolean
      )
      language plpgsql
      security definer
      set search_path = public
      as $func$
      declare
        r public.receipt_documents%rowtype;
        s public.debt_snapshots%rowtype;
        e public.debt_events%rowtype;
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
        new_outstanding := greatest(previous_outstanding - amount, 0);

        insert into public.debt_events
          (customer_company_id, event_type, amount, occurred_at, note, source)
        values
          (r.customer_company_id, 'receipt_received', r.amount,
           coalesce(r.transaction_datetime::date, now()::date),
           'LINE slip auto-reconciled; receipt ' || r.id::text, 'line_chat')
        returning * into e;

        update public.debt_snapshots
          set total_outstanding = new_outstanding, updated_at = now()
          where customer_company_id = r.customer_company_id;

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
      $func$;
    $sql$;
  end if;
end $outer$;
