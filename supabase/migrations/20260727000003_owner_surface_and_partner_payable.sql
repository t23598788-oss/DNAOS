-- Owner Dispatcher / Exception Router (owner, 2026-07-27): "ถ้า Message หรือ
-- Event เกิดจาก/ส่งหา User ID ของเฮีย ให้ถือว่าเป็น Owner Surface" — real gap
-- found live: line_profiles already has an 'owner' role value in its check
-- constraint (see 20260718000006_line_profiles.sql) but the real row for
-- เฮีย (line_user_id U32e25304fda44c95d41094480bcc120d) was tagged
-- role='manager' — same tier as "พี่หนุ่ม" — so nothing in the codebase could
-- ever distinguish the owner's own chat from any other manager's. Fixing
-- the data, not adding a new column (Rule 103 — reuse before build, the
-- 'owner' tier already existed in the schema, just never assigned).
update public.line_profiles
set role = 'owner'
where line_user_id = 'U32e25304fda44c95d41094480bcc120d' and role = 'manager';

-- Partner-Payable cascade (owner, 2026-07-27): mirror of the customer-
-- incoming-payment cascade ([[project_debt_invoice_unification]]), but on
-- the outgoing/partner side — see project_partner_purchase_cascade memory.
-- DNA OS holds no stock of its own; when a partner needs paying (they
-- issue a receipt/tax invoice TO the DNA OS company), the system notifies
-- the owner to transfer, the owner sends the confirming slip in this same
-- chat, and only then does the system resume: confirm to the partner,
-- record cost/profit. Unlike incoming customer payments, a bank
-- transfer-confirmation EMAIL genuinely CAN verify this transaction,
-- because the owner is the one INITIATING the transfer — Level 3 evidence
-- applies here in the direction it was always structurally valid for.
create table if not exists public.partner_payable_requests (
  id                    uuid primary key default gen_random_uuid(),
  partner_company_id    uuid references public.companies(id),
  partner_name          text not null,
  partner_line_user_id  text,
  amount                numeric not null,
  description           text,
  business_event_id     uuid references public.business_events(id),
  status                text not null default 'pending'
    check (status in ('pending', 'owner_acknowledged', 'paid_confirmed', 'completed')),
  owner_notified_at     timestamptz,
  owner_acknowledged_at timestamptz,
  paid_line_event_id    uuid references public.line_events(id),
  bank_email_verified   boolean not null default false,
  completed_at          timestamptz,
  created_at            timestamptz not null default now()
);

comment on table public.partner_payable_requests is
  'Owner Dispatcher partner-payable cascade: Trigger (a partner invoice/bill arrives) -> notify owner -> owner acknowledges (button) -> owner transfers + sends slip in chat (real Trigger for stage 2) -> Consensus (bank_notifications, valid here since the owner is the initiator) -> owner_acknowledged/paid_confirmed/completed. Never guesses: paid_confirmed only set once a real slip amount matches this row within +-5 THB.';

create index if not exists partner_payable_requests_status_idx
  on public.partner_payable_requests (status);

alter table public.partner_payable_requests enable row level security;
drop policy if exists service_role_only on public.partner_payable_requests;
create policy service_role_only on public.partner_payable_requests for all using (false);
