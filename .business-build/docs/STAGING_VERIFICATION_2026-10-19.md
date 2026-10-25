# STAGING VERIFICATION — 2026-10-19 (BLOCKED BEFORE APPLY)

Mode: staging only. Production untouched. No commit / push / deploy.

## Identity & isolation (proven)

| Item | Value |
|---|---|
| BASE_SHA | `14139082fcdd29e6d03a79c05d146b2440cf5078` |
| Staging Supabase project | `zjhgysugbmyyciatmltv` (dna-os-staging, ap-southeast-1, org `bsnwqyhtsltdmejzgttb`) |
| Staging Railway | project `d5ae6989-1824-423b-b249-d6fea91eed4b`, env `5a86998f-…`, service `4464b4c0-…`, `https://dna-os-staging.up.railway.app` (HTTP 307) |
| Production Supabase project | `xeytcavxejhyzxwevgto` (ap-northeast-2) — **not contacted this run** |
| Isolation | different project ID, different org, different Railway project; staging Railway service holds its OWN `NEXT_PUBLIC_SUPABASE_URL` (staging ref) and its own keys. No production service-role is used for staging. |
| Staging project state | was `INACTIVE`; **restored to `ACTIVE_HEALTHY` for this verification** (still active — pause again if not continuing) |
| Staging deployment | latest SUCCESS = `2026-10-12T03:26Z`, commit `84d8c7f615216e6ece47d996f9a9a3ab03789347`, branch `main` — **7 days behind BASE_SHA** |

## Step 2 — cannot apply (dependency + backup gates)

Direct schema probes on staging (`api.supabase.com/v1/projects/…/database/query`):

| Probe | Result | Consequence |
|---|---|---|
| `supabase_migrations` schema | **absent** | migration history cannot be verified; staging was not built via tracked migrations |
| `organizations` table | **0** | `20261019000001` cannot apply |
| `org_members` table | **0** | `20261019000001` cannot apply |
| `companies.organization_id` | **0** | tenant V1 prerequisite missing |
| `tenant_has_membership(uuid)` | **0** | `20261019000003` cannot apply |
| ownership columns (`issuer_company_id` / `organization_id`) | **none** | `20261019000002` not applied (and would be unused alone) |
| documents / receipts / expenses rows | 0 / 0 / 0 / 0 | no legacy data to protect on staging |

Backup gate: `GET /v1/projects/{ref}/database/backups` →
`walg_enabled: true`, `pitr_enabled: false`, **`backups: []`**, `physical_backup_data: {}`.
There is no verified restore point, so applying migrations is prohibited by the mission's own rule ("สำรองข้อมูล Staging ก่อน").

**MIGRATIONS_APPLIED: none.**

## Blockers

1. **Missing prerequisite schema** — `20261019000001` needs `organizations`/`org_members`; `20261019000003` needs `tenant_has_membership`. Those come from `20261018000001..3`, which are outside the authorized migration list for this run. Applying them would be a separate, explicit decision.
2. **No backup** — zero backups, PITR disabled. Restore readiness unproven.
3. **Stale runtime** — the staging deployment predates every fix in this mission. Commit/push/deploy is denied, so LINE/matching cannot be verified end-to-end on fixed code.
4. **No LINE test channel credentials** — the Railway staging service exposes only `LINE_TOKEN_INTERNAL_SECRET`; no channel secret/access token for a test channel. Sending LINE messages is not possible and is forbidden anyway.

## Results

| Area | Status |
|---|---|
| RLS recursion | BLOCKED (migration cannot apply; prerequisites absent) |
| Cross-org isolation | BLOCKED |
| Document ownership | BLOCKED |
| Recipient grants | BLOCKED |
| Canonical writer (staging) | BLOCKED (writer not deployed; would need local code against staging DB after prerequisites) |
| Legacy document compatibility | NOT APPLICABLE (0 rows on staging; production census unchanged) |
| Matching & LINE E2E | BLOCKED (stale deploy + no test channel) |
| Rollback readiness | PARTIAL — scripts rehearsed locally 36/36 and 31/31, but no staging restore point exists |
| PRODUCTION_CHANGED | **NO** |

## Decision needed before continuing

1. Approve applying `20261018000001..3` (tenant core/scope/binding) to staging, or provide a staging DB rebuilt from the production schema baseline.
2. Enable/verify a staging backup (or approve a logical dump as the restore point).
3. Approve a staging deploy path that does not require a production push (the only current path is a GitHub push, which is denied).
4. Provide a LINE test channel (channel secret + access token + one test recipient) for the E2E step.

Not declaring PRODUCTION_READY.
