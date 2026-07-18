-- Payment Verification Engine — richer capture + Waiting Bank Confirmation
-- state (owner, 2026-07-18)
--
-- Owner's target design cross-checks 5 evidence sources (LINE claim, OCR
-- slip, bank email, bank statement/API, system-calculated outstanding)
-- before creating a payment_received event. Only 2 of those 5 are real today
-- (LINE + OCR slip) — bank email/statement/gateway integrations remain
-- unbuilt, confirmed via explore-agent trace earlier this session, and need
-- external credentials only the owner can provision. This migration builds
-- the two pieces that don't depend on those missing sources:
--
-- 1. Richer per-payment capture fields, so whenever a second source DOES
--    get connected later, the comparison has real fields to compare against.
-- 2. A "waiting_bank_confirmation" status — today a customer typing "โอนแล้ว"
--    with no slip photo creates nothing at all; this distinguishes "customer
--    claims to have paid" from "we have a slip to review", per the owner's
--    own diagram (LINE claim -> no money yet -> Waiting Bank Confirmation).

alter table public.receipt_documents
  add column if not exists payment_method text,
  add column if not exists sender_account_number text,
  add column if not exists receiving_bank text,
  add column if not exists receiving_account_number text,
  add column if not exists confirmed_by text;

comment on column public.receipt_documents.payment_method is
  'How the customer says they paid: cash / transfer / qr / cheque. Only meaningful once a human or a second evidence source confirms it — not guessed from a slip photo alone.';
comment on column public.receipt_documents.sender_account_number is
  'Transferring account number, if visible on the slip. Only meaningful for document_type=transfer_slip.';
comment on column public.receipt_documents.receiving_bank is
  'Our own bank the money should land in, for cross-checking against a future bank-statement/API source. Not read from the slip — set from company settings once that comparison exists.';
comment on column public.receipt_documents.receiving_account_number is
  'Our own account number, same purpose as receiving_bank.';
comment on column public.receipt_documents.confirmed_by is
  'Who moved this row to confirmed/rejected — an admin email (see the confirm/reject routes) today; reserved for "ai" or a specific verification-engine identity once a real second source exists to auto-verify against.';

-- media_path was NOT NULL (this table started as "photo classification
-- results only"). A payment CLAIM via plain text ("โอนแล้วครับ", no photo
-- attached yet) has no media to store — must be allowed, or the claim has
-- nowhere to be recorded at all.
alter table public.receipt_documents alter column media_path drop not null;

-- receipt_documents.status has no CHECK constraint (free text, per the
-- original 2026-07-17 migration) — 'waiting_bank_confirmation' is a new
-- valid value alongside the existing ai_read/confirmed/rejected, requiring
-- no schema change beyond this comment. Documented here for anyone reading
-- the column later.
comment on column public.receipt_documents.status is
  'ai_read (Pending Review — a slip was classified, awaiting human confirmation) | waiting_bank_confirmation (customer claims payment, no slip/evidence yet) | confirmed (a human verified it — created a receipt_received debt event) | rejected (mismatch/no real transfer found).';
