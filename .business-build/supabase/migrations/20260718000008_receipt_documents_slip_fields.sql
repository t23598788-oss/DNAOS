-- Payment Verification Engine — Phase 1: LINE slip evidence (owner, 2026-07-18)
--
-- Owner's design: a receipt becomes the RESULT of verification, not the
-- result of a customer sending a photo. Today only one evidence source is
-- real (LINE bank-slip photos via the existing OCR classifier) — bank
-- notification email, mobile banking API, payment gateway, and bank
-- statement feeds are all confirmed NOT to exist in this codebase yet (each
-- needs external credentials the owner must provision separately). Until a
-- second independent source exists, every transfer_slip classification stays
-- Pending Review (`receipt_documents.status = 'ai_read'`) — a human must
-- confirm before it becomes a receipt_received debt event, per Rule 72
-- (every write confirmed by a human) and Rule 73/83 (AI must not change
-- financial state). This is Phase 1 of the owner's 3-state design (Verified/
-- Pending Review/Rejected) — 'ai_read' IS Pending Review under a pre-existing
-- name (this table's status column already had exactly 3 states before this
-- migration: ai_read/confirmed/rejected), extended with the fields needed to
-- eventually cross-check against a second source once one is provisioned.

-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): public.companies has no CREATE
-- TABLE anywhere in this migration history (legacy, off-record).
-- customer_company_id's FK dropped entirely. No-op change in production.
alter table public.receipt_documents
  add column if not exists sender_name text,
  add column if not exists sender_bank text,
  add column if not exists reference_number text,
  add column if not exists transaction_datetime timestamp with time zone,
  add column if not exists customer_company_id uuid,
  add column if not exists matched_debt_event_id uuid references public.debt_events(id);

comment on column public.receipt_documents.sender_name is
  'Name of the transferring account holder, as printed on the slip. Only meaningful for document_type=transfer_slip.';
comment on column public.receipt_documents.sender_bank is
  'Bank name printed on the slip (e.g. "กสิกรไทย"). Only meaningful for document_type=transfer_slip.';
comment on column public.receipt_documents.reference_number is
  'Transaction/reference number printed on the slip, if any — the strongest single field for cross-matching against a second evidence source once one exists.';
comment on column public.receipt_documents.transaction_datetime is
  'The real transfer date/time as printed on the slip (not document_date, which the existing OCR schema already uses for a coarser date-only value on other document types).';
comment on column public.receipt_documents.customer_company_id is
  'Which company this slip is claimed to be a payment from — matched via the same line_user_id -> company_line_links path every other consumer uses (see engines/line-webhook-v2/engines/relationship-qa.ts). Null if no match found; never guessed.';
comment on column public.receipt_documents.matched_debt_event_id is
  'The debt_events row created when a human confirmed this slip (status became confirmed). Null while still ai_read/rejected.';
