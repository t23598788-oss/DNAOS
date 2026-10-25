-- Rollback for 20261025000002_authority_grants_proposal.sql
--
-- Run manually only, after the application no longer reads the table (the loader
-- treats a missing table as "no grants", so leaving the code in place would fail
-- closed rather than widen access — but the explicit order is still app first).
--
-- The table is new and holds only delegation rows; dropping it removes delegated
-- authority entirely (owners keep their existing ownership path, which lives on
-- pit_profiles / customer_sites and is untouched).
--
-- Before dropping, export the rows if any delegation was issued — they are not
-- recoverable from anywhere else:
--   \copy (select * from public.authority_grants) to 'authority_grants_backup.csv' csv header
--
-- Verify after: select to_regclass('public.authority_grants');  -- null

drop table if exists public.authority_grants;
