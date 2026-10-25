-- Real E-Statement ledger (owner, 2026-07-27): "อยากรู้ว่าเงินเข้ามาแล้ว
-- เงินออกกับเงินออกไปกับค่าอะไรบ้าง...ชีพจรการเงินของบริษัท" — bank_notifications
-- only ever catches the owner's own outgoing K BIZ/K PLUS actions (real bank
-- email confirmations always go to whoever initiated the transfer, never the
-- recipient). The full real ledger (every incoming AND outgoing transaction)
-- only exists in the monthly K-Deposit Statement PDF. Populated by
-- scripts/bank-statement-sync (local Playwright automation on the owner's
-- own Mac — logs into K-Docportal, reads the real OTP from the same Gmail
-- inbox, downloads + decrypts + parses the real statement).
create table if not exists public.bank_statement_transactions (
  id                uuid primary key default gen_random_uuid(),
  account_number    text,
  transaction_date  text not null, -- DD-MM-YY as printed on the real statement
  transaction_time  text,
  kind              text,          -- e.g. "รับโอนเงิน" / "โอนเงิน" / "ชำระเงิน" / "ฝากเงินสด"
  amount            numeric not null,
  balance_after      numeric,
  channel           text,          -- e.g. "K PLUS" / "K BIZ" / "Internet/Mobile KTB" / "CDM RCM"
  description       text,
  matched_receipt_document_id uuid references public.receipt_documents(id),
  created_at        timestamptz not null default now(),
  unique (account_number, transaction_date, transaction_time, description, amount)
);

create index if not exists bank_statement_transactions_date_idx
  on public.bank_statement_transactions (transaction_date);

alter table public.bank_statement_transactions enable row level security;

create policy service_role_only on public.bank_statement_transactions
  for all using (false);

drop policy if exists admin_workspace_read_bank_statement_transactions on public.bank_statement_transactions;
create policy admin_workspace_read_bank_statement_transactions
  on public.bank_statement_transactions
  for select
  to authenticated
  using (public.is_admin_workspace_user());
