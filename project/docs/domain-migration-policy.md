# Domain Migration Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Govern any change to the primary production domain or its DNS/Vercel binding so it never causes downtime, a broken LIFF login, or a stranded registration — grounded in the domain tooling that already exists in this repo, not a hypothetical future system.

## Architecture Principle

A domain/DNS mutation follows the same shape this codebase already requires for irreversible, real-money actions: preview → confirmed token → execute (Rule 72, already implemented in `app/api/admin/domains/register/route.ts` — "Real money, irreversible"). No domain or DNS change happens as a single, unconfirmed call. DNS record changes additionally route through the existing Connector Lifecycle Law (`registry/connector-lifecycle.json`: Connect → Register → Test → Enable → Run) via `engines/domains/cloudflare.ts`, which already refuses to act if the `cloudflare` connector isn't Tested and Enabled. Vercel project-domain binding (`engines/domains/vercel-binding.ts`) is treated as core infrastructure (reads `VERCEL_TOKEN` directly, same pattern as `LINE_CHANNEL_ACCESS_TOKEN`), not a pluggable connector — but a Level 4 (owner-approval) action per [`production-governance.md`](./production-governance.md)'s ladder, since it can take the whole production app offline.

## Requirements

- Any DNS zone/record change goes through `engines/domains/cloudflare.ts` and therefore through the Connector Lifecycle Law — no direct API calls that bypass it.
- Any Vercel domain-binding change (`POST /v10/projects/{id}/domains`, verify, or delete) requires explicit owner approval before execution — this is not a routine deploy action.
- A migration runbook is recorded before execution: old domain, new domain, DNS TTL lowered in advance, planned cutover window, and the explicit condition that triggers a rollback.
- Every external system holding this app's domain is re-pointed in the same change window as the cutover, not as a follow-up: the LIFF endpoint URL (`app/liff/add-friend` lives on this app's domain, so it moves with any domain change) and any partner-shared bookmark class of link.
- The LINE Messaging API webhook is **not** affected by a domain migration of this app — it points at a Supabase Edge Function (`supabase/functions/line-webhook-v2`), which has its own, separate domain. This is worth stating explicitly so a migration runbook doesn't waste a step "fixing" something that was never broken by the change.

## Validation Checklist

- [ ] DNS TTL lowered well ahead of the planned cutover
- [ ] New domain passes Vercel domain verification (`/v9/projects/{id}/domains/{domain}/verify`) *before* the old binding is removed
- [ ] Old domain is kept alive as a redirect/alias for a defined window, not deleted at cutover (per [`redirect-policy.md`](./redirect-policy.md))
- [ ] LIFF endpoint URL in the LINE Developers console updated to match the new domain
- [ ] `dnaos.co.th` registration itself is current — per `registry/infrastructure.json`, renewal is **manual**, expires 2026-09-08, no auto-renew on record. A migration plan should not assume the domain renews itself.

## Failure Conditions

- DNS propagation is incomplete at the cutover window (site unreachable by name for some fraction of users)
- Vercel domain verification fails after the old binding is already removed (self-inflicted outage)
- LIFF login breaks because the LINE console still references the old domain
- The domain itself lapses due to manual-renewal being missed — a real, already-known risk independent of any migration, surfaced here because a migration plan built on an expiring domain is unsound

## Recovery Procedure

1. Re-point DNS back to the previous, still-registered target immediately (this is why Requirements calls for keeping the old domain alive during the transition window, not deleting it at cutover).
2. Re-verify the Vercel binding on whichever domain is currently authoritative.
3. Manually confirm LIFF reachability (open the LIFF URL, confirm it loads) before declaring the incident closed.
4. Record the incident and its cause in `registry/CHANGELOG.json`, per this project's existing AI Execution Protocol ledger.
