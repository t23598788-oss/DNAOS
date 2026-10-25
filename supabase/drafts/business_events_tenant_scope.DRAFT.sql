-- DRAFT — NOT APPLIED. Do not move into supabase/migrations/ until approved.
--
-- business_events has no tenant column today. Its only RLS policy denies everyone
-- except service_role (see 20260710000001_business_events.sql), so tenant isolation
-- for this table is not enforced anywhere in the database.
--
-- This draft is additive and does not backfill:
--   * organization_id is nullable. Existing production rows stay NULL.
--   * A NULL organization_id is DENIED by dna_enrich_and_transition_event (fail-closed).
--   * The read policy only opens rows to authenticated members of the owning org.
--
-- Depends on organizations and org_members from 20261018000001_tenant_core_v1.sql,
-- and on public.tenant_is_org_member() from 20261019000001_org_members_rls_recursion_fix.sql.

ALTER TABLE public.business_events
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

CREATE INDEX IF NOT EXISTS business_events_organization_idx
  ON public.business_events (organization_id);

-- Read: members of the owning organization only. service_role keeps its bypass.
DROP POLICY IF EXISTS business_events_select_member ON public.business_events;
CREATE POLICY business_events_select_member
  ON public.business_events FOR SELECT
  TO authenticated
  USING (organization_id IS NOT NULL AND public.tenant_is_org_member(organization_id));
