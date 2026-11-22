-- Run with `supabase db query --linked --file supabase/tests/platform_admin_role_gate.sql`.
-- All schema/data changes are rolled back; the test account is transaction-local.
BEGIN;

CREATE TEMP TABLE role_gate_test_subject (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO role_gate_test_subject VALUES (gen_random_uuid());
INSERT INTO auth.users (id, email, created_at, updated_at)
SELECT id, id::text || '@example.invalid', now(), now()
FROM role_gate_test_subject;
INSERT INTO public.profiles (id, email, role)
SELECT id, id::text || '@example.invalid', 'customer'
FROM role_gate_test_subject;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_without_super_admin;
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_registered;
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
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.role IN ('super_admin', 'admin', 'employee')
  );
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- Exercise both allowed and denied roles against a real auth.uid() subject.
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM role_gate_test_subject);
SELECT set_config(
  'request.jwt.claim.sub',
  (SELECT id::text FROM role_gate_test_subject),
  true
);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'admin role was not accepted (uid %, role %)',
      auth.uid(),
      (SELECT role FROM public.profiles WHERE id = auth.uid());
  END IF;
END $$;

RESET ROLE;
UPDATE public.profiles
SET role = 'customer'
WHERE id = (SELECT id FROM role_gate_test_subject);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.is_platform_admin() THEN
    RAISE EXCEPTION 'customer role was incorrectly accepted';
  END IF;
END $$;

RESET ROLE;
UPDATE public.profiles
SET role = 'super_admin'
WHERE id = (SELECT id FROM role_gate_test_subject);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'super_admin role/constraint was not accepted';
  END IF;
END $$;

ROLLBACK;
