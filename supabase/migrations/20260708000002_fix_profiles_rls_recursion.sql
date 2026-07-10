-- Fix: profiles_select_admin_tier (added in 20260708000001_profiles_roles.sql)
-- caused "infinite recursion detected in policy for relation profiles"
-- (42P17) — it queried public.profiles from inside its own USING clause,
-- which Postgres re-evaluates under the same RLS policy, recursing forever.
-- Every authenticated user's own profile lookup (core/auth/session.ts's
-- getAuthedUser) failed as a result, so every login bounced back to /login.
--
-- Dropped rather than rewritten as a SECURITY DEFINER function: nothing in
-- the app actually depends on it. /api/admin/users (the one place that
-- lists every profile) reads via the service-role client, which bypasses
-- RLS entirely — this policy was unused, speculative dead weight.
-- profiles_select_own (auth.uid() = id) is untouched and is all that
-- getAuthedUser() and app/login's landingPathFor() ever needed.

drop policy if exists "profiles_select_admin_tier" on public.profiles;