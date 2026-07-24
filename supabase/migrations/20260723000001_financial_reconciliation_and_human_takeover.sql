-- Financial safety: one atomic payment reconciliation and an explicit
-- human-takeover state for LINE conversations.

create table if not exists public.line_conversation_controls (
  line_user_id text primary key,
  mode text not null default 'ai' check (mode in ('ai', 'human_takeover')),
  reason text,
  detected_line_event_id uuid references public.line_events(id),
  assigned_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists line_conversation_controls_mode_idx
  on public.line_conversation_controls(mode);

alter table public.line_conversation_controls enable row level security;
drop policy if exists service_role_only on public.line_conversation_controls;
create policy service_role_only on public.line_conversation_controls
  for all using (false);

-- The webhook calls this function with the service role. The row lock and the
-- matched_debt_event_id guard make retries idempotent: one slip can create one
-- debt event and reduce one snapshot only once.
create or replace function public.reconcile_receipt_payment(
  p_receipt_id uuid,
  p_actor text default 'system:line-slip'
)
returns table (
  receipt_id uuid,
  company_id uuid,
  amount numeric,
  previous_outstanding numeric,
  new_outstanding numeric,
  debt_event_id uuid,
  already_reconciled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.receipt_documents%rowtype;
  s public.debt_snapshots%rowtype;
  e public.debt_events%rowtype;
begin
  select * into r from public.receipt_documents where id = p_receipt_id for update;
  if not found then raise exception 'receipt_not_found'; end if;
  if r.matched_debt_event_id is not null or r.status = 'confirmed' then
    receipt_id := r.id;
    company_id := r.customer_company_id;
    amount := coalesce(r.amount, 0);
    debt_event_id := r.matched_debt_event_id;
    already_reconciled := true;
    select ds.total_outstanding into new_outstanding from public.debt_snapshots ds
      where ds.customer_company_id = r.customer_company_id;
    previous_outstanding := new_outstanding + amount;
    return next;
    return;
  end if;
  if r.document_type <> 'transfer_slip' or r.customer_company_id is null or coalesce(r.amount, 0) <= 0 then
    raise exception 'receipt_not_reconcilable';
  end if;

  select * into s from public.debt_snapshots
    where customer_company_id = r.customer_company_id for update;
  if not found then raise exception 'debt_snapshot_not_found'; end if;

  previous_outstanding := coalesce(s.total_outstanding, 0);
  amount := r.amount;
  new_outstanding := greatest(previous_outstanding - amount, 0);

  insert into public.debt_events
    (customer_company_id, event_type, amount, occurred_at, note, source)
  values
    (r.customer_company_id, 'receipt_received', r.amount,
     coalesce(r.transaction_datetime::date, now()::date),
     'LINE slip auto-reconciled; receipt ' || r.id::text, 'line_chat')
  returning * into e;

  update public.debt_snapshots
    set total_outstanding = new_outstanding, updated_at = now()
    where customer_company_id = r.customer_company_id;

  update public.receipt_documents
    set status = 'confirmed', matched_debt_event_id = e.id,
        confirmed_by = p_actor, payment_verified = true, updated_at = now()
    where id = r.id;

  receipt_id := r.id;
  company_id := r.customer_company_id;
  debt_event_id := e.id;
  already_reconciled := false;
  return next;
end;
$$;

revoke all on function public.reconcile_receipt_payment(uuid, text) from public, anon, authenticated;
grant execute on function public.reconcile_receipt_payment(uuid, text) to service_role;
