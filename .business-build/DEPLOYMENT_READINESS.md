# Deployment Readiness Audit — Phase 2.5

Read-only. No code modified in this phase. Every item below is backed by a command run in this session, not assumed.

## Summary Table

| # | Category | Status | Reason |
|---|---|---|---|
| 1 | Build | **READY** | `npm run build` — clean, zero errors, all routes compile |
| 2 | Type Check | **READY** | `npm run type-check` — clean, zero errors |
| 3 | Runtime | **PARTIAL** | Builds and starts locally; never observed running under real production load/traffic |
| 4 | Routing | **READY** | Build output enumerates every route without error; middleware protection confirmed on all protected prefixes |
| 5 | Environment Variables | **PARTIAL** | Core vars present in Vercel Production; one non-core admin feature's var unconfirmed (see blockers) |
| 6 | Registry | **PARTIAL** | 0 BROKEN, 4 genuine unresolved orphans (Phase 2.3B) — none block runtime, but governance gate itself doesn't pass clean |
| 7 | Database | **PARTIAL** | Live data queries work; migration tracking is desynced from local files (see blockers) |
| 8 | Authentication | **READY** | Real login verified against live DB this session with real credentials (`hasSession: true`) |
| 9 | Authorization | **READY** | 100% of `app/api/admin/*` routes confirmed calling `requireAuth`; middleware gates every protected prefix |
| 10 | API | **PARTIAL** | All routes compile; error-handling coverage not verified per-route (see below) |
| 11 | Workflow | **PARTIAL** | 70% business domain coverage per this project's own governance check; 3 domains (คลังสินค้า/สต๊อก, บุคลากร, บัญชี/งบการเงิน) explicitly MISSING |
| 12 | External Services | **PARTIAL** | Supabase confirmed live; LINE/Cloudflare/Hostinger connectors exist but their Enabled/Connected status in production wasn't re-verified this pass |
| 13 | AI | **PARTIAL** | OpenAI bridge is referenced by real code, but flagged as dead code by this project's own `knip` check in the prior phase — needs reconciling |
| 14 | LINE | **PARTIAL** | Real webhook edge function + credentials confirmed present in Vercel; not exercised end-to-end this pass |
| 15 | Background Jobs | **READY** | Real Supabase Edge Functions exist (`debt-reminder-cron`, `line-webhook-v2`, `trigger-complete`, etc.) |
| 16 | Scheduler | **READY** | `debt-reminder-cron` confirmed real, migration-backed (fires every 10 min per its own source comment) |
| 17 | Error Handling | **NOT VERIFIED** | Spot check found 5 `app/api/admin/*/route.ts` files with no `try {` block — not confirmed whether that's a real gap or an intentional pattern; not exhaustively audited across all ~130 routes |
| 18 | Logging | **PARTIAL** | Extensive `[TRACE-AUTH]`/`[TRACE-LOGIN]` `console.log` calls added this session for debugging real production issues — real diagnostic value, but verbose debug logging left in place, not gated behind an environment check |
| 19 | Health Checks | **NOT READY** | No dedicated health-check endpoint exists anywhere in `app/api/` |

## Detail on the PARTIAL / NOT READY items

### 5. Environment Variables
Confirmed via `vercel env ls production`: `NEXT_PUBLIC_APP_URL`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `OPENAI_API_KEY` are all genuinely present in Production. `VERCEL_TOKEN` (used only by `engines/domains/vercel-binding.ts`, the domain-management admin feature) was not found in that list — this affects one specific admin capability, not core app function.

### 6. Registry
From Phase 2.3B, same session: Registry Sync improved from 9 BROKEN / 44 UNUSED to 0 BROKEN / 4 UNUSED. The remaining 4 (`line-webhook-v2/helpers.ts`, `engines/impact/engine.ts`, `core/auth/index.ts`, `components/admin/AdminSidebarNav.tsx`) are confirmed genuine orphans with no evidence of intended status — `npm run guard` still exits non-zero because of these. None of the 4 are imported by anything, so they don't affect runtime behavior directly, but the governance gate itself is not clean.

### 7. Database
`supabase migration list --linked` shows every local migration file from `20260620000000` onward with an **empty Remote column** — meaning the tracking table does not record them as applied. This is not the same as "the schema is missing them": this session directly queried real, working tables (`companies`, `invoices`, `customer_orders`, `material_types`) multiple times with real results. The most likely explanation is that schema changes were applied through a path that didn't update `supabase_migrations.schema_migrations` (e.g., direct SQL via `supabase db query`, used repeatedly this session for surgical fixes) rather than `supabase db push`. This is a real risk: a future `supabase db push` could attempt to re-apply changes that already exist, causing conflicts. Not verified further this pass — would need a manual diff between migration file contents and live schema to fully resolve.

### 10 / 17. API / Error Handling
Build success confirms every route compiles and Next.js can route to it — it does not confirm runtime error handling quality. A grep for `try {` across `app/api/admin/*/route.ts` found 5 files without one. I did not read each of those 5 to determine if that's a real gap (unhandled exception → 500 with a stack trace leak) or an intentional pattern (e.g., a shared error-handling wrapper, or genuinely no fallible operation in that route). Flagging as unverified rather than asserting either way.

### 11. Workflow
Pulled directly from this project's own `npm run guard` business-coverage check (same session, Phase 2.3B run): 8/12 domains OK, 1 PARTIAL (ซ่อมบำรุง/เครื่องจักร), 3 MISSING (คลังสินค้า/สต๊อกวัสดุ, บุคลากร/คนขับรถ/ช่าง, บัญชี/งบการเงิน) — 70% coverage. This is the project's own self-assessment, not newly discovered.

### 13. AI
`services/ai/bridge-openai.ts` is imported by `core/runtime/existence-intelligence.ts` and `engines/events/event-builder.ts` (confirmed via grep this pass) — but the same file appeared in the `knip` "Unused files" list during Phase 2.3B's guard run. These aren't necessarily contradictory (the *importers* themselves could be part of an unreached chain — `existence-intelligence.ts` is a CLI script, not something the running web app invokes), but I did not reconcile this fully. Flagging as a real open question, not resolved.

### 18. Logging
Real, valuable diagnostic logging (`[TRACE-AUTH]`, `[TRACE-LOGIN]`) was added earlier this session specifically to debug a real production login failure. It remains in `middleware.ts`, `services/supabase/server.ts`, `services/supabase/browser.ts`, and `core/auth/session.ts`, running on every request in production right now, unconditionally (not gated behind `NODE_ENV` or a debug flag). Not a correctness bug, but verbose enough to be worth gating before considering logging "production-clean."

### 19. Health Checks
No `/api/health`-style endpoint exists. Uptime monitoring, load balancer health checks, or Vercel's own deployment health verification have nothing dedicated to check against beyond "does any page 200."

## Not re-verified this pass (real, but pre-existing/already known from earlier session work, not re-run now)
- Authentication: relies on the real login verification already done earlier this session (`dnaos.tech@gmail.com`, real Supabase Auth call, `hasSession: true`) — not re-run in this pass.
- Supabase RLS/security posture: relies on the Supabase security fix already completed and documented earlier this session (`v_all_documents` RLS bypass fixed; `spatial_ref_sys` RLS warning accepted as a platform limitation) — not re-audited in this pass.

## The one finding that matters most, found first in this pass and not yet mentioned above

**98 files are currently uncommitted** (`git status --porcelain | wc -l`). Only one commit from this entire multi-day session has ever been pushed (the original login-bounce fix, `326f67d`). This means: **everything else audited above — the Visual Workspace, Capability Registry, Composer/Planner/Orchestrator, the Phase 2.3A dependency refactor, the Phase 2.3B registry fixes, all of it — does not exist on whatever is currently deployed to production.** Whatever this audit says about the current *working tree* has no bearing on what a user hitting `dnaos.dev` right now actually experiences, until these changes are committed and pushed.

---

## Can this project be deployed safely?

## NO

### Blockers, in priority order

1. **Nothing audited in this report is actually deployed.** 98 uncommitted files, only 1 commit ever pushed this entire session. This isn't a code-quality blocker — it's that "deploy" and "the state I just audited" currently refer to two completely different codebases. This must be resolved (commit + push, deliberately and reviewed, not as a single 98-file dump) before any of the other findings are even relevant to a real production deployment.
2. **Migration tracking is desynced from the live database.** A blind `supabase db push` in this state carries real risk of conflicting with schema changes that already exist but aren't recorded as applied. Needs a manual reconciliation pass before any further migrations are pushed.
3. **No health-check endpoint.** Needed for any real production monitoring/alerting setup.
4. **3 of 12 business domains have zero implementation** (inventory/stock, personnel/drivers, accounting/financial statements) — whether this blocks *this* deployment depends on whether those domains are in scope for the current release; flagging since "deployment readiness" should include a conscious decision here, not a silent gap.
5. **Registry governance gate does not pass clean** (4 unresolved orphan modules) — low runtime risk, but means `npm run guard` cannot be used as a clean CI gate as-is.
6. **Error handling coverage unverified** across ~130 API routes — 5 found with no `try` block in a spot check; not confirmed as real gaps, but not confirmed safe either.
7. **Verbose debug logging ungated** in the auth path — not a correctness issue, but worth resolving before calling logging "production-ready."
