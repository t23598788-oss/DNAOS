-- Payout Audit Log table
-- Stores every payout-related decision so the owner/admin can reconstruct
-- who approved, who rejected, and who executed a payout for each order.
create table if not exists public.payout_audit_log (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  action text not null check (action in ('request', 'approve', 'reject', 'execute')),
  actor_id text,
  reason text,
  created_at timestamptz not null default now(),
  constraint fk_payout_audit_log_order foreign key (order_id)
    references public.customer_orders (id) on delete cascade
);

create index if not exists idx_payout_audit_log_order on public.payout_audit_log (order_id);
create index if not exists idx_payout_audit_log_action on public.payout_audit_log (action);
create index if not exists idx_payout_audit_log_created on public.payout_audit_log (created_at desc);
