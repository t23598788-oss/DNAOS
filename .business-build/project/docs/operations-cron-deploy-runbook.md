# Operations Loop — Cron Deploy Runbook

**Owner action required.** This is the real, exact procedure to prove the
Continuous Operations Loop's real Vercel Cron Scheduler Adapter actually
fires in production — closing the one gap Step 12.5's
`getSchedulerContractStatus()` honestly reports as `COMPATIBILITY_ONLY`.

Nothing in this repo can execute these steps autonomously: they require
your real Vercel account/CLI session. This document exists so you (the
owner) can run them yourself, and so the result can be verified
afterward from real evidence.

## What already exists (real, code-complete, unverified-live)

- `vercel.json` — real cron entry: `/api/cron/operations-loop`, schedule
  `*/10 * * * *` (every 10 minutes).
- `app/api/cron/operations-loop/route.ts` — real, `CRON_SECRET`-gated
  endpoint. Mirrors the exact same pattern the already-deployed
  `/api/cron/supabase-project-status` route uses in production today.
- `runOperationsLoop(ownerId, actor, "CRON")` — the real function the
  route calls. Runs under a fixed sentinel owner id `"system-cron"`
  (see the route's own header comment for why — this is a disclosed,
  real limitation, not hidden).

## Step 1 — Set the real secret

If `CRON_SECRET` is not already set in your Vercel project (it should
already exist, since `/api/cron/supabase-project-status` depends on the
same variable):

```bash
vercel env add CRON_SECRET production
```

Vercel will prompt for the value — use a real, random secret (e.g.
`openssl rand -hex 32`). Record it somewhere safe; you'll need it for
Step 3's manual verification.

## Step 2 — Deploy

```bash
vercel deploy --prod
```

This is a real, production deploy. Review the diff Vercel shows before
confirming — this Step's own scope explicitly forbids *this agent* from
running this command; it is yours to run.

## Step 3 — Verify the cron fires for real

Two independent, real checks — do both:

### 3a. Manual proof (immediate)

```bash
curl -s -H "Authorization: Bearer <your real CRON_SECRET>" \
  https://<your real production domain>/api/cron/operations-loop
```

A real response looks like:

```json
{ "ok": true, "runId": "<real uuid>", "status": "SUCCEEDED", "signalsCollected": 18, "incidentsOpened": <n>, "alertsDispatched": <n> }
```

This proves the route works when called correctly — it does **not** yet
prove Vercel's own scheduler calls it automatically.

### 3b. Real scheduled proof (wait ~10–20 minutes)

1. Open the Vercel dashboard → your project → **Cron Jobs** tab. Vercel
   shows real, per-invocation logs there once the schedule has fired at
   least once.
2. Confirm at least one real, automatic invocation appears (not
   triggered by your `curl` above — Vercel's dashboard distinguishes
   cron-triggered invocations from manual/browser hits).
3. Cross-check inside DNA OS: open the **Operations** tab →
   **Readiness** section, or call:
   ```bash
   curl -s -H "Cookie: <your real admin session cookie>" \
     https://<your real production domain>/api/admin/ide/operations/loop/runs
   ```
   Look for a real `OperationsLoopRun` with `"trigger": "CRON"` — that
   is the one, unambiguous, real signal that the schedule fired, not
   just the manual endpoint.

## Step 4 — Report back

Once you have real evidence of a `"trigger": "CRON"` run in the loop
history, that is the missing proof. The next session can then update
`getSchedulerContractStatus()`'s `adapter` field from
`"COMPATIBILITY_ONLY"` to `"IMPLEMENTED"` — but **only** after you
confirm you've actually seen a real `CRON`-triggered run, never before.

## What this does NOT do

- Does not touch Production data, restore anything, or mutate any
  provider configuration beyond the cron schedule itself.
- Does not send a real LINE/webhook alert (those remain deferred per
  your Step 12.75 decision — `LINE_CHANNEL_ACCESS_TOKEN` /
  `ALERT_WEBHOOK_URL` are still unset).
- Does not run a new backup (still requires real Supabase credentials
  not present in the agent's sandbox).
