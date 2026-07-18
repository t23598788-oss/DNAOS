-- Debt Tracking Model — Phase B (owner, 2026-07-18)
--
-- Makes debt_snapshots the Single Source of Truth for a debt's classification,
-- not just its amount: every page (reminder card, Invoice module, credit
-- score, LINE chat Q&A) must read debt_type/vat_status/document_type from
-- HERE rather than each deciding independently which document/VAT rule
-- applies. Document choice becomes a pure function of debt_type — the "ส่ง"
-- button's target endpoint is decided by data, not by which UI button the
-- user happened to click (this is the exact ambiguity that caused the
-- two-channel LINE-send bug fixed earlier this session).
--
-- Also introduces debt_events: an append-only event log (Debt Started,
-- Receipt Received, Promise To Pay, Collection Paused, Collection Resumed,
-- Interest Waived, Penalty Waived, Manual Adjustment, Debt Closed). Freeze
-- windows become a DERIVED result of Collection Paused / Collection Resumed
-- event pairs, not a manually-edited field — freeze_from/freeze_until on
-- debt_snapshots stay as a fallback for customers with no event history yet
-- (owner instruction: keep working during transition, do not break เทย่า
-- ขอนแก่น's already-set freeze).

alter table public.debt_snapshots
  add column if not exists debt_type text
    check (debt_type in ('trade_receivable', 'collection_reminder', 'loan', 'damages')),
  add column if not exists legal_basis text,
  add column if not exists reason text,
  add column if not exists calculation_method text,
  add column if not exists vat_status text
    check (vat_status in ('vat_included', 'vat_not_applicable')),
  add column if not exists document_type text
    check (document_type in ('invoice', 'collection_reminder_notice', 'unsupported')),
  add column if not exists remark text,
  add column if not exists source_event_id uuid;

comment on column public.debt_snapshots.debt_type is
  'Classifies WHY this debt exists — trade_receivable (ซื้อขายสินค้า/บริการ), collection_reminder (ทวงถามทั่วไป), loan (เงินกู้/เงินยืม), damages (ค่าเสียหาย). Determines which document module is allowed to issue a document for this row — see document_type.';
comment on column public.debt_snapshots.vat_status is
  'vat_included = VAT already recorded in the originating transaction, do not add again. vat_not_applicable = not a VAT transaction (e.g. a collection reminder is not a tax document). No third "not yet decided" state — every row must be classified.';
comment on column public.debt_snapshots.document_type is
  'The ONLY document type allowed to be issued for this debt row, derived from debt_type. trade_receivable -> invoice. collection_reminder -> collection_reminder_notice. loan/damages -> unsupported (no template exists yet — must be flagged, never silently forced through invoice or reminder-card).';
comment on column public.debt_snapshots.source_event_id is
  'The debt_events row that most recently changed this snapshot, if event-sourced. Null for snapshots not yet migrated to the event model.';

-- Backfill: every existing debt_snapshots row today came from the debt
-- collection-reminder flow (confirmed — it is the only writer of this
-- table), so this default is accurate for current data, not a guess.
update public.debt_snapshots
set
  debt_type = coalesce(debt_type, 'collection_reminder'),
  vat_status = coalesce(vat_status, 'vat_not_applicable'),
  document_type = coalesce(document_type, 'collection_reminder_notice'),
  calculation_method = coalesce(calculation_method, 'simple_interest_25pct_penalty_100_per_day')
where debt_type is null;

create table if not exists public.debt_events (
  id uuid primary key default gen_random_uuid(),
  customer_company_id uuid not null references public.companies(id),
  event_type text not null
    check (event_type in (
      'debt_started', 'receipt_received', 'promise_to_pay',
      'collection_paused', 'collection_resumed',
      'interest_waived', 'penalty_waived',
      'manual_adjustment', 'debt_closed'
    )),
  amount numeric,
  occurred_at date not null,
  promised_date date,
  note text,
  source text not null default 'admin_manual',
  created_by text,
  created_at timestamp with time zone not null default now()
);

comment on table public.debt_events is
  'Append-only event log for debt state changes (Phase B, owner 2026-07-18). No update/delete — corrections are new events (e.g. a wrong freeze is undone by a collection_resumed event, never by editing a row). Debt Engine derives freeze windows and adjusted totals from this history; debt_snapshots.freeze_from/freeze_until remain as a fallback for rows with no events yet.';
comment on column public.debt_events.occurred_at is
  'The real business date the event happened (e.g. the date a customer actually paid), not the date someone typed it into the system.';

alter table public.debt_snapshots enable row level security;
alter table public.debt_events enable row level security;

drop policy if exists debt_events_service_role_only on public.debt_events;
create policy debt_events_service_role_only on public.debt_events for all using (false);
