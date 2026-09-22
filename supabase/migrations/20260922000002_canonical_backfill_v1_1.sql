-- ============================================================================
-- Canonical v1.1 — SAFE BACKFILL (evidence only · unknown stays NULL <-> LEGACY_PARTIAL)
-- Phase C4. Idempotent: every statement is guarded by "not exists / is null".
-- Rules honoured:
--   * no guessing WHT / discount / vat_mode / source links / relations
--   * no touch of any legacy financial column (only the NEW canonical columns)
--   * originals (line-media) are NOT copied into document_artifacts
--   * document_versions v1 snapshot records what is stored today, verbatim
-- ============================================================================

-- ── 1. Inbound source file facts from the storage registry ──────────────────
--    size + mimetype are real (85/85 objects carry them). storage.objects only
--    exposes an eTag (MD5) — NOT sha256 — so media_sha256 stays NULL by design.
update public.receipt_documents rd
set media_size_bytes  = (o.metadata->>'size')::bigint,
    media_mime_type   = o.metadata->>'mimetype',
    media_captured_at = coalesce(rd.media_captured_at, o.created_at)
from storage.objects o
where o.bucket_id = 'attachments'
  and o.name = rd.media_path
  and rd.media_size_bytes is null
  and (o.metadata ? 'size')
  and (o.metadata ? 'mimetype');

-- ── 2. Proven financial field: GROSS (total_amount = subtotal + vat_amount) ──
update public.invoices
set gross_amount = total_amount
where gross_amount is null
  and total_amount is not null
  and total_amount = round(subtotal + vat_amount, 2);

update public.standalone_documents
set gross_amount = total_amount
where gross_amount is null
  and total_amount is not null
  and total_amount = round(subtotal + vat_amount, 2);

-- ── 3. document_versions v1 for every existing document ─────────────────────
--    snapshot = exactly what is stored today (totals ladder + items + legacy flags).
--    data_completeness stays LEGACY_PARTIAL because WHT / discount / vat_mode are
--    not knowable from the stored data — never invented.
insert into public.document_versions
  (invoice_id, version_no, status, data_completeness, snapshot, created_by)
select
  i.id,
  1,
  'active',
  'LEGACY_PARTIAL',
  jsonb_build_object(
    'document_kind', 'invoice',
    'document_no', i.invoice_no,
    'document_type', 'invoice',
    'issue_date', i.invoice_date,
    'due_date', i.due_date,
    'reference', i.reference_no,
    'financial', jsonb_build_object(
      'subtotal', i.subtotal,
      'vat_rate', i.vat_rate,
      'vat_amount', i.vat_amount,
      'gross_amount', i.total_amount,
      'total_amount', i.total_amount,
      'paid_amount', i.paid_amount,
      'discount_amount', null,
      'vat_mode', null,
      'wht_rate', null,
      'wht_amount', null,
      'net_payable', null
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', it.description, 'qty', it.qty, 'unit', it.unit,
        'unit_price', it.unit_price, 'line_total', it.line_total, 'sort_order', it.sort_order
      ) order by it.sort_order)
      from public.invoice_items it where it.invoice_id = i.id
    ), '[]'::jsonb),
    'items_count', (select count(*) from public.invoice_items it where it.invoice_id = i.id),
    'legacy', jsonb_build_object(
      'backfill', 'phaseC4',
      'gross_proven', (i.total_amount = round(i.subtotal + i.vat_amount, 2)),
      'wht_unknown', true, 'discount_unknown', true, 'vat_mode_unknown', true
    )
  ),
  'backfill:phaseC4'
from public.invoices i
where not exists (
  select 1 from public.document_versions v where v.invoice_id = i.id and v.version_no = 1
);

insert into public.document_versions
  (standalone_document_id, version_no, status, data_completeness, snapshot, created_by)
select
  s.id,
  1,
  case when s.status = 'void' then 'void' else 'active' end,
  'LEGACY_PARTIAL',
  jsonb_build_object(
    'document_kind', 'standalone_document',
    'document_no', s.document_no,
    'document_type', s.document_type::text,
    'issue_date', s.document_date,
    'reference', s.reference_no,
    'financial', jsonb_build_object(
      'subtotal', s.subtotal,
      'vat_rate', s.vat_rate,
      'vat_amount', s.vat_amount,
      'gross_amount', s.total_amount,
      'total_amount', s.total_amount,
      'paid_amount', null,
      'discount_amount', null,
      'vat_mode', null,
      'wht_rate', null,
      'wht_amount', null,
      'net_payable', null
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'description', it.description, 'qty', it.qty, 'unit', it.unit,
        'unit_price', it.unit_price, 'sort_order', it.sort_order
      ) order by it.sort_order)
      from public.standalone_document_items it where it.document_id = s.id
    ), '[]'::jsonb),
    'items_count', (select count(*) from public.standalone_document_items it where it.document_id = s.id),
    'legacy', jsonb_build_object(
      'backfill', 'phaseC4',
      'gross_proven', (s.total_amount = round(s.subtotal + s.vat_amount, 2)),
      'wht_unknown', true, 'discount_unknown', true, 'vat_mode_unknown', true,
      'legacy_status', s.status
    )
  ),
  'backfill:phaseC4'
from public.standalone_documents s
where not exists (
  select 1 from public.document_versions v where v.standalone_document_id = s.id and v.version_no = 1
);

-- ── 4. payment_allocations from the ONLY existing evidence ──────────────────
--    evidence = receipt_documents.matched_debt_event_id on a CONFIRMED payment
--    evidence (transfer_slip / payment_advice). Amount comes from the debt_event
--    itself. No allocation is invented for interest/penalty events that have no
--    matching payment.
insert into public.payment_allocations
  (receipt_document_id, debt_event_id, allocation_kind, amount, allocated_at, allocated_by, note)
select
  rd.id,
  de.id,
  'principal',
  de.amount,
  coalesce(rd.updated_at, now()),
  'backfill:phaseC4',
  'backfill from receipt_documents.matched_debt_event_id (legacy compat pointer) — evidence: debt_events.'
    || de.event_type || ' ' || de.id::text || coalesce(' | slip ref ' || rd.reference_number, '')
from public.receipt_documents rd
join public.debt_events de on de.id = rd.matched_debt_event_id
where rd.status = 'confirmed'
  and rd.document_type in ('transfer_slip', 'payment_advice')
  and de.amount is not null
  and de.amount > 0
  and not exists (
    select 1 from public.payment_allocations pa where pa.receipt_document_id = rd.id
  );

-- ── 5. receipt allocation_state reflects the allocation rows (cached indicator)
update public.receipt_documents rd
set allocation_state = 'allocated'
where exists (select 1 from public.payment_allocations pa where pa.receipt_document_id = rd.id)
  and (select coalesce(sum(pa.amount), 0) from public.payment_allocations pa where pa.receipt_document_id = rd.id)
      >= coalesce(rd.amount, 0);

update public.receipt_documents rd
set allocation_state = 'partial'
where exists (select 1 from public.payment_allocations pa where pa.receipt_document_id = rd.id)
  and (select coalesce(sum(pa.amount), 0) from public.payment_allocations pa where pa.receipt_document_id = rd.id)
      < coalesce(rd.amount, 0);
