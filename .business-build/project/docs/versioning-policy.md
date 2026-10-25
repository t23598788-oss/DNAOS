# Versioning Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Define when and how a route or API gets a version marker, so breaking changes have a governed home that doesn't collide with a contract other code already depends on.

## Architecture Principle

Version the contract, not the whole app. This repo already has two real, independent versioning precedents in production, neither one formally documented until now:

- `app/api/v1/{capabilities,query,drivers,workflows}` — path-prefixed versioning for what appears to be the app's externally-oriented API surface.
- `supabase/functions/line-webhook-v2` — suffix-versioned Edge Function naming for the LINE webhook handler (implying a `line-webhook` v1 existed and was superseded).
- By contrast, `app/api/admin/*` (the large majority of routes — 22+ subdirectories) carries no version marker at all, and deploys atomically with its only real caller: this app's own frontend.

This policy formalizes the distinction implicit in that existing split, rather than inventing a new scheme: **versioned** routes are for consumers that can't be assumed to upgrade in lockstep with this repo; **unversioned internal routes** are for consumers that are this repo (deployed together, so there's no compatibility window to protect).

## Requirements

- A new route gets a `/v1/` (or equivalent) marker only if it has, or is explicitly planned to have, a consumer outside this repo's own atomic deploy — e.g. a future partner-facing API.
- Purely internal `/api/admin/*`-style routes stay unversioned by design, not by oversight — adding a version prefix to them would be unnecessary complexity against this project's own stated norm against premature abstraction.
- A breaking change to an existing versioned route (`/api/v1/*`) requires a new version path (`/api/v2/*`), never an in-place mutation of the existing one.
- The old version stays live per [`backward-compatibility-rules.md`](./backward-compatibility-rules.md) until confirmed to have zero remaining external callers.

## Validation Checklist

- [ ] New route under `/api/v1/*` (or a new version) only added when a real or explicitly-planned external consumer exists
- [ ] No internal-only `/api/admin/*` route gains a version prefix without a stated reason
- [ ] Any breaking change to `/api/v1/*` lands as `/api/v2/*`, with the old version still serving
- [ ] Deprecation of an old version follows [`route-lifecycle.md`](./route-lifecycle.md)'s Deprecated → Redirected/Removed states, not an abrupt cutoff

## Failure Conditions

- A breaking change is made in-place to an existing `/api/v1/*` route, silently breaking whatever external consumer depends on it
- A version prefix is added to a purely internal route for no functional reason, adding maintenance overhead without a compatibility benefit
- An old API version is removed while still in active use by an external caller (violates [`backward-compatibility-rules.md`](./backward-compatibility-rules.md))

## Recovery Procedure

1. If an in-place breaking change already landed on a versioned route: revert it, then reintroduce it as the next version instead.
2. Confirm via logs/monitoring (where available) whether the old version has real remaining traffic before removing it.
3. Record the version transition in `registry/CHANGELOG.json`, consistent with how other architectural changes in this repo are already tracked.
