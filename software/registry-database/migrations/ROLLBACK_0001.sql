-- software/registry-database/migrations/ROLLBACK_0001.sql
--
-- Recovery plan for 0001_create_software_registry_schema.sql +
-- 0001_create_software_registry_roles.sql. NOT EXECUTED — reviewable
-- source only, per MIGRATION_PLAN.md.
--
-- Run in this order. Revoking grants before dropping the schema avoids a
-- window where a role still believes it has access to a schema that is
-- mid-drop.

begin;

revoke all on all tables in schema software_registry from registry_writer;
revoke all on schema software_registry from registry_writer;
revoke all on all tables in schema software_registry from software_registry_runtime;
revoke all on schema software_registry from software_registry_runtime;

drop schema if exists software_registry cascade;

commit;

-- Roles themselves are left in place (dropping a role that may be
-- referenced elsewhere in the database is a separate, deliberate decision,
-- not a default part of this rollback). If a full role removal is ever
-- required:
--   drop role if exists registry_writer;
--   drop role if exists software_registry_runtime;
-- business_runtime is never dropped by this rollback — it is not owned by
-- this migration.
