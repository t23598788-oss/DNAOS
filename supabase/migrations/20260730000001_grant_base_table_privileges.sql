-- Local-migration bootstrap fix (owner, 2026-07-30, KM-007 —
-- registry/existence.json known_mistakes): real incident — sign-in
-- succeeded (a real JWT was issued) but every page bounced straight back
-- to /login with "permission denied for table profiles" (42501). Root
-- cause: a cloud Supabase project automatically grants baseline
-- SELECT/INSERT/UPDATE/DELETE to the anon/authenticated roles on every
-- table created via the dashboard/migrations, as part of the managed
-- platform's own setup — `supabase start` (self-hosted local stack) does
-- NOT replicate this automatically. RLS policies (e.g. profiles_select_own)
-- only narrow rows AFTER the base table-level GRANT already passes; they
-- can never substitute for a missing GRANT. Every real table in this
-- project was missing SELECT/INSERT/UPDATE/DELETE for anon/authenticated
-- locally (confirmed via \dp — only D/x/t/m were present, no r/w/a),
-- because this was never needed before this session's local-migration
-- effort (RLS + service_role always did the real work in production).
--
-- Safe in production: granting privileges that already exist there is a
-- no-op. RLS policies (already correct and already applied) continue to
-- do the actual per-row access control in both environments — this only
-- fixes the base grant that a fresh local Postgres never had.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- So tables created by any FUTURE migration get the same base grant
-- automatically, without needing to remember this step again.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
