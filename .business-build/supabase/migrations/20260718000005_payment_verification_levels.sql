-- Payment Verification Priority Levels (owner, 2026-07-18)
--
-- Level 1: LINE claim only (customer said "โอนแล้ว", no slip yet)
-- Level 2: + OCR-read slip (Evidence)
-- Level 3: + bank notification email (Bank Notification) — NOT BUILT, no
--          email-ingestion source exists in this codebase yet
-- Level 4: + bank statement/API (Bank Confirmation) — NOT BUILT, no
--          statement/API integration exists yet
--
-- payment_verified only becomes true once every level CURRENTLY AVAILABLE
-- agrees. Since levels 3/4 don't exist today, a human confirming (via
-- app/api/admin/receipt-documents/[id]/confirm) is the real substitute for
-- them, per Rule 72 — this is documented honestly, not silently pretended to
-- be fully automated cross-source verification.

alter table public.receipt_documents
  add column if not exists receiving_account_name text,
  add column if not exists verification_level smallint not null default 1
    check (verification_level between 1 and 4),
  add column if not exists payment_verified boolean not null default false;

comment on column public.receipt_documents.receiving_account_name is
  'Name on our own receiving bank account, alongside receiving_bank/receiving_account_number — completes the "which account did this land in" record for later audit search.';
comment on column public.receipt_documents.verification_level is
  '1=LINE claim only, 2=+OCR slip read, 3=+bank notification email (unbuilt), 4=+bank statement/API (unbuilt). Reflects how much REAL evidence exists, not a guess at what should exist.';
comment on column public.receipt_documents.payment_verified is
  'True only once every currently-available verification level agrees AND a human (or, once levels 3/4 exist, the verification engine) has confirmed it. Distinct from status=confirmed for query/audit convenience — e.g. "find every real, verified payment of ฿16,856.53 on 2026-07-18" without needing to know the status vocabulary.';
