-- Cost Ledger wiring for subscription-email-sync (owner, 2026-08-03)
--
-- Owner's own diagram: "Email Received → Subscription Updated → Business
-- Event → Cost Ledger → Financial Dashboard" — company_expenses (2026-07-27)
-- already IS the real Cost Ledger (built for staff-submitted tax invoices),
-- just with submitted_by_line_user_id/submitted_by_role as NOT NULL because
-- every row up to now came from a real LINE chat sender. A system-detected
-- subscription charge has no LINE sender at all, so those columns become
-- nullable and a `source` column distinguishes where a row came from —
-- reusing the same real ledger (Rule 103) instead of a second parallel one.
alter table public.company_expenses
  alter column submitted_by_line_user_id drop not null,
  alter column submitted_by_role drop not null;

alter table public.company_expenses
  add column if not exists source text not null default 'line_chat', -- 'line_chat' | 'subscription_email_sync'
  add column if not exists subscription_service_id uuid references public.subscription_services(id);

create index if not exists company_expenses_subscription_service_id_idx
  on public.company_expenses (subscription_service_id);
