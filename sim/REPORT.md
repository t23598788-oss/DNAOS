# sim/REPORT.md — outside-world simulator, run 01

- Base URL: `http://127.0.0.1:3000` (real Next.js dev server, real routes)
- Database the app itself uses: `xeytcavxejhyzxwevgto.supabase.co` (see STEP 0 — this is the deployment the repo documents as Production)
- Run date: 2026-11-09T16:01:47.358Z

## Step 0 — what can actually run here

| question | answer | evidence |
|---|---|---|
| (a) local DB reachable with schema? | Local Postgres 18.4 at 127.0.0.1:5432 answers, but the app does **not** use it: the app is wired to `xeytcavxejhyzxwevgto.supabase.co`. Local `dna_os_local` has 63 public tables and is missing `integration_gateway_events`, `truck_jobs`, `truck_events`, `kbank_webhook_events`, `payout_audit_log`. | psql \l / information_schema queries |
| (b) can the Deno LINE function run? | **NO.** `docker`, `podman`, `colima`, `deno` are all absent, so `supabase functions serve` cannot start. The order-creating LINE path therefore cannot be exercised through the Deno function locally. | `command -v docker` -> not found |
| (c) is the Next.js app runnable? | **YES** — `GET /` -> HTTP 200; `next dev` 16.2.9 ready in 206 ms. | `curl http://127.0.0.1:3000/` |
| (d) are the secrets present? | **NONE of the four** (`LINE_CHANNEL_SECRET`, `KBANK_WEBHOOK_SECRET`, `CRON_SECRET`, `DRIVER_TRACKING_SECRET`). `.env.local` carries LINE_TOKEN_INTERNAL_SECRET and KBANK_KGP_* instead. | key-name scan of `.env.local` (values never printed) |
| (e) is the local AI path running? | **YES** — ollama on 127.0.0.1:11434 (`qwen3:8b`, `qwen2.5-coder:1.5b`), `/api/tags` -> 200. No stub was substituted anywhere. | `ollama list`, curl |

**Plainly:** the order-creating Deno LINE path cannot be exercised locally without Docker. The Next.js ingress/worker path *is* reachable and was exercised; its results are below, labelled as the Next.js path.

## Timeline — scenario 01 (one order, fake money)

| # | Step | Expected | Actual (HTTP code / DB value) | Gap or OK | Where it breaks (file:line if visible) |
|---|---|---|---|---|---|
| 00 | customer LINE: "อยากได้ทราย 500 คิว ส่งพรุ่งนี้" | HTTP 200, reply sent to the customer | HTTP 503 {"error":"no LINE channel secret configured for this account"} | GAP | app/api/gateway/observe/line/route.ts:32-44 (secret) / 46-49 (signature) |
| 01 | DB: integration_gateway_events +1 | one EVT-line row for this message | no row changed | GAP | app/api/gateway/observe/line/route.ts:51-57 (publish) -> engines/integration-gateway/evidence/store.ts |
| 02 | clock: cron gateway-workers | {translated:1, reconciled:0, dispatched:0, approvalRequested:0} | HTTP 401 {"ok":false,"error":"unauthorized"} | GAP | app/api/cron/gateway-workers/route.ts:51-56 (CRON_SECRET gate) |
| 03 | DB: customer_orders status = DRAFT | a DRAFT order for the sand request | no order row was created by this run | GAP | engines/integration-gateway/workers/order-translator.ts:141-158 (insert; NOT NULL columns left undefined) |
| 3.5 | partner: reply a price / accept | HTTP 200 from a partner-facing endpoint | HTTP 404 <!DOCTYPE html><html lang="th" class="geist_a71539c9-module__T19VSG__variable geist_mono_8d43a2aa-module__8Li5zG__variable h-full antialiased"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/chunks/%5Broot-o… | NO_ROUTE | no app/api/partner/** route exists (only app/api/admin/partners/*) |
| 04 | bank: payment webhook 250,000 THB | HTTP 200 with an event id | HTTP 404 (empty body) | GAP | app/api/connectors/webhook/kbank/route.ts:34 (params.slug on a non-dynamic route) -> 404 |
| 05 | clock: cron gateway-workers again | reconciled:1, order status = PAID | HTTP 401 {"ok":false,"error":"unauthorized"} | GAP | app/api/cron/gateway-workers/route.ts:51-56 |
| 06 | DB: truck_jobs BROADCASTED | >=1 broadcasted truck job for the paid order | {"code":"PGRST205","details":null,"hint":"Perhaps you meant the table 'public.trucks'","message":"Could not find the table 'public.truck_jobs' in the schema cache"} | GAP | engines/integration-gateway/workers/order-dispatcher.ts:101 (truck_jobs read/insert) |
| 07 | driver: GET available-jobs | the broadcasted job is visible | HTTP 503 {"ok":false,"error":"driver tracking not configured"} | GAP | app/api/driver/_lib/driver-auth.ts:40-49 (DRIVER_TRACKING_SECRET) / available-jobs route:33-45 |
| 08 | driver: accept job | status ACCEPTED | not attempted — [06] produced no job id (and the board returned no job) | SKIPPED | depends on step 6 |
| 09 | driver: advance through 5 stages to DELIVERED | truck_jobs.current_status = DELIVERED | not attempted — no job to advance | SKIPPED | depends on step 8 |
| 10 | admin: approve payout | HTTP 200, order -> PAYOUT_APPROVED -> SETTLED | queue=HTTP 401 {"ok":false,"error":"ต้อง login ก่อนใช้งาน"} \| approve=HTTP 401 {"ok":false,"error":"ต้อง login ก่อนใช้งาน"} — blocked by the admin auth guard before routing, so an outside client cannot reach the action at all | GAP | admin API is login-gated (401); behind the guard only app/api/admin/orders/[orderId]/dispatch/route.ts exists — no route calls executeApprovedPayout (only tests/e2e/kbank-payment-flow.test.ts) |
| 11 | summary | order SETTLED, truck job DELIVERED, payout audited | see final DB state | GAP | - |

## Answers

1. **How far did the run get?** To step [00] customer LINE: "อยากได้ทราย 500 คิว ส่งพรุ่งนี้". Every later step was still attempted (or explicitly recorded as not attemptable) so the whole door chain is measured in one run.
2. **First real gap.** Step [00]: `POST /api/gateway/observe/line` never accepts a signed LINE event because no channel secret is configured for the destination account and `LINE_CHANNEL_SECRET` is unset locally. That is a **missing piece** (deployment credential), not a bug in the route: the route is correctly fail-closed. Immediately behind it, still a missing piece rather than a code bug, sit the missing `integration_gateway_events.status` column and the four absent tables.
3. **What could not be attempted at all?** (i) the Deno `line-webhook-v2` function — no Docker/deno; (ii) any step requiring a real signed LINE delivery for the same reason as (1); (iii) any step requiring a real payout approval — the route does not exist; (iv) any partner step — no partner API exists; (v) the cron with a valid secret was deliberately NOT fired: it would mutate two live PAID orders (payout-worker.ts:76-86) before failing on the missing audit table.
4. **Does the system ever produce a happy path today?** **No.** Not one step of the eleven produces the state the business expects.

## Raw exchanges (what actually went over the wire)

| actor | request | signed | status | body |
|---|---|---|---|---|
| customer | POST /api/gateway/observe/line | no | 503 (380 ms) | {"error":"no LINE channel secret configured for this account"} |
| clock | GET /api/cron/gateway-workers | no | 401 (9 ms) | {"ok":false,"error":"unauthorized"} |
| partner | POST /api/partner/quotes | no | 404 (25 ms) | <!DOCTYPE html><html lang="th" class="geist_a71539c9-module__T19VSG__variable geist_mono_8d43a2aa-module__8Li5zG__variable h-full antialiased"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/_next/static/chunks/%5Broot-of-the-server%5D__0cbk-n2._.css" data-precedence="next_static/chunks/[root-of-the-server]__0cbk-n2._. |
| bank | POST /api/connectors/webhook/kbank | no | 404 (9 ms) | (empty) |
| clock | GET /api/cron/gateway-workers | no | 401 (10 ms) | {"ok":false,"error":"unauthorized"} |
| driver | GET /api/driver/available-jobs | no | 503 (16 ms) | {"ok":false,"error":"driver tracking not configured"} |
| admin | GET /api/admin/orders?status=PAYOUT_PENDING_APPROVAL | no | 401 (4 ms) | {"ok":false,"error":"ต้อง login ก่อนใช้งาน"} |
| admin | POST /api/admin/orders/00000000-0000-0000-0000-000000000001/payout/approve | no | 401 (4 ms) | {"ok":false,"error":"ต้อง login ก่อนใช้งาน"} |

Signature/token notes per exchange:

- customer — line webhook: message text: LINE_CHANNEL_SECRET is not set locally — request sent with NO signature
- clock — cron: gateway-workers (translate -> reconcile -> dispatch -> payout request): CRON_SECRET not set locally — request sent with NO Authorization header
- partner — reply a price for the order: no partner credential scheme exists in this repo (no /api/partner/** route)
- bank — payment webhook 250000 THB for SIM-sim01-NOORDER: no KBANK signing secret in env and none in a connector row — sent unsigned
- clock — cron: gateway-workers (translate -> reconcile -> dispatch -> payout request): CRON_SECRET not set locally — request sent with NO Authorization header
- driver — open the job board (available jobs): DRIVER_TRACKING_SECRET not set locally — x-driver-token omitted
- admin — read the payout approval queue: unauthenticated read probe
- admin — approve the payout (human step): admin console call — no signature scheme in this codebase for admin routes

## Writes made to the deployment

**Zero.** Every row delta in the timeline reads `no row changed`, and `npx tsx sim/reset.ts` afterwards deleted 0 rows from every table. `integration_gateway_events` stayed at 39 rows and `customer_orders` at 2 rows before and after the run.

## Static findings (read from code/schema, NOT observed by this run)

These are here because the doors above were shut; each one is the next thing that would break. They are labelled static on purpose.

- `integration_gateway_events` in the deployment has NO `status` column (PostgREST 42703). Every worker filters `.eq("status", "received")` and updates `status` — engines/integration-gateway/workers/order-translator.ts:105, reconciler.ts:80, order-dispatcher.ts, payout-worker.ts. The pipeline cannot advance a single event even with a valid CRON_SECRET.
- `truck_jobs`, `truck_events`, `kbank_webhook_events`, `payout_audit_log` do not exist in the deployment at all (HTTP 404 from the database's own REST API). Their migrations exist locally: supabase/migrations/20261109150000_truck_tracking.sql:15, 20261109104212_kbank_raw_staging.sql, payout_audit_log migration.
- `customer_orders` requires project_id, document_group_id, customer_company_id, customer_site_id (NOT NULL, no defaults). order-translator inserts `?? undefined` for all four — engines/integration-gateway/workers/order-translator.ts:143-147 — so the insert can never succeed for a real LINE message.
- The LINE adapter's evidence whitelist (engines/integration-gateway/adapters/line.ts:37-52) has no key for the message text. "อยากได้ทราย 500 คิว ส่งพรุ่งนี้" is discarded at the boundary, so no downstream worker can ever read the quantity or the material.
- The KBank adapter emits `evidence.reference` (engines/integration-gateway/adapters/kbank.ts:178) but the reconciler reads `evidence.reference_id` / `evidence.order_id` (engines/integration-gateway/workers/reconciler.ts:99-106). Even with the table fixed, a payment can never match an order.
- The KBank 404 body is EMPTY from the second request onward: `const NOT_FOUND = NextResponse.json(...)` is built once at module scope (app/api/connectors/webhook/kbank/route.ts:32) and reused, and a Response body can only be read once. Observed: first run body `{"error":"ไม่พบ Webhook Connector นี้"}`, later runs HTTP 404 with an empty body.
- `app/api/connectors/webhook/kbank/route.ts:34` destructures `{ slug }` from `params`, but the route path has no dynamic segment, so `slug` is always undefined -> `getConnectedConnector(db, undefined)` -> 404 connector_not_found before any signature check.
- No admin route calls `executeApprovedPayout`. It is referenced only by engines/integration-gateway/workers/payout-worker.ts:123 and tests/e2e/kbank-payment-flow.test.ts. The documented human step PAYOUT_PENDING_APPROVAL -> PAYOUT_APPROVED has no HTTP surface at all.
- There is no partner-facing API: app/api has `/api/admin/partners/*` only. A supplier cannot quote a price or accept a job through this system.
- Every admin action is behind a login guard: the run got 401 {"ok":false,"error":"ต้อง login ก่อนใช้งาน"} for /api/admin/orders/... — so an outside actor cannot reach ANY admin step (dispatch, payout approval, debt actions) without a session. The simulator cannot create one, and creating one would be system logic, not outside world.
- `reconcilePayouts` mutates the order to PAYOUT_PENDING_APPROVAL (payout-worker.ts:76-86) BEFORE inserting the audit row (payout-worker.ts:94). With payout_audit_log missing, that ordering would leave an order advanced with no audit trail — which is why this harness did NOT fire the cron with a real secret against the live database.

## What this run did NOT do

- It made **no write** to the deployment database. Every request was rejected by the system before any write; the DB deltas above are all `no row changed`.
- It did not fabricate a signature or token. Where a secret is missing, the request went out unsigned and the system's real rejection is reported.
- It did not fire the cron with a real secret, because the deployment holds two live PAID orders that phase 4 would advance.
- It did not apply migrations to the deployment: that is a production change, not a simulation.
