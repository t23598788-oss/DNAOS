-- software/registry-database/migrations/0001_create_software_registry_roles.sql
--
-- Database role separation for software_registry, per the task's
-- Database Security requirement: business_runtime / software_registry_runtime
-- / registry_writer are three distinct roles with distinct grants.
-- registry_writer is the ONLY role with write permission on this schema;
-- software_registry_runtime is read-only (backs the Lookup API);
-- business_runtime gets no access at all (this schema is not its
-- concern — G-DEP-002).
--
-- STATUS: NOT EXECUTED. Run only after MIGRATION_PLAN.md's pre-flight
-- checklist passes, and only after 0001_create_software_registry_schema.sql
-- has been applied. Must be run by a human/CI operator with database-admin
-- privileges — never by an AI agent, never via a dashboard, per
-- ../README.md's prohibitions and G-PERM-001 (no supabaseAdmin()/
-- service-role bypass as an authorization model).

begin;

-- business_runtime: the operational/business system's own runtime role.
-- Gets explicitly NO access to software_registry — it owns its own
-- database directly (G-DEP-002) and has no legitimate reason to touch
-- this schema at all. If this role does not already exist in the target
-- database (it is expected to, as the pre-existing business runtime
-- role), this statement is a no-op guard, not a role-creation blocker.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'business_runtime') then
    create role business_runtime nologin;
  end if;
end
$$;
revoke all on schema software_registry from business_runtime;
revoke all on all tables in schema software_registry from business_runtime;

-- software_registry_runtime: the ONLY role the Lookup API (findCapability)
-- runs as. Read-only, no exceptions.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'software_registry_runtime') then
    create role software_registry_runtime nologin;
  end if;
end
$$;
grant usage on schema software_registry to software_registry_runtime;
grant select on all tables in schema software_registry to software_registry_runtime;
alter default privileges in schema software_registry grant select on tables to software_registry_runtime;

-- registry_writer: the ONLY role the Registry Writer (registerCandidate)
-- runs as. Select/insert/update, but never delete — registration_events
-- is append-only and resources/capabilities are superseded via status
-- transitions, never deleted, so no role is ever granted DELETE here.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'registry_writer') then
    create role registry_writer nologin;
  end if;
end
$$;
grant usage on schema software_registry to registry_writer;
grant select, insert, update on all tables in schema software_registry to registry_writer;
revoke delete on all tables in schema software_registry from registry_writer;
revoke update on software_registry.registration_events from registry_writer;
alter default privileges in schema software_registry grant select, insert, update on tables to registry_writer;

commit;
