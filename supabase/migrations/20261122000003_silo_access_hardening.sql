-- Restrict sensitive database surfaces until tenant-scoped read paths are proven.
-- This migration intentionally does not grant clients access to these views.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

ALTER VIEW public.v_available_assets SET (security_invoker = true);
ALTER VIEW public.v_conversation_current_business_link SET (security_invoker = true);
ALTER VIEW public.v_partner_fleet_summary SET (security_invoker = true);
ALTER VIEW public.v_partner_material_prices SET (security_invoker = true);

REVOKE ALL ON public.v_available_assets,
  public.v_conversation_current_business_link,
  public.v_partner_fleet_summary,
  public.v_partner_material_prices
FROM PUBLIC, anon, authenticated;

-- Keep authenticated access behind a profile role check; service-role access remains server-side.
REVOKE ALL ON public.dev_loop_check_results,
  public.dev_loop_evidence_events,
  public.dev_loop_registry_proposals,
  public.dev_loop_sessions
FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dev_loop_check_results,
  public.dev_loop_evidence_events,
  public.dev_loop_registry_proposals,
  public.dev_loop_sessions
TO authenticated;

DROP POLICY IF EXISTS "authenticated can read dev_loop_check_results"
  ON public.dev_loop_check_results;
DROP POLICY IF EXISTS "authenticated can read dev_loop_evidence_events"
  ON public.dev_loop_evidence_events;
DROP POLICY IF EXISTS "authenticated can read dev_loop_registry_proposals"
  ON public.dev_loop_registry_proposals;
DROP POLICY IF EXISTS "authenticated can read dev_loop_sessions"
  ON public.dev_loop_sessions;

CREATE POLICY dev_loop_admin_read_check_results
  ON public.dev_loop_check_results FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));
CREATE POLICY dev_loop_admin_read_evidence_events
  ON public.dev_loop_evidence_events FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));
CREATE POLICY dev_loop_admin_read_registry_proposals
  ON public.dev_loop_registry_proposals FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));
CREATE POLICY dev_loop_admin_read_sessions
  ON public.dev_loop_sessions FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));

REVOKE ALL ON public.subscription_services FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.subscription_services TO authenticated;
DROP POLICY IF EXISTS authenticated_read_subscription_services
  ON public.subscription_services;
CREATE POLICY subscription_services_admin_read
  ON public.subscription_services FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_admin()));

-- Establish the missing business ownership edge without guessing which company
-- owns any existing business profile. Existing rows remain unassigned (NULL).
ALTER TABLE public.business_profiles
  ADD COLUMN IF NOT EXISTS company_id uuid;

CREATE INDEX IF NOT EXISTS business_profiles_company_id_idx
  ON public.business_profiles (company_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.business_profiles'::regclass
      AND conname = 'business_profiles_company_id_fkey'
  ) THEN
    ALTER TABLE public.business_profiles
      ADD CONSTRAINT business_profiles_company_id_fkey
      FOREIGN KEY (company_id)
      REFERENCES public.companies (id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;
