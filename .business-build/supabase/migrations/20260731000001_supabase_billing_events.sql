-- Automatic Supabase billing detection (owner, 2026-07-31): "ค่าใช้จ่ายของ
-- ค่าเช่าระบบซูเปอร์เบสจากอีเมลไฟล์ PDF...ตอนไหนที่มีอีเมลแจ้งเตือนเข้ามา
-- เกี่ยวกับค่าใช้จ่ายซูเปอร์เบสให้ระบบไปจับตรวจ...ให้แปลเงินดอลล่าร์เป็นเงิน
-- บาท" — real trigger found live: a genuine unpaid Supabase invoice email
-- (STUIEQ-00006, $39.51, org paused 2026-07-29 for non-payment, since
-- resolved) confirmed the real email format this table's sync function
-- parses against. Dedup table, same real pattern as bank_notifications'
-- own gmail_message_id uniqueness (bank-email-sync) — never re-notify the
-- owner twice for the same email.
create table if not exists public.supabase_billing_events (
  id                    uuid primary key default gen_random_uuid(),
  gmail_message_id      text not null unique,
  invoice_number        text,
  amount_usd            numeric not null,
  amount_thb            numeric,
  exchange_rate         numeric,
  email_subject         text,
  email_received_at     timestamptz,
  status                text not null default 'pending'
    check (status in ('pending', 'owner_notified', 'paid')),
  partner_payable_request_id uuid references public.partner_payable_requests(id),
  created_at            timestamptz not null default now()
);

alter table public.supabase_billing_events enable row level security;

create policy service_role_only on public.supabase_billing_events
  for all using (false);

create policy admin_workspace_read_supabase_billing_events
  on public.supabase_billing_events
  for select
  to authenticated
  using (public.is_admin_workspace_user());
