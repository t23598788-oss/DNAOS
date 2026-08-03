-- Subscription/Infrastructure Cost Observer (owner, 2026-08-03)
--
-- Owner's own words: "ให้ระบบเป็นผู้สังเกต (Observer) ไม่ใช่ให้คนเป็นผู้ไล่เช็กเอง"
-- — real gap found live: a ฿1,750/mo Google AI Pro renewal was discovered
-- only by accident (owner scrolling Gmail), same class of "silently paying
-- for something nobody's tracking" already covered for ONE provider
-- (supabase_billing_events, 2026-07-31) but not generalized. This table is
-- that generalization — one registry row per detected recurring service,
-- populated by supabase/functions/subscription-email-sync (regex-based,
-- reuses the same real Gmail OAuth connector as bank-email-sync/
-- supabase-billing-sync per Rule 103, not a second Gmail integration).
create table if not exists public.subscription_services (
  id uuid primary key default gen_random_uuid(),
  provider text not null,                 -- "Google", "OpenAI", "Anthropic", "RunPod", ...
  service_name text not null,             -- "Google AI Pro (10TB)"
  category text,                          -- "ai" | "cloud" | "development" | "other"
  amount numeric,
  currency text default 'THB',
  billing_cycle text,                     -- "monthly" | "yearly" | "usage" | null (unknown)
  next_billing_date date,
  payment_method text,                    -- "Visa-4575" — masked, never full card number
  status text not null default 'active',  -- "active" | "cancelled" | "unknown"
  auto_renew boolean,
  last_invoice text,                      -- invoice/order number from the email
  email_source text,                      -- gmail_message_id, for audit trail + dedup
  confidence text not null default 'low', -- "high" (regex matched a known provider format) | "low" (needs human review)
  raw_subject text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_source)
);

create index if not exists idx_subscription_services_provider on public.subscription_services(provider);
create index if not exists idx_subscription_services_status on public.subscription_services(status);

alter table public.subscription_services enable row level security;

drop policy if exists "service_role_all_subscription_services" on public.subscription_services;
create policy "service_role_all_subscription_services" on public.subscription_services
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "authenticated_read_subscription_services" on public.subscription_services;
create policy "authenticated_read_subscription_services" on public.subscription_services
  for select using (auth.role() = 'authenticated');
