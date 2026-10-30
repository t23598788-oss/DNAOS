-- M023 — ONE read-only position per company that reconciles the two canonical
-- sources of money-owed, without inventing a third ledger and without a writer.
--
-- Problem this closes (proven in M022): `company_debt_current` is built from
-- debt_events only, so a trade receivable that exists as an invoice (with
-- payments allocated through `payment_allocations` → `invoice_payment_summary`)
-- reports ledger_outstanding = 0. The automated debt-reminder cron reads
-- debt_snapshots, which is likewise not fed by invoice payments. A company can
-- therefore owe 25,000 and every existing debt surface says 0.
--
-- This view deliberately keeps the two sources SEPARATE and only reports a
-- labelled total, so no downstream code can silently treat one as the other:
--   invoice_outstanding  — canonical invoice projection (invoice_payment_summary)
--   ledger_outstanding   — canonical debt ledger (company_debt_current)
--   position_outstanding — invoice_outstanding + ledger_outstanding
--   reconciliation_status — which source(s) actually carry a balance
--
-- Financial authority is unchanged: nothing here writes, and each figure is
-- still owned by its original canonical projection.
--
-- Apply to isolated acceptance DB first; production is out of scope for M023.

create or replace view public.company_debt_position
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
  coalesce(dc.snapshot_total_outstanding, 0)::numeric(14,2) as snapshot_outstanding,
  coalesce(dc.snapshot_days_overdue, 0)::integer as snapshot_days_overdue,
  (
    coalesce(ir.invoice_outstanding, 0) + coalesce(dc.ledger_outstanding, 0)
  )::numeric(14,2) as position_outstanding,
  greatest(coalesce(ir.max_days_overdue, 0), coalesce(dc.snapshot_days_overdue, 0))::integer
    as days_overdue,
  case
    when coalesce(ir.invoice_outstanding, 0) > 0 and coalesce(dc.ledger_outstanding, 0) > 0
      then 'BOTH_SOURCES'
    when coalesce(ir.invoice_outstanding, 0) > 0 then 'INVOICE_ONLY'
    when coalesce(dc.ledger_outstanding, 0) > 0 then 'LEDGER_ONLY'
    else 'NONE'
  end as reconciliation_status,
  dc.snapshot_collection_state
from public.companies c
left join invoice_rollup ir on ir.company_id = c.id
left join public.company_debt_current dc on dc.company_id = c.id;

comment on view public.company_debt_position is
  'M023: read-only reconciliation of invoice receivables vs the debt ledger. Does not replace either source; position_outstanding is a labelled sum and reconciliation_status says which source carries the balance.';
