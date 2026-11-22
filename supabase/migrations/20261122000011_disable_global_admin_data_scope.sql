-- Remove the remaining role-only database-wide data readers.
-- No profile role can establish ownership for system/developer history or
-- subscription cost rows. Keep historical migrations untouched; this is the
-- current superseding state. Server service_role access remains server-only.

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT false;
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_admin_workspace_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT false;
$$;

REVOKE ALL ON FUNCTION public.is_admin_workspace_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin_workspace_user() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'Disabled: a profile role alone never grants cross-organization access. Replace with resource-scoped authorization only.';
COMMENT ON FUNCTION public.is_admin_workspace_user() IS
  'Disabled: legacy global workspace policies fail closed until each table has verified owner scope.';
