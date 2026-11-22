-- Read-only guard: run against a disposable/local DB before any migration work.
-- This test must never add/remove constraints, change users, or grant a role.
DO $$
DECLARE
  constraint_text text;
  platform_helper text;
  workspace_helper text;
  role_type_exists boolean;
  has_legacy_role boolean;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO constraint_text
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'profiles'
    AND c.conname IN ('profiles_role_without_super_admin', 'profiles_role_registered')
  ORDER BY CASE WHEN c.conname = 'profiles_role_without_super_admin' THEN 0 ELSE 1 END
  LIMIT 1;

  IF constraint_text IS NULL OR position('super_admin' IN lower(constraint_text)) > 0 THEN
    RAISE EXCEPTION 'profiles role constraint missing or still permits a platform-wide role';
  END IF;

  SELECT pg_get_functiondef('public.is_platform_admin()'::regprocedure)
    INTO platform_helper;
  SELECT pg_get_functiondef('public.is_admin_workspace_user()'::regprocedure)
    INTO workspace_helper;
  IF position('select false' IN lower(platform_helper)) = 0
     OR position('select false' IN lower(workspace_helper)) = 0 THEN
    RAISE EXCEPTION 'legacy global database readers are not fail-closed';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role'
  ) INTO role_type_exists;

  IF role_type_exists THEN
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'app_role'
        AND e.enumlabel = 'super_admin'
    ) INTO has_legacy_role;
    IF has_legacy_role THEN
      RAISE EXCEPTION 'app_role enum still contains a platform-wide role';
    END IF;
  END IF;
END $$;
