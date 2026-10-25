-- Outbound Supplier RFQ tracking (owner, 2026-07-24, Autonomous Supply Chain
-- Orchestrator Step 3): pit_profiles.line_user_id already existed (real,
-- live, 16/78 pits already have one set) but nothing ever used it to ask a
-- supplier for a current price. This table is the audit trail linking a
-- real outbound "ขอราคา" message to whatever reply comes back, so the LINE
-- webhook's reply parser has something concrete to match against (a pit can
-- be asked about more than one material).

create table if not exists public.pit_price_requests (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  pit_profile_id     uuid not null references public.pit_profiles(id),
  material_type_id   uuid not null references public.material_types(id),
  requested_quantity numeric,
  line_user_id       text not null,
  requested_by       text not null,
  status             text not null default 'pending' check (status in ('pending', 'answered', 'expired')),
  reply_text         text,
  reply_price        numeric,
  replied_at         timestamptz
);

create index if not exists pit_price_requests_pit_profile_id_idx on public.pit_price_requests (pit_profile_id);
create index if not exists pit_price_requests_line_user_id_status_idx on public.pit_price_requests (line_user_id, status);

alter table public.pit_price_requests enable row level security;
drop policy if exists service_role_only on public.pit_price_requests;
create policy service_role_only on public.pit_price_requests for all using (false);
