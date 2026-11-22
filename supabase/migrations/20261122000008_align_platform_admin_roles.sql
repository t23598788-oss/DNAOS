-- Keep database access aligned with registry/permissions.json role_tiers.admin_tier.
-- The verified Supabase Auth user must own the matching profiles row.
-- No profile role is changed by this migration.

-- Production currently rejects `super_admin` despite the application registry
-- declaring it. Replace that constraint with the complete registered role set.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_without_super_admin;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_registered
  CHECK (role IN ('super_admin', 'admin', 'employee', 'partner', 'customer', 'ai_service'));

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
      AND profile.role IN ('super_admin', 'admin', 'employee')
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'Checks auth.uid() against profiles.id and the admin_tier declared in registry/permissions.json. Does not grant or infer a role.';
