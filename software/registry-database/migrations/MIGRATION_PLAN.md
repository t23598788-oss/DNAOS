# software_registry — Migration Plan

**STATUS: NOT EXECUTED.** No statement in `0001_create_software_registry_schema.sql`
or `0001_create_software_registry_roles.sql` has been run against any
database, live or otherwise. This round builds and locally proves the
schema/writer/lookup source only — see
`../../../reports/SOFTWARE_REGISTRY_DATABASE_REPORT.md`.

## Pre-flight checklist (must ALL pass before production execution)

1. **Schema validation** — `0001_create_software_registry_schema.sql` runs
   cleanly against a disposable Postgres instance with no errors, and
   `\d software_registry.*` in `psql` shows all 7 tables with the exact
   columns `types.ts` declares.
2. **Duplicate constraints** — `resources.content_hash` UNIQUE,
   `capabilities.semantic_fingerprint` UNIQUE, and
   `relationships`'s `(from_type, from_id, to_type, to_id, relationship_kind)`
   UNIQUE all reject a manually-attempted duplicate insert with a real
   constraint-violation error (not silently accepted).
3. **Foreign key / relationship validation** — `resource_capabilities`,
   `versions`, and `evidence`'s foreign keys into `resources`/`capabilities`
   all reject an insert referencing a nonexistent id.
4. **Role separation** — after `0001_create_software_registry_roles.sql`
   runs, connecting as `business_runtime` and attempting any query against
   `software_registry.*` fails with a permission error; connecting as
   `software_registry_runtime` can `SELECT` but not `INSERT`/`UPDATE`/
   `DELETE`; connecting as `registry_writer` can `SELECT`/`INSERT`/`UPDATE`
   but not `DELETE`.
5. **Rollback rehearsal** — `ROLLBACK_0001.sql` runs cleanly against the
   same disposable instance and leaves no `software_registry` schema or
   dangling grant behind.
6. **Credential path reviewed** — whatever process ends up executing this
   migration against the real target database does so with a
   database-admin credential resolved through this repo's credential
   pattern (a `vault://`-style reference, never a literal secret in a
   migration runner's config) and is run by a human/CI operator, never an
   AI agent — per `../README.md`'s Schema Authority prohibitions and
   G-PERM-001.

## Execution owner

Whoever runs this migration for real must be a human operator (or a CI
pipeline a human operator triggers) with the actual target database's
connection details — not this repository's automation, and not any AI
agent. This document exists so that operator has a reviewable, one-shot
checklist rather than needing to reconstruct one from the SQL alone.
