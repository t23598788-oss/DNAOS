-- print_jobs: bridges the cloud LINE webhook (Deno, Supabase) and the real
-- local printer (Brother DCP-T430W, physically attached to the owner's Mac,
-- WiFi/AirPrint via CUPS). Cloud writes a row when a customer sends a
-- document photo + payment via LINE; a local watcher script running on the
-- Mac polls this table and executes the real print job — the cloud function
-- has no way to reach a printer on a home WiFi network directly.
create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  media_path text not null,
  document_kind text,
  copies integer not null default 1,
  amount_expected numeric,
  amount_paid numeric,
  payment_verified boolean not null default false,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'printed', 'notified', 'failed')),
  print_error text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  printed_at timestamptz,
  notified_at timestamptz
);

create index if not exists print_jobs_status_idx on public.print_jobs (status);
create index if not exists print_jobs_line_user_idx on public.print_jobs (line_user_id);

alter table public.print_jobs enable row level security;

create policy service_role_only on public.print_jobs
  for all using (false);
