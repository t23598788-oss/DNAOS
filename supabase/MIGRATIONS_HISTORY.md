# Migration history reconciliation (2026-11-11)

`supabase db push` reconciles every version recorded in the remote
`supabase_migrations.schema_migrations` table against a file in
`supabase/migrations/`. Before 2026-11-11 the two sides disagreed in both
directions, so the CLI refused to run at all (`Remote migration versions not
found in local migrations directory`).

## What was done

- **5 local migrations that were already applied directly** were recorded with
  `supabase migration repair --status applied` (no DDL re-run):
  `20261103000000`, `20261103000001`, `20261103000002`,
  `20261110190000`, `20261110191000`.
- **14 remote-only versions** received placeholder files. A placeholder carries
  the exact version/name and **no SQL**; because the version is already applied
  it is never executed. Do not add schema changes to them. Their real DDL lives
  only in the linked project, so a fresh database must be restored from a dump
  (`supabase db dump`) — `db reset` cannot rebuild them from this directory.
- **`20260804000007_file_existence_intelligence.sql`** shared a timestamp with
  the already-applied `ai_connection_stage1` migration. It was re-versioned to
  `20261111110000_file_existence_intelligence.sql`, applied (all statements are
  `IF NOT EXISTS`), and recorded. Its three tables already held real data and
  kept it: `file_existence_registry` 1 row, `file_snapshots` 42,
  `destructive_action_log` 48.
- **4 manual rollback scripts** moved to `supabase/rollbacks/` — they are not
  migrations and must never be auto-applied:
  `20260804000007_ai_connection_stage1_rollback.sql`,
  `20260804000010_ai_connection_oauth_stage2_rollback.sql`,
  `20261025000001_material_price_atomic_v1_rollback.sql`,
  `20261025000002_authority_grants_rollback.sql`.
- **`supabase/one-off/20261110180000_purge_mock_line_data.sql`** is a manual
  cleanup script, deliberately outside `migrations/`: it contains unconditional
  `DELETE` statements and was never applied (its predicates matched 0 rows when
  it was moved).

## Verifying

```bash
npx supabase migration list --linked     # no blank Local/Remote cells
npx supabase db push --dry-run --linked  # exit 0, nothing to push
```

`db push` still skips non-`.sql` files and any file whose name does not match
`<14-digit timestamp>_name.sql`; keep this file and the rollback directory
outside `migrations/` for that reason.
