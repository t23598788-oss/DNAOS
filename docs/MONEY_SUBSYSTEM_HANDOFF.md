# Money Subsystem — Handoff

_Last verified: 2026-11-10 against HEAD `592ebda3` and DB project `xeytcavxejhyzxwevgto`._

## 1. What this subsystem does (one paragraph, plain language)

A customer talks to us on LINE; that message becomes a `customer_orders` row (`DRAFT` → `SUBMITTED`), KBank tells us the money landed (webhook → `integration_gateway_events` → `PAID`), a truck job is opened at `BROADCASTED` so a driver can take the goods, and then — and only then, and only with a human saying yes — the platform pays the seller out through KBank's payout API using the amount that appears on the order's invoices, recording every decision in `payout_audit_log`. Nothing in the chain invents money: amounts come from `invoices.total_amount`, and every step fails closed (no payload, no state advance, an audit row explaining why) rather than guessing.

## 2. The flow, end to end

```
 CUSTOMER (LINE)
   │  message "สั่งทราย 10 คิว"
   ▼
 POST /api/gateway/observe/line              app/api/gateway/observe/line/route.ts:31
   │  verifies x-line-signature (route.ts:56-59), normalises (route.ts:61)
   ▼
 publish() → integration_gateway_events       status='received', event_id='EVT-line-<webhookEventId>'
                                              (adapters/line.ts:93-94)
   │
   │  GET /api/cron/gateway-workers  (phase 1)   app/api/cron/gateway-workers/route.ts:66
   ▼
 translateLineMessageEvents()                order-translator.ts:284
   │  inserts customer_orders status='DRAFT'      (order-translator.ts:399-414)
   │  marks event status='processed'             (order-translator.ts:424-428)
   ▼
 CUSTOMER replies "ยืนยัน" → confirmOrder()   order-translator.ts:134
   │  DRAFT → SUBMITTED (guarded .in("status",["DRAFT"]))   (order-translator.ts:155-161)
   ▼
 KBANK payment webhook
 POST /api/connectors/webhook/kbank           app/api/connectors/webhook/kbank/route.ts:46
   │  webhookGate (signature) → kbank_webhook_events status='received'  (route.ts:83-92)
   │  normalizeKBankWebhook() → publish() → integration_gateway_events  (route.ts:109-117)
   ▼
 reconcileKBankPayments()  (cron phase 2)     reconciler.ts:100
   │  SUBMITTED|PAID → PAID                     (reconciler.ts:226-230, MATCHABLE_STATUSES at :65)
   │  event → 'processed', else 'unmatched'      (reconciler.ts:242-246 / 211-215)
   ▼
 dispatchPendingOrders()  (cron phase 3)      order-dispatcher.ts:142
   │  PAID → truck_jobs current_status='BROADCASTED'  (truck-tracker.ts:158, :174)
   │  truck_events event_type='JOB_BROADCASTED'       (truck-tracker.ts:53-61)
   ▼
 DRIVER: accept → en route → picked up → at site → delivered
 POST /api/driver/tracking  →  truck-tracker.ts:198 acceptJob / :253 updateJobStatus
   │  strict 7-step chain (truck-tracker.ts:42-50)
   ▼
 reconcilePayouts()  (cron phase 4)           payout-worker.ts:466
   │  requestPayoutApproval(): PAID → PAYOUT_PENDING_APPROVAL   (payout-worker.ts:124-131)
   │  audit action='request'                                     (payout-worker.ts:141-146)
   ▼
 HUMAN (admin)
 POST /api/admin/payouts/[orderId]/approve    app/api/admin/payouts/[orderId]/approve/route.ts:17
   │  X-Admin-Secret gate (route.ts:29-32)
   │  resolves amount from invoices.total_amount (route.ts:93-124)
   │  PAYOUT_PENDING_APPROVAL → PAYOUT_APPROVED (guarded)         (route.ts:128-136)
   │  audit action='approve' + "amount resolved from invoices: …" (route.ts:156-162)
   ▼
 executeApprovedPayout(orderId, actorId, { amount })   payout-worker.ts:170
   │  amount ≤ 0 → PAYOUT_FAILED + audit 'reject' (fail-closed)   (payout-worker.ts:209-241)
   │  buildPayoutPayload() → sendPayout()                        (payout-worker.ts:255-274)
   │  success → SETTLED + audit 'execute'                         (payout-worker.ts:310-334)
   │  API error → PAYOUT_FAILED + audit 'reject'                  (payout-worker.ts:275-306)
   ▼
 KBANK payout API   services/kbank/kapi-payout.ts:134
```

**Order status state machine (money half):**

```
DRAFT ──▶ SUBMITTED ──▶ PAID ──▶ PAYOUT_PENDING_APPROVAL ──▶ PAYOUT_APPROVED ──▶ SETTLED
                            │              │                        │
                            │              └──▶ PAYOUT_REJECTED     └──▶ PAYOUT_FAILED
                            └──▶ (nothing else may pay)
```

## 3. State machine reference

`CustomerOrderStatus` has **19 values** in the live DB (verified: `select array_length(enum_range(null::"CustomerOrderStatus"),1)` → 19; seven were added by `supabase/migrations/20261110100000_add_payout_enum_values.sql:8-14`).

| Value | Meaning | Written by (file:line) |
|---|---|---|
| `DRAFT` | Order opened from an inbound message, not confirmed yet | order-translator.ts:407 |
| `SUBMITTED` | Customer confirmed; pending payment | order-translator.ts:157 |
| `PRICING` | Staff is pricing the job | engines/transactions/workflows.ts:77 (workflow table); no money-path writer |
| `QUOTED` | A price was offered | workflows.ts:78 |
| `CONFIRMED` | Order confirmed as a purchase | workflows.ts:79 |
| `CANCELLED` | Cancelled before any money moved | status union at workflows.ts:23-24; no money-path writer |
| `PROCUREMENT` | Sourcing goods | workflows.ts:80 |
| `DISPATCHING` | Shipment started | workflows.ts:81 |
| `PARTIALLY_DELIVERED` | Part of the goods delivered | workflows.ts:82 |
| `DELIVERED` | All goods delivered (order status; `truck_jobs.current_status='DELIVERED'` is a different, truck-level field) | workflows.ts:83 |
| `INVOICED` | Invoice issued | workflows.ts:84 |
| `PAID` | Money received and matched to this order | reconciler.ts:226-230 |
| `PAYOUT_PENDING_APPROVAL` | Queued for a human payout decision | payout-worker.ts:126-131 |
| `PAYOUT_APPROVED` | A human said yes; executor may run | approve route:128-136 |
| `PAYOUT_FAILED` | Executor refused (no amount) or KBank rejected | payout-worker.ts:214-221, 279-286 |
| `PAYOUT_REJECTED` | A human said no | reject route:91-99 |
| `SETTLED` | KBank accepted the payout payload | payout-worker.ts:310-317 |
| `CANCELLED_REFUNDED` | Cancelled, full refund issued | services/finance/cancellation-policy.ts (returned status), written at cancellation-worker.ts:124-131 |
| `CANCELLED_PARTIAL_REFUND` | Cancelled, partial refund issued | same as above |

**Legal transitions the code enforces (each UPDATE is guarded on the exact prior status, so a stale or concurrent writer cannot double-apply):**

- `DRAFT → SUBMITTED` — `.in("status", ["DRAFT"])`, order-translator.ts:155-161
- `SUBMITTED|PAID → PAID` — `.in("status", MATCHABLE_STATUSES)` (SUBMITTED, PAID), reconciler.ts:65, 226-230
- `PAID → PAYOUT_PENDING_APPROVAL` — `.eq("status","PAID")`, payout-worker.ts:124-131
- `PAYOUT_PENDING_APPROVAL → PAYOUT_APPROVED` — `.eq("status","PAYOUT_PENDING_APPROVAL")`, approve route:128-136
- `PAYOUT_PENDING_APPROVAL → PAYOUT_REJECTED` — `.eq("status","PAYOUT_PENDING_APPROVAL")`, reject route:91-99
- `PAYOUT_APPROVED → SETTLED` — `.eq("status","PAYOUT_APPROVED")`, payout-worker.ts:310-317
- `PAYOUT_APPROVED → PAYOUT_FAILED` — `.eq("status","PAYOUT_APPROVED")`, payout-worker.ts:214-221 (no amount) and :279-286 (API error)
- `PAID → CANCELLED_REFUNDED|CANCELLED_PARTIAL_REFUND` — `.eq("status","PAID")`, cancellation-worker.ts:124-131
- Truck job chain (separate field, `truck_jobs.current_status`): `BROADCASTED → ACCEPTED → EN_ROUTE_TO_PICKUP → PICKED_UP → EN_ROUTE_TO_CUSTOMER → AT_SITE → DELIVERED`, strict single-successor table at truck-tracker.ts:42-50, applied at :278. The 7 statuses are declared at truck-tracker.ts:16-24.

## 4. Tables that matter

Live column counts from `information_schema` (project `xeytcavxejhyzxwevgto`, 2026-11-10).

| Table | Purpose | Owner (writer) | Invariants the code depends on |
|---|---|---|---|
| `integration_gateway_events` (15 cols) | Normalised inbound events from every provider, the queue the workers drain | event bus `engines/integration-gateway/event-bus/bus.ts` (insert), each worker (status flip) | `event_id` unique per delivery; workers read only `status='received'` and advance to `processed`/`unmatched` exactly once (reconciler.ts:242-246, 211-215; order-translator.ts:424-428 guard on `status='received'`) |
| `kbank_webhook_events` (6 cols: `id, event_id, raw_body, headers, received_at, status`) | Raw-byte audit trail of KBank webhooks, written **before** normalisation | kbank webhook route:83-92 | Insert must succeed or the request 500s (route.ts:94-102); `status='received'` is the default marker; `event_id` is `sha256:<hash>` or the provider id |
| `customer_orders` (12 cols) | The order spine and the money state machine | order-translator, reconciler, payout routes, cancellation worker | No amount column exists — money is on `invoices` (approve route:89-92); four anchor FKs are NOT NULL (`project_id`, `document_group_id`, `customer_company_id`, `customer_site_id`, see OrderAnchors at order-translator.ts:74-79); every status write is guarded by the previous status |
| `invoices` (27 cols) | The only source of truth for how much money an order owes | transaction/invoice workflow (not this subsystem) | `total_amount` NOT NULL; `invoice_status ∈ {DRAFT, SENT, PARTIALLY_PAID, PAID, VOID}`; only `SENT/PARTIALLY_PAID/PAID` count as payable — `ACTIVE_INVOICE_STATUSES` at approve route:61, `PAYABLE_INVOICE_STATUSES` at payout-worker.ts:38. `customer_order_id` is nullable, so an orphan invoice cannot be paid out |
| `invoice_items` (9 cols) | Line items of an invoice | invoice workflow | Cascades from `invoices` (`invoice_items_invoice_id_fkey`); the payout path never reads them, it sums `invoices.total_amount` |
| `truck_jobs` (7 cols) | One job per order, one dedicated truck | `broadcastJob` truck-tracker.ts:158, `acceptJob` :198, `updateJobStatus` :253 | At most one non-`DELIVERED` job per order — partial unique index in `supabase/migrations/20261109160000_truck_job_unique_order.sql`, mirrored by the guard at order-dispatcher.ts:107-127 |
| `truck_events` (6 cols) | Append-only tracking stream (actor, metadata/GPS/photo) | truck-tracker (every status change) | One row per status change; `event_type` mirrors the status via `EVENT_TYPE_BY_STATUS` (truck-tracker.ts:53-61) |
| `payout_audit_log` (6 cols: `id, order_id, action, actor_id, reason, created_at`) | Every human/system payout decision | approve route:156, reject route:119, payout-worker:141 (`request`), :229 & :295 (`reject`), :328 (`execute`) | `action ∈ {request, approve, reject, execute}`; `order_id` is uuid with FK to `customer_orders` (migration `2026102600000*`-series fix, commit 350a0cfa). This table is the money audit trail — never delete rows to "tidy up" |
| `connect_external_identities` (13 cols) | Canonical Connect identity model (provider + external subject → company/role/trust) | `engines/connect/identity.ts:147` (`linkExternalIdentity`) | **Write path for LINE identity.** Projection triggers `connect_project_identity_ins/upd/del` (AFTER INSERT/UPDATE/DELETE) maintain the legacy tables |
| `line_profiles` (10 cols) | Legacy LINE profile projection | projection trigger only | Read-only in practice — writing/`DELETE`ing it directly fights the guard/there is no code path that does so |
| `company_line_links` (3 cols: `company_id, line_user_id, created_at`) | Legacy company↔LINE link projection | projection trigger only | Has trigger `connect_identity_legacy_guard` (`BEFORE INSERT OR DELETE OR UPDATE`) that raises `42501`… a **read-only projection**, never `DELETE` directly (see §13) |
| `companies` / `projects` / `customer_sites` / `document_groups` (15/8/18/11 cols) | Tenant anchors every order points at | CRM/Connect surfaces, not this subsystem | Orders require all four (see above); `projects.customer_site_id → customer_sites`, `customer_orders.document_group_id → document_groups` decide deletion order (§12) |

**`payment_events`, `payment_matches`, `payment_discrepancies` do not exist in this database.** Verified 2026-11-10:

```
select to_regclass('public.payment_events'), to_regclass('public.payment_matches'),
       to_regclass('public.payment_discrepancies');
-- false | false | false
```

The live equivalents are `kbank_webhook_events` (raw), `integration_gateway_events` (normalised + match status) and `payout_audit_log` (decisions). Any doc that mentions the `payment_*` trio is describing a plan, not the schema.

**Connectors** (`public.connectors`, read-only fact): `kbank` = `webhook`, `status=connected`, `enabled=true`, signing secret present, `signature_header='x-kbank-signature'`; `line` = `token`, `status=connected`, `enabled=true`, **no** `signing_secret` (LINE ingress uses `LINE_CHANNEL_SECRET`, not the connector secret).

## 5. HTTP surface

| Route | Method | Auth | Who calls it | Writes |
|---|---|---|---|---|
| `/api/gateway/observe/line` (route.ts:31) | POST | LINE `x-line-signature` HMAC-SHA256 of the raw body; main account secret or per-destination credential (route.ts:32-59) | LINE platform | `integration_gateway_events` via `publish()` (route.ts:61-65). Fails 401/503/400/500, never writes unverified bodies |
| `/api/gateway/observe/meta`, `/github`, `/vercel`, `/railway` | POST (meta also GET) | provider-specific signature verification, no `requireAuth` | Meta / GitHub / Vercel / Railway | `integration_gateway_events` via the event bus |
| `/api/connectors/webhook/[slug]` (route.ts:30) | POST | connector must be `connected` + `enabled`, then `evaluateWebhookRequest()` (webhookGate.ts:120) → 404/413/503/401 | any external service configured through the Connectors UI | `kbank_webhook_events`-style raw record via `recordWebhookEvent` (route.ts:22) |
| `/api/connectors/webhook/kbank` (route.ts:46) | POST | same gate, connector pinned to `kbank` (route.ts:42), signature header `x-kbank-signature` | KBank | `kbank_webhook_events` (route.ts:83-92) then `integration_gateway_events` (route.ts:109-117) |
| `/api/admin/payouts/[orderId]/approve` (route.ts:17) | POST | `X-Admin-Secret` compared in constant time to `PAYOUT_APPROVAL_SECRET` (route.ts:29-32); 503 if unset | admin UI / operator curl | `customer_orders` status (route.ts:128-136), `payout_audit_log` `approve` (route.ts:156-162), then the executor's own writes |
| `/api/admin/payouts/[orderId]/reject` (route.ts:16) | POST | same secret gate (route.ts:28-31) | admin UI / operator | `PAYOUT_REJECTED` (route.ts:91-99) + audit `reject` (route.ts:119-125). No KBank call |
| `/api/admin/orders/[orderId]/dispatch` (route.ts:23) | POST | canonical admin guard `requireAuth(ADMIN_TIER)` (route.ts:24) | admin UI | `truck_jobs` + `truck_events` via `dispatchOrder` (route.ts:33) |
| `/api/cron/gateway-workers` (route.ts:52) | GET | `Authorization: Bearer $CRON_SECRET`, fail-closed (route.ts:53-57) | Vercel cron / operator | order-translator, reconciler, dispatcher, payout-approval request (route.ts:66, 78, 88, 101). **Never** executes a payout (route.ts:21-31) |

## 6. Workers and their contracts

All under `engines/integration-gateway/workers/`; every one accepts an injected `db` (service-role client) and defaults to `supabaseAdmin()`.

| File | Signature | Returns | Side effects | Fail-closed behaviour |
|---|---|---|---|---|
| `order-translator.ts` | `translateLineMessageEvents(options: OrderTranslatorOptions = {})` (:284); `confirmOrder(orderId, options = {})` (:134) | `{ translated, skipped, processed, unanchored, confirmed }` / `{ ok, orderId, status }` | inserts `customer_orders` at `DRAFT` (:399-414), flips events to `processed` (:424-428), `DRAFT → SUBMITTED` (:155-161) | Insert/lookup failure → `skipped += 1`, event left `received` for retry; confirm is idempotent and never moves an order backwards (:151-153) |
| `reconciler.ts` | `reconcileKBankPayments(options?)` (:100) | `ReconciliationResult { matched, unmatched, failed, reasons }` (:84-90) | `SUBMITTED|PAID → PAID` (:226-230), event → `processed`/`unmatched` (:242-246 / :211-215) | No match → row stays as evidence, event marked `unmatched` with a reason string; never invents an order |
| `order-dispatcher.ts` | `dispatchOrder(orderId, options = {})` (:78); `dispatchPendingOrders(options = {})` (:142) | `{ dispatched, jobId?, reason? }` / `{ scanned, dispatched, skipped, errors }` | `broadcastJob()` → `truck_jobs` at `BROADCASTED` + `truck_events` (:131) | Not `PAID` → `{ dispatched:false, reason }` not an error (:100-103); existing non-`DELIVERED` job → no-op (:107-127); pool scan never throws (:142-181) |
| `payout-worker.ts` | `requestPayoutApproval(orderId, options = {})` (:92); `executeApprovedPayout(orderId, approverId, options = {})` (:170); `processOrderPayout` legacy (:350); `reconcilePayouts(options = {})` (:466) | `boolean` / `{ success, failed }` / `RunResult { orders, succeeded, failed }` (:453-460) | Approval request: status + `request` audit. Executor: `buildPayoutPayload` + `sendPayout`, then `SETTLED` + `execute` audit | Executor refuses when not `PAYOUT_APPROVED` (`{0,0}`, :193-198) and when the amount resolves ≤ 0 or non-finite: `PAYOUT_FAILED` + audit `reject` + `{ success:0, failed:1 }` (:209-241). KBank throw → `PAYOUT_FAILED` + audit (:275-306). Amount comes from `options.amount` else `resolveInvoiceAmount()` (:45-74) — **no placeholder** |
| `truck-tracker.ts` | `broadcastJob(orderId, options?)` (:158); `acceptJob(jobId, truckId, driverId, options?)` (:198); `updateJobStatus(jobId, newStatus, actorId, metadata?, options?)` (:253) | `TruckJobRow` | one `truck_jobs` update + one `truck_events` insert per transition | Illegal/skipped transition rejected by `NEXT_STATUS` (:42-50); chain starts at `BROADCASTED` |
| `cancellation-worker.ts` | `cancelOrderWithRefund(...)` (:62) | `RefundResult` | KBank refund (`sendRefund`, :116), `PAID → CANCELLED_REFUNDED|CANCELLED_PARTIAL_REFUND` (:124-131), `cancellation_evidence` insert (:140-146) | Only a `PAID` order can be refunded (guarded update, :124-131); `SELLER_FAULT` requires proof; deliberately **not** callable from cron (cron route:21-24) |

## 7. Environment variables

Names only — no values are recorded here.

| Variable | Purpose | Must be set in | Current state (2026-11-10) |
|---|---|---|---|
| `PAYOUT_APPROVAL_SECRET` | Constant-time gate for `/api/admin/payouts/[orderId]/{approve,reject}` | `.env.local`, Vercel (Production) | SET locally: 64 hex chars, generated for the E2E work (test secret, not shared with any operator) |
| `CRON_SECRET` | `Bearer` gate for `/api/cron/*` | `.env.local`, Vercel (+ Vercel Cron header) | SET locally: 64 hex chars (test secret) |
| `LINE_CHANNEL_SECRET` | LINE webhook signature verification (main account) | `.env.local`, Vercel, and Supabase function env for `line-webhook-v2` | SET locally: 64 chars. **Not validated against a real LINE channel** (no live LINE traffic has been signature-verified in this work) |
| `LINE_TOKEN_INTERNAL_SECRET` | Internal gate for `/api/internal/line/token` | `.env.local`, Vercel | SET locally: 64 chars |
| `LINE_COMMAND_INTERNAL_SECRET` | Internal gate for `/api/internal/line/command` | `.env.local`, Vercel | **ABSENT** locally |
| `PAYMENT_CONFIRM_INTERNAL_SECRET` | Internal gate for `/api/internal/connect/payment-confirm` | `.env.local`, Vercel | **ABSENT** locally |
| `DRIVER_TRACKING_SECRET` | Driver auth for `/api/driver/*` (`app/api/driver/_lib/driver-auth.ts`) | `.env.local`, Vercel | SET locally: 64 chars (test secret) |
| `KBANK_KGP_BASE_URL` | KBank KGP API base URL | `.env.local`, Vercel | SET locally, but the OAuth exchange is rejected by KBank (see §9) |
| `KBANK_KGP_CONSUMER_ID` / `_CONSUMER_SECRET` / `_ENV_ID` | KBank OAuth2 basic-auth credential + environment id (`services/kbank/kapi-oauth.ts:24-40,62-70`) | `.env.local`, Vercel | **LOCAL PLACEHOLDER** — KBank answers `400 {"code":"openapi_error","message":"OAuth2.0 Token Generate Error"}` on every token request |

Placeholder secrets created for tests, explicitly: `PAYOUT_APPROVAL_SECRET`, `CRON_SECRET`, `DRIVER_TRACKING_SECRET`, `LINE_TOKEN_INTERNAL_SECRET` (all locally generated 64-hex), and the whole `KBANK_KGP_*` set (never accepted by KBank). None of these exist in Vercel yet as far as this repo can tell — treat every production value as still to be provisioned.

## 8. What is proven (with evidence)

**E2E against the production DB, 2026-11-09/10** (project `xeytcavxejhyzxwevgto`):

- LINE ingress → `integration_gateway_events` rows `EVT-line-01JE2E0000000000000000001`, `…002`, `…003`, `…0C01` (received 2026-11-09 17:48–18:02Z), then `customer_orders` `T1-message-mw9k2ish` (`e683fdfa-8352-41e7-bce0-52c42096e5c9`) and `T1-message-mw9kfcgj` (`46edd11f-3d57-4b54-85b0-7e1b58d18c83`).
- KBank ingress → `kbank_webhook_events` rows `sha256:fc8d2210…`, `sha256:30fefb06…`, `sha256:c1895354…` (status `received`) and matching `EVT-kbank-txn_e2e_*` gateway events.
- Reconciliation/cancel/payout transitions were driven per order; `payout_audit_log` accumulated 9 rows (`request` ×2, `approve` ×2, `reject` ×3, `execute` ×0) before cleanup.
- **Amount wiring proof (commit `592ebda3`)**: an invoice `SIM-E2E-INV-1` (`00000000-0000-4000-8000-00000000e2e9`, `total_amount = 1234.56`, `invoice_status = SENT`) was attached to `mw9kfcgj`; approving produced dev-log line `[executeApprovedPayout] amount=1234.56 source=options order=T1-message-mw9kfcgj` (verified present in `/tmp/dev_e2e3.log`, 1 match) and audit reason `payout approved by human via admin approval route; amount resolved from invoices: 1234.56 (1 invoice, active)`. The payload handed to `sendPayout` therefore carried `1234.56` (net 1229.56 after the 5.00 shop fee), not the old hardcoded `"100.00"`.
- KBank then rejected the call at the **OAuth** step, which is the expected outcome with placeholder credentials: `Error: KBank OAuth failed: 400 {"code":"openapi_error","message":"OAuth2.0 Token Generate Error"}` → worker wrote `PAYOUT_FAILED` + audit `reject` and returned 409 from the route.
- The fail-closed guard was proven in the same run: `mw9k2ish` had no invoice, so `executeApprovedPayout` resolved 0, refused to call KBank, marked `PAYOUT_FAILED`, and wrote the audit reason `no payable invoice amount for this order; refusing to send a placeholder amount to KBank`.
- `"100.00"` no longer exists in `engines/integration-gateway/workers/payout-worker.ts` (`grep -c '"100.00"'` → 0); the amount path is `options.amount ?? resolveInvoiceAmount()` (payout-worker.ts:203-207).
- Tests: `npx vitest run tests/e2e/` → **3 files, 26 tests, 26 passed** (verified again on 2026-11-10 at HEAD `592ebda3`). The two payout tests now carry an `invoices` fixture (tests/e2e/kbank-payment-flow.test.ts:539, :610) so the fakes match production data; no assertion was changed.
- Snapshots: `/tmp/pre_amount_wire.json`, `/tmp/post_amount_wire.json`, `/tmp/pre_final_wire.json`, `/tmp/post_final_wire.json`, `/tmp/pre_cleanup.json`, `/tmp/post_cleanup.json`, backup `/tmp/e2e_cleanup_backup.json`.

**Important**: the E2E rows listed above were **deleted on 2026-11-10** as test data (see §12), because they lived in the production database. The evidence is the snapshots/backup files and the commits, not rows you can `select` today.

## 9. What is NOT proven / blocked

1. **Real KBank sandbox token exchange** — never succeeded; every call dies at OAuth with the placeholder credential. No payout has ever been accepted by KBank.
2. **Real LINE channel secret / real LINE traffic** — `LINE_CHANNEL_SECRET` is a locally generated test value; no production LINE channel has been verified end to end.
3. **`SETTLED` has never occurred** — the code path exists (payout-worker.ts:310-317) and is covered by a mocked test, but no real order has reached it.
4. **Admin payout UI still uses `X-Admin-Secret`** — `app/admin/payouts/page.tsx` + `PayoutApprovalList.tsx` post to the approval routes with the shared secret; there is no session+role check on those two routes, only `requireAuth(ADMIN_TIER)` on the dispatch route. `/api/admin/payouts` is additionally in `LOCAL_UI_REVIEW_PREFIXES` (core/auth/devReviewAccess.ts:31-36) for dev+loopback review access.
5. **No retry path for `PAYOUT_FAILED`** — nothing in the codebase moves an order out of `PAYOUT_FAILED`; recovery today is a manual, guarded SQL update (what §11 does) or a fresh approval after a manual status reset.
6. **Migration history drift** — local `supabase/migrations/` has **152** files, the remote project has **131** applied, and **21** local migrations are not applied remotely (`20260804000009, 20260804000010, 20260810000001, 20260924000001, 20260925000001, 20260926000001, 20260927000001, 20261007000001, 20261007000002, 20261010000001, 20261013000001, 20261025000001, 20261025000002, 20261026000003, 20261109113000, 20261109130000, 20261109142156, 20261109170000, 20261109180000, 20261109181000, 20261109190000`). There are **0** remote-only entries. `db push` is therefore unsafe until that list is reconciled by hand.
7. **Cancellation → refund path** is coded (`cancellation-worker.ts`) but was never exercised against KBank; it shares the same broken OAuth credential.

## 10. Next tasks, in priority order

1. **Real KBank credential + first sandbox payout.** Goal: obtain a token and get one `sendPayout` accepted, moving an order to `SETTLED`. Files: `.env.local`/Vercel env only (no code change expected); `services/kbank/kapi-oauth.ts` if the token body needs a fix. Acceptance: `POST /api/admin/payouts/<id>/approve` → `{ ok:true, status:"approved" }` and the order reads `SETTLED` with audit `execute`. Blockers: KBank application approval (application no. 1792988917, status "waiting for officer").
2. **Retry/recovery path for `PAYOUT_FAILED`.** Goal: an audited way to re-queue a failed payout without hand-written SQL. Files: `engines/integration-gateway/workers/payout-worker.ts` (a `retryFailedPayout` honouring `PAYOUT_FAILED → PAYOUT_PENDING_APPROVAL`), `app/api/admin/payouts/[orderId]/retry/route.ts` (new). Acceptance: a failed order returns to pending, audit explains who retried; e2e test in `tests/e2e/`. Blockers: none technical.
3. **Replace `X-Admin-Secret` with session + role.** Goal: `requireAuth(ADMIN_TIER)` on approve/reject and remove `/api/admin/payouts` from `LOCAL_UI_REVIEW_PREFIXES`. Files: both payout routes, `core/auth/devReviewAccess.ts`, `app/admin/payouts/*`. Acceptance: an unauthenticated request gets 401 from the guard, an admin session succeeds; the dev bypass list no longer contains the payout prefix. Blockers: needs a real admin identity in the environment.
4. **Real LINE channel wiring.** Goal: one production LINE message → `DRAFT` order with a verified signature. Files: env only (`LINE_CHANNEL_SECRET`, `LINE_TOKEN_INTERNAL_SECRET`), plus `supabase/functions/line-webhook-v2` deployment. Acceptance: `integration_gateway_events` gets an `EVT-line-…` row with a signature that verified, and phase 1 of cron creates the order. Blockers: LINE channel credentials.
5. **Repair migration drift (21 pending).** Goal: `supabase migration list` shows local == remote. Files: `supabase/migrations/*` (TODO/unverified: an earlier triage suggested ~10 of the 21 create objects that are absent and ~11 that cannot be verified — inspect each of the 21 before acting, that split was not re-checked for this handoff). Acceptance: local count == remote count, `db push` is a no-op. Blockers: judgement per migration; do this outside a money-changing window.

## 11. How to re-run the E2E (concrete commands)

```bash
cd /Users/tam/dna-runtime/app

# 1. dev server (background) — the routes + workers run in-process
npm run dev > /tmp/dev_money.log 2>&1 &
curl -s -o /dev/null -w 'root=%{http_code}\n' http://127.0.0.1:3000/

# 2. fire a LINE message (unsigned path is the local/dev ingress used in tests;
#    with a real channel, send from LINE instead and use the signed route)
curl -s -X POST http://127.0.0.1:3000/api/gateway/observe/line \
  -H 'content-type: application/json' \
  -d '{"destination":"sim","events":[{"type":"message","message":{"type":"text","text":"สั่งทราย 10 คิว"},"webhookEventId":"E2E-1","timestamp":1,"source":{"userId":"Usim_e2e_001"}}]}'
# (signature-verified ingress requires: -H "x-line-signature: <base64 hmac of body>")

# 3. run the pipeline (translate → reconcile → dispatch → request approval)
SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)
curl -s http://127.0.0.1:3000/api/cron/gateway-workers -H "Authorization: Bearer $SECRET" | python3 -m json.tool

# 4. fire a KBank payment webhook (must come from the connector's configured
#    signature header: x-kbank-signature over the raw body)
curl -s -X POST http://127.0.0.1:3000/api/connectors/webhook/kbank \
  -H 'content-type: application/json' -H "x-kbank-signature: <hmac>" \
  -d '{"id":"txn_e2e_1","amount":"1234.56","reference_id":"T1-message-xxxx","status":"PAID"}'

# 5. run the pipeline again → order becomes PAID, truck job BROADCASTED,
#    then PAYOUT_PENDING_APPROVAL
curl -s http://127.0.0.1:3000/api/cron/gateway-workers -H "Authorization: Bearer $SECRET" | python3 -m json.tool

# 6. approve the payout (amount comes from invoices.total_amount)
PAYOUT_SECRET=$(grep '^PAYOUT_APPROVAL_SECRET=' .env.local | cut -d= -f2-)
ORDER=46edd11f-3d57-4b54-85b0-7e1b58d18c83
curl -s -X POST "http://127.0.0.1:3000/api/admin/payouts/$ORDER/approve" \
  -H "X-Admin-Secret: $PAYOUT_SECRET" -H 'content-type: application/json' \
  -d '{"actorId":"e2e-admin-001"}' -w '\nHTTP %{http_code}\n'

# 7. inspect the audit trail + the resolved amount in the dev log
npx --yes supabase db query --linked --project-ref xeytcavxejhyzxwevgto \
  "select action, actor_id, reason, created_at from payout_audit_log where order_id='$ORDER' order by created_at desc limit 5"
grep -n "executeApprovedPayout\] amount=" /tmp/dev_money.log | tail -3

# 8. clean up E2E rows afterwards — see §12
```

Notes: the approve/reject routes need `PAYOUT_APPROVAL_SECRET` set, otherwise they answer 503 by design (approve route:21-27). `sendPayout` will still fail at OAuth until real credentials exist — that failure is the *expected* end state today.

## 12. How to clean up before go-live

Markers (never widen these):

- orders: `customer_orders.order_no like 'T1-message-%'` **and** `id in ('e683fdfa-8352-41e7-bce0-52c42096e5c9','46edd11f-3d57-4b54-85b0-7e1b58d18c83')`
- invoices: `customer_company_id = '00000000-0000-4000-8000-00000000e2e1'` and `invoice_no like 'SIM-E2E-%'` (→ `00000000-0000-4000-8000-00000000e2e9`)
- events: `integration_gateway_events.event_id like 'EVT-line-01JE2E%'` or `'EVT-kbank-txn_e2e_%'`; `kbank_webhook_events` where `status='received'` and `event_id like 'sha256:%'` inside the run window (48 h)
- identity: `connect_external_identities` (`provider='line'`, `external_subject_id='Usim_e2e_001'`) and its projections
- anchors: `companies '…e2e1'`, `projects '…e2e2'`, `customer_sites '…e2e3'`, `document_groups '…e2e4'`

Deletion order that actually works (FK-verified on 2026-11-10; the naive order fails):

```
1  invoice_items            (invoice_id in E2E invoices)
2  invoices
3  standalone_documents     (customer_order_id in E2E orders)
4  business_events          (transaction_id in E2E orders)
5  payout_audit_log         (order_id in E2E orders)
6  truck_events             (job_id in E2E truck_jobs)
7  truck_jobs               (order_id in E2E orders)
8  kbank_webhook_events     (sha256:% / received / last 48h)
9  integration_gateway_events (EVT-line-01JE2E% / EVT-kbank-txn_e2e_%)
10 connect_external_identities  <-- BEFORE its projections (trigger removes them)
11 company_line_links        (re-run after 10; expect 0 — trigger already removed it)
12 line_profiles             (re-run after 10; expect 0)
13 customer_orders           <-- BEFORE document_groups (FK customer_orders_document_group_id)
14 document_groups
15 projects                  <-- BEFORE customer_sites (FK projects_customer_site_id)
16 customer_sites
17 companies
```

Also: **do not delete `audit_logs`** rows (no FK, kept as orphan history by owner decision — 9042 rows at cleanup time). Back up each table to JSON before deleting (the 2026-11-10 run used `{ table: rows }` at `/tmp/e2e_cleanup_backup.json`, 33 rows).

## 13. Known landmines

- **`company_line_links` and `line_profiles` are read-only projections.** `company_line_links` carries `connect_identity_legacy_guard` (`BEFORE INSERT OR DELETE OR UPDATE`) which raises `42501`: _"public.company_line_links is a read-only projection of the canonical Connect identity model"_. Delete the `connect_external_identities` row instead; the `connect_project_identity_to_legacy` trigger removes both projections (verified 2026-11-10).
- **`audit_logs` contains orphan rows** referencing now-deleted E2E orders (no FK by design). Do not "fix" this by deleting audit rows.
- **The KBank webhook route reuses a module-level `NOT_FOUND` Response** (`app/api/connectors/webhook/kbank/route.ts:44`, same pattern at `app/api/connectors/webhook/[slug]/route.ts:28`). A `Response` body is a one-shot stream, so after the first 404 the body is empty for every later request in the same server instance. Status/headers stay correct; the JSON body silently disappears. Construct the response inside the handler before relying on the body.
- **KBank `event_id` carries a cosmetic `-idx-[object Object]` suffix.** `adapters/kbank.ts:121-122,169` builds `EVT-kbank-<id>-idx-<String(raw)>`; `String(raw)` stringifies the whole payload object. It is still unique per transaction, so matching works, but the ids look wrong in logs and in `like` filters. Fixing it changes `event_id` values — treat as a data-migration, not a cosmetic patch.
- **The worker's `"100.00"` placeholder is gone on purpose.** `executeApprovedPayout` resolves the amount from `invoices.total_amount` (`PAYABLE_INVOICE_STATUSES` at payout-worker.ts:38, resolver at :45-74) and fails closed on ≤ 0 (:209-241). Any new worker that needs an amount must do the same; never hardcode, never default to a number.
- **Stale comment in the approve route**: route.ts:89-92 still says the worker "takes no amount argument", which was true before commit `592ebda3`. The call at route.ts:167-169 passes `{ amount: resolvedAmount }`. Trust the code, not that comment.
- **`reconcilePayouts` counts optimistically**: `succeeded += 1` regardless of whether `requestPayoutApproval` returned true (payout-worker.ts:490-498), and it labels skipped orders `"settled"` (:492-495). The cron route works around it by counting `status === "settled"` (cron route:99-102). Do not read `RunResult.succeeded` as "approvals requested".
- **Cron must never execute a payout.** `app/api/cron/gateway-workers/route.ts:21-31` documents that `executeApprovedPayout()` and `cancelOrderWithRefund()` are intentionally absent. Automating either deletes the human-approval invariant that makes this subsystem "Tool, not Judge".
