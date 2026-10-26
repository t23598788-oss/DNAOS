-- Gateway evidence was readable by EVERY authenticated session.
--
-- Owner security audit 2026-10-26, findings C8/C9: the policy was
--   "authenticated can read integration_gateway_events" ... USING (true)
-- so any logged-in account could read all 34 gateway events across every
-- provider (vscode, line, railway, supabase), and 1 of those events contains
-- credential-like strings in its evidence JSON.
--
-- Scope now matches every other tenant-aware table in this schema: workspace
-- staff only, via the existing SECURITY DEFINER helper `is_admin_workspace_user`
-- (profiles.id = auth.uid() AND role IN ('super_admin','admin','employee')).
-- `anon` has no policy and therefore still reads nothing; `service_role`
-- bypasses RLS as before, so server-side readers are unaffected.
--
-- `integration_gateway_events` has no organization_id column, so per-tenant
-- filtering cannot be expressed yet; if events ever carry tenant identity this
-- policy should become `tenant_has_membership(organization_id)` like
-- companies/storage_evidence.

drop policy if exists "authenticated can read integration_gateway_events"
  on public.integration_gateway_events;

drop policy if exists "staff can read integration_gateway_events"
  on public.integration_gateway_events;

create policy "staff can read integration_gateway_events"
  on public.integration_gateway_events
  for select
  to authenticated
  using (public.is_admin_workspace_user());

comment on policy "staff can read integration_gateway_events" on public.integration_gateway_events is
  'Owner audit 2026-10-26 (C8/C9): was USING(true) for every authenticated session; narrowed to workspace staff.';
