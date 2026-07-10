-- Approval queue for outbound LINE messages that carry real financial figures
-- (owner instruction 2026-07-10: ยอดการเงินต้องผ่านการตรวจสอบเฮียก่อน — Rule 72).
-- Non-sensitive answers (e.g. "no debt") still reply immediately; anything
-- with a real amount lands here as a draft until a human clicks send.

create table if not exists public.line_outbound_drafts (
  id             uuid primary key default gen_random_uuid(),
  line_user_id   text not null,
  company_id     uuid references public.companies(id),
  reason         text not null,
  proposed_text  text not null,
  final_text     text,
  context        jsonb,
  status         text not null default 'pending_review',
  created_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  sent_at        timestamptz
);

create index if not exists line_outbound_drafts_status_idx on public.line_outbound_drafts (status);
create index if not exists line_outbound_drafts_line_user_id_idx on public.line_outbound_drafts (line_user_id);

alter table public.line_outbound_drafts enable row level security;
drop policy if exists service_role_only on public.line_outbound_drafts;
create policy service_role_only on public.line_outbound_drafts for all using (false);
