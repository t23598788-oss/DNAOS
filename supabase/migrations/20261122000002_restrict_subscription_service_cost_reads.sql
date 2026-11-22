-- Gmail-observed subscriptions have no verified payer or organization owner.
-- Keep them away from tenant business users; permit only the admin workspace
-- reader until ownership is verified. This does not claim these are DNA OS
-- platform costs or customer business expenses.

begin;

drop policy if exists "authenticated_read_subscription_services"
  on public.subscription_services;
drop policy if exists "admin_workspace_read_subscription_services"
  on public.subscription_services;

revoke all on table public.subscription_services from public, anon, authenticated;
grant select on table public.subscription_services to authenticated;
grant all on table public.subscription_services to service_role;

create policy "admin_workspace_read_subscription_services"
  on public.subscription_services
  for select
  to authenticated
  using (public.is_admin_workspace_user());

comment on table public.subscription_services is
  'Recurring services observed from the configured Gmail mailbox. Payer and organization ownership are unverified; this is not the business expense ledger. Read access is restricted to admin-workspace users; ingestion uses service_role.';

commit;
