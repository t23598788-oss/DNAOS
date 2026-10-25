# Factory Reality Validation — STEP 1: Capability Inventory

**Date:** 2026-08-10. **Method:** 3 parallel, read-only investigations across 17 domains — real source code, real registries, real DB schema/migrations, and (for LINE/AI/Notifications/Connectors) real, read-only live checks against production Supabase (`secrets list`, SELECT-only queries), Vercel (`env ls`), and RunPod. No writes, no sends, no paid calls, no production data changed. State taxonomy: `NOT_BUILT / BUILT_NOT_WIRED / WIRED_NOT_TESTED / TESTED / DEPLOYED / LIVE_VERIFIED / BROKEN`.

This document is the real evidence backing the FCR entries in `registry/FACTORY_CENTRAL_REGISTRY.json`. Full per-capability tables (100+ line items) live in this phase's own working notes; this file condenses to what matters for STEP 2 (test-scenario) planning.

## Headline findings (business-critical, cross-cutting)

1. **Live customer quotes carry zero markup/profit margin.** The "proper" pricing engine (`engines/pricing.ts#calcPricing`, applies markup/system-fee/urgent-fee/VAT) has **zero real callers** anywhere in the codebase — it's dead code. The real, live quote path (`engines/validation/dispatcher.ts`, reachable via the public `/api/v1/query` endpoint and the LINE bot) computes `total_price = unit_price × quantity + transport_cost` only. Material/fuel cost math is real and DB-sourced (no hardcoding there), but no margin is added on top anywhere in the live path.
2. **Real production (Vercel) is missing most non-core secrets.** Only 7 env vars exist on Vercel Production. `ANTHROPIC_API_KEY`, `CRON_SECRET`, `LINE_COMMAND_INTERNAL_SECRET`, `OPENCLAW_INTERNAL_SECRET`, `SUPABASE_MANAGEMENT_API_TOKEN`, `GMAIL_*`, `GITHUB_WEBHOOK_SECRET` are all correctly set in `.env.local`/Supabase Edge secrets but absent from the actual deployed app — every Next.js-side route gated on one of these fails closed in real production today, including both scheduled Vercel Cron jobs.
3. **The local AI pipeline has been stalled for 5-6 days.** 29 real customer-facing `ai_tasks` stuck `pending` since 2026-08-05; the local watcher process isn't running; RunPod has 0 active pods; a real bug (repeated 409s trying to stop an already-stopped pod) is in the watcher's own log.
4. **Customer-facing LINE replies are system-wide suppressed by design** (a "Customer Auto-Reply Kill Switch," live since 2026-07-31) — real, intentional, but means a real new customer message today gets no bot reply/welcome message/loading indicator, while the automated daily debt-reminder push (a separate code path) does still reach real customers.
5. **A sent invoice can be silently edited** — the PATCH endpoint never checks `invoice_status` before applying changes, contradicting Constitution Rule 113 (Document Immutability), which itself cites a real prior incident (`INV-20260717-352`/`INV-20260718-649`).
6. **A real production webhook (Kubota KIS machinery telemetry) has zero authentication and writes to a database table that doesn't exist** — any invocation would fail, and nothing currently guards the endpoint.
7. **One real, pre-existing TypeScript compile error**: `issueReceiptForDebtEvent` is imported but never exported — the manual receipt-from-debt-event route cannot compile/run.

## What IS real and working end-to-end today (LIVE_VERIFIED, with real evidence)

- LINE webhook receipt + signature verification — 803 real events, latest today.
- Image → Claude Vision classification — 495 real classified `receipt_documents` (currently stale, last row 2026-08-04, possibly just low photo volume, not confirmed broken).
- Payment Verification Levels 1/2/3 (Rule 115) — real, live, including a real Level-3 bank-email auto-match.
- Automated daily debt-reminder LINE push — ran for real this morning (2026-08-10, 09:00 Bangkok).
- Bank email sync (Gmail, read-only) — 830 real rows, latest yesterday.
- Material/fuel cost calculation — real, DB-sourced, no hardcoded fallback found in the live path.
- Pit-material pricing data — real (with a documented real recovery incident after an accidental table drop).

## Real Gaps logged to `registry/FACTORY_CENTRAL_REGISTRY.json`

See FCR-013 through FCR-020 for the individually-tracked, most business-critical items — full detail there, cross-referenced to this file.

## Implication for STEP 2 (test scenario design)

A literal "happy path" scenario (LINE → AI understands → quote → job → delivery → invoice → VAT → payment → ledger → notification) cannot run against the CURRENT live-production state end-to-end without hitting at least 3 of the headline gaps above (no bot reply today, no markup applied to the quote, Vercel-side AI/cron routes dead). STEP 2's scenarios will be designed against the real Workflow/Formula/Document Engine/Event Engine (per STEP 3's own requirement — same engines as production), run through a safe/sandboxed environment, and will explicitly test for the headline gaps above as expected failure points where relevant — not silently routed around them.
