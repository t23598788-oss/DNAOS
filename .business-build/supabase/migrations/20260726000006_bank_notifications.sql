-- Payment Verification Engine — Level 3 becomes real (owner, 2026-07-26):
-- Rule 115 always said Level 3 (bank notification email) "ยังไม่มีในระบบวันนี้"
-- — this is that real, independent evidence source. K BIZ (กสิกรไทย) sends a
-- real transfer-confirmation email to the owner's own Gmail for every real
-- transaction; a fraudster can fake a slip photo but cannot fake a real
-- email arriving in the owner's own inbox. Populated by the
-- bank-email-sync edge function (Gmail API, read-only scope), cross-checked
-- against receipt_documents.reference_number in
-- engines/process-classified-image.ts.
create table if not exists public.bank_notifications (
  id                    uuid primary key default gen_random_uuid(),
  gmail_message_id      text not null unique,
  reference_number      text,
  amount                numeric,
  transaction_datetime  timestamptz,
  sender_account_masked text,
  receiving_account_masked text,
  receiving_account_name  text,
  raw_subject           text,
  raw_body              text,
  matched_receipt_document_id uuid references public.receipt_documents(id),
  created_at            timestamptz not null default now()
);

create index if not exists bank_notifications_reference_number_idx
  on public.bank_notifications (reference_number);

alter table public.bank_notifications enable row level security;

create policy service_role_only on public.bank_notifications
  for all using (false);

drop policy if exists admin_workspace_read_bank_notifications on public.bank_notifications;
create policy admin_workspace_read_bank_notifications
  on public.bank_notifications
  for select
  to authenticated
  using (public.is_admin_workspace_user());
