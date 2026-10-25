-- ============================================================================
-- Canonical v1.1 — CANONICAL VIEWS (Phase C5). Views only: no new owner, no table.
-- security_invoker = true so the underlying tables' RLS still applies to callers
-- (service role keeps full read; anon stays denied by the existing policies).
-- ============================================================================

-- 1) document_canonical — one normalised shape over the two generated-document tables
create or replace view public.document_canonical
with (security_invoker = true) as
select
  'invoice'::text                    as document_kind,
  i.id                               as document_id,
  i.invoice_no                       as document_no,
  'invoice'::text                    as document_type,
  i.invoice_status::text             as document_status,
  i.customer_company_id,
  i.customer_order_id,
  i.project_id,
  i.invoice_date                     as issue_date,
  i.due_date                         as due_date,
  i.reference_no,
  i.subtotal, i.vat_rate, i.vat_amount, i.discount_amount, i.vat_mode,
  i.gross_amount, i.total_amount, i.wht_rate, i.wht_amount, i.net_payable,
  i.paid_amount,
  i.data_completeness,
  (select count(*) from public.invoice_items it where it.invoice_id = i.id) as items_count,
  v.id                               as current_version_id,
  v.version_no                       as current_version_no,
  v.status                           as version_status,
  i.created_at, i.updated_at
from public.invoices i
left join lateral (
  select dv.id, dv.version_no, dv.status from public.document_versions dv
  where dv.invoice_id = i.id order by dv.version_no desc limit 1
) v on true
union all
select
  'standalone_document'::text,
  s.id,
  s.document_no,
  s.document_type::text,
  s.status,
  s.customer_company_id,
  s.customer_order_id,
  s.project_id,
  s.document_date,
  null::timestamp,
  s.reference_no,
  s.subtotal, s.vat_rate, s.vat_amount, s.discount_amount, s.vat_mode,
  s.gross_amount, s.total_amount, s.wht_rate, s.wht_amount, s.net_payable,
  null::numeric,
  s.data_completeness,
  (select count(*) from public.standalone_document_items it where it.document_id = s.id),
  v2.id,
  v2.version_no,
  v2.status,
  s.created_at, s.updated_at
from public.standalone_documents s
left join lateral (
  select dv.id, dv.version_no, dv.status from public.document_versions dv
  where dv.standalone_document_id = s.id order by dv.version_no desc limit 1
) v2 on true;

-- 2) invoice_payment_summary — paid/outstanding derived from payment_allocations only
create or replace view public.invoice_payment_summary
with (security_invoker = true) as
select
  i.id                    as invoice_id,
  i.invoice_no,
  i.invoice_status::text  as persisted_status,
  coalesce(i.net_payable, i.gross_amount, i.total_amount) as receivable_amount,
  case
    when i.net_payable is not null then 'net_payable'
    when i.gross_amount is not null then 'gross_amount (legacy: wht unknown)'
    else 'total_amount (legacy)'
  end                     as receivable_basis,
  coalesce(p.paid, 0)     as paid_amount,
  coalesce(i.net_payable, i.gross_amount, i.total_amount) - coalesce(p.paid, 0) as outstanding,
  coalesce(p.allocations, 0) as allocation_count,
  case
    when i.invoice_status::text = 'VOID' then 'VOID'
    when coalesce(i.net_payable, i.gross_amount, i.total_amount) is null then 'UNKNOWN'
    when coalesce(p.paid, 0) >= coalesce(i.net_payable, i.gross_amount, i.total_amount) then 'PAID'
    when coalesce(p.paid, 0) > 0 then 'PARTIALLY_PAID'
    else i.invoice_status::text
  end                     as derived_status
from public.invoices i
left join (
  select invoice_id, sum(amount) as paid, count(*) as allocations
  from public.payment_allocations where invoice_id is not null group by 1
) p on p.invoice_id = i.id;

-- 3) company_debt_current — ledger-derived truth next to the cached snapshot projection
create or replace view public.company_debt_current
with (security_invoker = true) as
select
  c.id                       as company_id,
  c.name                     as company_name,
  ds.total_outstanding       as snapshot_total_outstanding,
  ds.collection_state::text  as snapshot_collection_state,
  ds.days_overdue            as snapshot_days_overdue,
  ds.debt_start_at,
  ds.last_refreshed_at,
  coalesce(ev.debt_started, 0)      as ledger_debt_started,
  coalesce(ev.received, 0)          as ledger_receipt_received,
  coalesce(ev.interest_received, 0) as ledger_interest_penalty_received,
  coalesce(ev.manual_adjust, 0)     as ledger_manual_adjustment,
  coalesce(ev.debt_started, 0) + coalesce(ev.manual_adjust, 0)
    - coalesce(ev.received, 0) - coalesce(ev.interest_received, 0) as ledger_outstanding,
  coalesce(ev.event_count, 0) as ledger_event_count,
  ev.last_event_at,
  coalesce(pa.allocated_payments, 0) as allocated_payments
from public.companies c
left join public.debt_snapshots ds on ds.customer_company_id = c.id
left join (
  select
    customer_company_id,
    sum(case when event_type = 'debt_started'             then coalesce(amount, 0) else 0 end) as debt_started,
    sum(case when event_type = 'receipt_received'          then coalesce(amount, 0) else 0 end) as received,
    sum(case when event_type = 'interest_penalty_received' then coalesce(amount, 0) else 0 end) as interest_received,
    sum(case when event_type = 'manual_adjustment'         then coalesce(amount, 0) else 0 end) as manual_adjust,
    count(*) as event_count,
    max(occurred_at) as last_event_at
  from public.debt_events group by 1
) ev on ev.customer_company_id = c.id
left join (
  select rd.customer_company_id, sum(pa.amount) as allocated_payments
  from public.payment_allocations pa
  join public.receipt_documents rd on rd.id = pa.receipt_document_id
  group by 1
) pa on pa.customer_company_id = c.id;

-- 4) document_references_inverse — the ONLY place CHILD appears (projection, never persisted)
create or replace view public.document_references_inverse
with (security_invoker = true) as
select
  id,
  (case relation_type when 'PARENT' then 'CHILD'::public."DocumentReferenceRelationType" else relation_type end) as relation_type,
  to_invoice_id               as from_invoice_id,
  to_standalone_document_id   as from_standalone_document_id,
  from_invoice_id             as to_invoice_id,
  from_standalone_document_id as to_standalone_document_id,
  amount, evidence_ref, created_at, created_by
from public.document_references;

-- 5) document_versions_next — old version -> the version that replaced it (derived)
create or replace view public.document_versions_next
with (security_invoker = true) as
select
  prev.id                as version_id,
  prev.invoice_id,
  prev.standalone_document_id,
  prev.version_no        as version_no,
  nxt.id                 as next_version_id,
  nxt.version_no         as next_version_no,
  nxt.status             as next_status,
  nxt.data_completeness  as next_data_completeness,
  nxt.created_at         as replaced_at
from public.document_versions prev
join public.document_versions nxt on nxt.previous_version_id = prev.id;

-- 6) receipt_documents_bank_line — inbound payment evidence -> the bank line matching it
create or replace view public.receipt_documents_bank_line
with (security_invoker = true) as
select
  rd.id            as receipt_document_id,
  rd.document_type,
  rd.status        as receipt_status,
  rd.amount        as receipt_amount,
  rd.media_path,
  rd.media_sha256,
  rd.allocation_state,
  b.id             as bank_statement_transaction_id,
  b.account_number,
  b.transaction_date,
  b.transaction_time,
  b.amount         as bank_amount,
  b.description    as bank_description
from public.receipt_documents rd
left join public.bank_statement_transactions b on b.matched_receipt_document_id = rd.id;

