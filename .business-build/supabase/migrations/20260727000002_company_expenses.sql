-- Internal-Sender Expense Auto-Recording (owner, 2026-07-27): real gap
-- found live — "พี่หนุ่ม" (line_profiles.role='manager', trust_level=
-- 'verified') sent real ใบกำกับภาษี (tax invoices) into the chat, and the
-- system correctly classified them (tax_invoice, 95% confidence) but then
-- did nothing with them — line_profiles' real role/trust data was never
-- read anywhere in the document pipeline (confirmed via grep: zero
-- references in ocr-classify.ts/process-classified-image.ts). Owner's
-- explicit instruction: a document from a verified internal person
-- (manager — covers both the owner "เฮีย" and real staff like "พี่หนุ่ม")
-- is not a customer payment claim, it's a real company cost — record it
-- automatically, no human-confirm queue needed (that queue exists for
-- unverified/external claims, per Rule 72/115).
create table if not exists public.company_expenses (
  id                    uuid primary key default gen_random_uuid(),
  receipt_document_id   uuid references public.receipt_documents(id),
  document_type         text not null, -- tax_invoice | invoice | receipt | fuel_bill
  amount                numeric,
  vendor_name           text,
  expense_date          date,
  submitted_by_line_user_id text not null,
  submitted_by_name     text,
  submitted_by_role     text not null,
  created_at            timestamptz not null default now()
);

create index if not exists company_expenses_expense_date_idx
  on public.company_expenses (expense_date);

alter table public.company_expenses enable row level security;

create policy service_role_only on public.company_expenses
  for all using (false);

drop policy if exists admin_workspace_read_company_expenses on public.company_expenses;
create policy admin_workspace_read_company_expenses
  on public.company_expenses
  for select
  to authenticated
  using (public.is_admin_workspace_user());
