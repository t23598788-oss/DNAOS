-- M024 — debt-reminder production-readiness gate.
--
-- Two changes, both additive to the M023 shape and neither one a writer:
--
-- 1) `company_debt_position` no longer adds a ledger balance that has already
--    been attributed to an invoice. `debt_events.linked_invoice_id` exists
--    (20260922000001 §5) and `engines/canonical/debt-write.ts` can set it; today
--    no caller does, so the two sources normally describe different money. The
--    moment a ledger row IS linked to an invoice, the invoice owns that
--    receivable (`invoice_payment_summary`) and the ledger row is the same money
--    recorded twice. Summing both would report a balance that nobody owes, so
--    the linked ledger exposure is excluded from `position_outstanding` and
--    surfaced separately as evidence. Nothing is written, no balance moves.
--
-- 2) One outbound reminder per (company, document, business day) is now enforced
--    by the DATABASE, not only by a read-then-insert check in the runner. The
--    cron fires every 10 minutes and two invocations can overlap; both used to
--    pass the "already sent today?" read and then both push. The partial unique
--    index is over the existing `line_events.extracted->>'reminder_key'`, i.e.
--    the audit store that already exists — no new table, no new ledger.
--
-- Apply to the isolated acceptance DB first. Production is out of scope for M024.

drop view if exists public.company_debt_position;

create view public.company_debt_position
with (security_invoker = true) as
with invoice_rollup as (
  select
    i.customer_company_id as company_id,
    sum(s.receivable_amount) as invoice_receivable,
    sum(s.paid_amount) as invoice_paid,
    sum(s.outstanding) filter (
      where s.derived_status <> 'VOID' and s.outstanding > 0
    ) as invoice_outstanding,
    count(*) filter (
      where s.derived_status <> 'VOID' and s.outstanding > 0
    ) as open_invoice_count,
    min(i.due_date::date) filter (
      where s.derived_status <> 'VOID' and s.outstanding > 0
    ) as oldest_due_date,
    max(greatest(0, current_date - i.due_date::date)) filter (
      where s.derived_status <> 'VOID' and s.outstanding > 0
    ) as max_days_overdue
  from public.invoices i
  join public.invoice_payment_summary s on s.invoice_id = i.id
  group by i.customer_company_id
),
-- Ledger exposure that a writer has explicitly attributed to an invoice.
-- Net effect follows the same signed vocabulary as company_debt_current.
linked_ledger as (
  select
    e.customer_company_id as company_id,
    coalesce(sum(
      case e.event_type
        when 'debt_started'             then  coalesce(e.amount, 0)
        when 'manual_adjustment'        then  coalesce(e.amount, 0)
        when 'manual_interest_adjustment' then coalesce(e.amount, 0)
        when 'receipt_received'         then -coalesce(e.amount, 0)
        when 'interest_penalty_received' then -coalesce(e.amount, 0)
        else 0
      end
    ), 0) as linked_net,
    count(distinct e.linked_invoice_id) as linked_invoice_count
  from public.debt_events e
  where e.linked_invoice_id is not null
  group by e.customer_company_id
)
select
  c.id as company_id,
  c.name as company_name,
  coalesce(ir.invoice_receivable, 0)::numeric(14,2) as invoice_receivable,
  coalesce(ir.invoice_paid, 0)::numeric(14,2) as invoice_paid,
  coalesce(ir.invoice_outstanding, 0)::numeric(14,2) as invoice_outstanding,
  coalesce(ir.open_invoice_count, 0)::bigint as open_invoice_count,
  ir.oldest_due_date,
  coalesce(ir.max_days_overdue, 0)::integer as invoice_days_overdue,
  coalesce(dc.ledger_outstanding, 0)::numeric(14,2) as ledger_outstanding,
  -- evidence for the dedupe decision (never added to position_outstanding)
  coalesce(ll.linked_net, 0)::numeric(14,2) as ledger_invoice_linked_net,
  coalesce(ll.linked_invoice_count, 0)::bigint as ledger_invoice_linked_count,
  (coalesce(dc.ledger_outstanding, 0) - coalesce(ll.linked_net, 0))::numeric(14,2)
    as ledger_unlinked_outstanding,
  coalesce(dc.snapshot_total_outstanding, 0)::numeric(14,2) as snapshot_outstanding,
  coalesce(dc.snapshot_days_overdue, 0)::integer as snapshot_days_overdue,
  (coalesce(dc.snapshot_total_outstanding, 0) = coalesce(dc.ledger_outstanding, 0)) as snapshot_matches_ledger,
  (
    coalesce(ir.invoice_outstanding, 0)
    + greatest(coalesce(dc.ledger_outstanding, 0) - coalesce(ll.linked_net, 0), 0)
  )::numeric(14,2) as position_outstanding,
  (
    coalesce(ll.linked_net, 0) > 0
  ) as duplicate_risk_suppressed,
  greatest(coalesce(ir.max_days_overdue, 0), coalesce(dc.snapshot_days_overdue, 0))::integer
    as days_overdue,
  case
    when coalesce(ir.invoice_outstanding, 0) > 0
         and greatest(coalesce(dc.ledger_outstanding, 0) - coalesce(ll.linked_net, 0), 0) > 0
      then 'BOTH_SOURCES'
    when coalesce(ir.invoice_outstanding, 0) > 0 then 'INVOICE_ONLY'
    when greatest(coalesce(dc.ledger_outstanding, 0) - coalesce(ll.linked_net, 0), 0) > 0
      then 'LEDGER_ONLY'
    else 'NONE'
  end as reconciliation_status,
  dc.snapshot_collection_state
from public.companies c
left join invoice_rollup ir on ir.company_id = c.id
left join linked_ledger ll on ll.company_id = c.id
left join public.company_debt_current dc on dc.company_id = c.id;

comment on view public.company_debt_position is
  'M024: read-only reconciliation of invoice receivables vs the debt ledger. Ledger rows already attributed to an invoice (debt_events.linked_invoice_id) are excluded from position_outstanding and reported as ledger_invoice_linked_net, so the same receivable is never counted twice.';

-- ── Send-once guard ─────────────────────────────────────────────────────────
-- A reminder is identified by extracted.reminder_key. Only live rows count:
-- a 'failed' row leaves the index (so a retry may insert again, capped in code),
-- and 'cancelled' rows leave it as well. Existing duplicate live rows would make
-- this index creation fail — that is intentional, it is a real duplicate send.
create unique index if not exists line_events_out_reminder_key_uidx
  on public.line_events ((extracted ->> 'reminder_key'))
  where direction = 'out'
    and (extracted ->> 'reminder_key') is not null
    and status in ('queued', 'sent', 'delivery_confirmed');

comment on index public.line_events_out_reminder_key_uidx is
  'M024: one live outbound reminder per reminder_key. Enforces send-once across overlapping cron invocations at the database, not in application code.';
