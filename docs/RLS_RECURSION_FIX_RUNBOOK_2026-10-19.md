# RLS RECURSION FIX — APPLY RUNBOOK (BACKUP + ROLLBACK)

Prepared 2026-10-19. **Nothing in this runbook has been applied to production.**

## Approval record

| Item | Status |
|---|---|
| `20261019000001_org_members_rls_recursion_fix.sql` | **APPROVED by owner (2026-10-19)** — apply still requires the backup step below and an explicit change window |
| Rollback caveat acknowledged | Rollback restores the 42P17 policy shape; it is a **state-restoration plan, not a security fix** |
| Backup | must exist before apply (step 2); no production apply without it |

Target: `supabase/migrations/20261019000001_org_members_rls_recursion_fix.sql`
Rollback: `supabase/rollback/20261019000001_org_members_rls_recursion_fix_rollback.sql`
Rehearsal: `npm run rls-fix:rehearse` (disposable local PostgreSQL, no production access)

## 1. What the change does

- Adds `tenant_is_org_member/admin/owner(uuid)` as `SECURITY DEFINER` helpers; `revoke all ... from anon, public`, `grant execute ... to authenticated`.
- Rewrites `organizations` (SELECT, UPDATE) and `org_members` (SELECT/INSERT/UPDATE/DELETE) policies to call those helpers instead of selecting the table they protect.
- Re-asserts `companies_select_member_only` as member-only-when-mapped.
- No DML, no column changes, no service-role grant.

## 2. Pre-change backup (required before apply)

Run against the **target database**, with credentials that can read schema (read-only support role is enough for dump):

```bash
STAMP=$(date +%Y%m%dT%H%M%S)
mkdir -p "backups/${STAMP}_rls_prechange"

# 2.1 full schema + data dump (custom format, restorable)
pg_dump "$DATABASE_URL" -Fc -f "backups/${STAMP}_rls_prechange/full.dump"

# 2.2 policy inventory BEFORE (diff this after apply)
psql "$DATABASE_URL" -At -c "
  select schemaname||'.'||tablename||' | '||policyname||' | '||cmd||' | '||coalesce(qual,'-')
  from pg_policies
  where schemaname='public'
    and tablename in ('organizations','org_members','companies')
  order by 1;"
```

If the environment cannot run `pg_dump`, use Supabase's dashboard/CLI dump
(`supabase db dump -f ...`) — a logical dump of at least
`organizations`, `org_members`, `companies` plus policies is mandatory.

Record in the change ticket: dump path, byte size, SHA-256, row counts:

```sql
select 'organizations' t, count(*) from public.organizations
union all select 'org_members', count(*) from public.org_members
union all select 'companies', count(*) from public.companies;
```

## 3. Staging rehearsal (required before production)

1. Restore the dump into a scratch/staging database.
2. Apply the migration there with `ON_ERROR_STOP=1`.
3. Verify the matrix with simulated JWTs: A reads A, A cannot read B, B reads B,
   B cannot read A, C reads nothing, admin A cannot write B, anon reads nothing,
   no `42P17`.
4. The repository rehearsal proves the same on a disposable database:
   `npm run rls-fix:rehearse` → expected `36 PASS / 0 FAIL`.
   It also restores the pre-change dump into a second database and compares rows.

## 4. Apply (owner approval + change window)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
  supabase/migrations/20261019000001_org_members_rls_recursion_fix.sql
```

Post-apply checks (same session, read-only):

```sql
-- no self-reference on the protected table
select count(*) from pg_policies
where tablename='org_members' and qual like '%org_members%';   -- expect 0

-- helpers exist, anon cannot execute
select proname, prosecdef from pg_proc
where proname like 'tenant_is_org_%';                          -- expect 3, true

-- row counts unchanged from step 2
```

Then re-run the application smoke: `GET /rest/v1/org_members` and
`GET /rest/v1/organizations` with a real user JWT must return 200 with only
that user's rows (previously 500 `42P17`).

## 5. Rollback (only if the fix misbehaves)

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
  supabase/rollback/20261019000001_org_members_rls_recursion_fix_rollback.sql
```

- Restores the V1 recursive policies and drops the three helpers.
- **This returns the system to the 42P17 failure state** — it withdraws the fix,
  it does not restore a working product. The rehearsal asserts exactly this.
- Data is untouched (policies carry no rows). If data must also be restored,
  use the step-2 dump; that is a separate, explicit decision.

## 6. Rehearsal evidence (local, 2026-10-19)

`npm run rls-fix:rehearse` → **36 PASS / 0 FAIL**

- pre-change dump restored into a second database: 2 orgs / 3 members / 2 companies
- old policy reproduced `42P17`
- A/B/C + admin matrix passed (24 checks)
- fix: 4 `org_members` policies, 2 `organizations` policies, no self-select,
  no `service_role` grant
- rollback: helpers gone, recursive policy restored, rows unchanged
- production untouched; no service-role used for user checks

## 7. Production verification (item 3 — before public launch)

Run only after the migration is applied, from a machine that can reach the real
environment. Everything here is read-only except the two test documents noted.

```bash
# V1 — the recursion is gone (was HTTP 500 / 42P17)
curl -s -o /dev/null -w '%{http_code}\n' "$SUPABASE_URL/rest/v1/org_members?select=user_id&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"   # expect 200 (empty) or 401, never 500

# V2 — cross-org isolation with two real TEST users (JWT of A and B)
for u in A B; do echo -n "$u -> "; curl -s "$SUPABASE_URL/rest/v1/organizations?select=id" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_$u" | head -c 300; echo; done
# A must see only A's org, B only B's; neither may see the other's id.

# V3 — the user's own membership row is visible, the other org's is not
curl -s "$SUPABASE_URL/rest/v1/org_members?select=organization_id,role" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT_A"
```

LINE verification (real engine, no customer traffic):

1. Point a staging webhook at the deployed function with a dedicated test LINE
   channel — never the production channel.
2. Send one quote request for a material whose only matching pit is **closed**;
   expected reply is "ยังไม่มีบ่อไหนในระบบตั้งราคา…" and **no** quote card.
3. Send one for a published, priced pit; expected: delivered price card whose
   quote id resolves to a real `business_events` row, and no pit name in the text.
4. Confirm `ResponseGateway` is the only outbound path in the function logs.

Do not mark production verified from the sandbox suite alone — these checks must
run against the real environment with real JWTs.

## 8. Open decisions

- Owner approval to apply (not granted yet).
- Backup retention window and storage location.
- Whether production apply runs through the migration pipeline or the manual
  statement above (must be recorded either way).
