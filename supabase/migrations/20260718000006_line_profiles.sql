-- LINE Profile — Business Evidence Context (owner, 2026-07-18)
--
-- Owner's framing: a generic ERP treats every incoming photo as "an
-- attachment" and guesses its type blind. DNA OS should know WHO sent it
-- first — a driver, a customer, a supplier, an employee — because that
-- context makes classification a reasoned inference instead of a guess
-- ("คนขับรถส่งรูป -> มีโอกาสเป็นใบเสร็จน้ำมัน/ใบชั่ง/ค่าทางด่วน", "ลูกค้าส่งรูป ->
-- มีโอกาสเป็นสลิป/Payment Advice"). Confirmed via explore-agent trace: no
-- existing table captures "role of this specific LINE contact" — the closest
-- thing, `partners.partner_type_id`/`partner_type_label`, classifies a
-- COMPANY (customer vs supplier), not a person, and doesn't cover roles with
-- no company at all (driver, external individual). This table is genuinely
-- new, linked to (not duplicating) `partners`/`companies` via an optional
-- company_id — a driver or external individual can have role with no company
-- link; a customer/supplier contact usually does.

-- No FK to company_line_links: that table only covers LINE contacts already
-- matched to a company, but the whole point of role here is to also cover
-- people who DON'T have a company match at all (drivers, employees,
-- external individuals) — line_user_id is the raw LINE id, same value
-- line_events.line_user_id already carries, no referential constraint.
create table if not exists public.line_profiles (
  line_user_id  text primary key,
  display_name  text,
  role          text not null default 'external'
    check (role in ('employee', 'customer', 'supplier', 'driver', 'owner', 'contractor', 'accountant', 'manager', 'admin', 'external')),
  company_id    uuid references public.companies(id),
  department    text,
  trust_level   text not null default 'unverified'
    check (trust_level in ('verified', 'unverified', 'flagged')),
  notes         text,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now()
);

comment on table public.line_profiles is
  'Who a LINE contact IS (role/organization/trust), not what they said — used to bias document classification (a driver''s photo is probably fuel/weighbridge; a customer''s is probably a payment slip; a supplier''s is probably a tax invoice/DO) instead of guessing blind. Optional per contact — a contact with no row here is simply unclassified (role defaults to external, not silently assumed to be anything specific).';
comment on column public.line_profiles.role is
  'employee/customer/supplier/driver/owner/contractor/accountant/manager/admin/external — biases OCR classification prompts, never forces a classification outright.';
comment on column public.line_profiles.trust_level is
  'verified = identity/role confirmed by a human. unverified = default, no confirmation yet. flagged = known suspicious sender (e.g. sent a fake slip before) — surfaced to reviewers, not auto-blocked.';

create index if not exists line_profiles_company_id_idx on public.line_profiles (company_id);

alter table public.line_profiles enable row level security;
drop policy if exists service_role_only on public.line_profiles;
create policy service_role_only on public.line_profiles for all using (false);
