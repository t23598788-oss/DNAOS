# URL Lifecycle Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Ensure every public URL this system exposes has a known state, a known owner, and a known set of guarantees at all times — so a URL never silently changes meaning, breaks, or disappears without a governed transition.

## Architecture Principle

A URL is an external contract, not an implementation detail. [`route-lifecycle.md`](./route-lifecycle.md) governs the *route* (the page/handler on disk and its registry entry); this policy governs the *URL* as observed by a caller — which can be broader than one route (a redirect chain), can predate the route behind it, or can be held by an external system (LINE webhook config, LIFF endpoint URL, a partner's saved bookmark) that this repo doesn't control and can't silently assume is stale.

## Requirements

- Every **Published** URL (per `route-lifecycle.md`'s definition) has a named owner inside this repo — the registry entry, nav group, or code path responsible for it.
- Every external system that stores a URL from this app is enumerated, not assumed: today that's the LINE Messaging API webhook config (points at a Supabase Edge Function domain, `supabase/functions/line-webhook-v2`, not this app's domain) and the LIFF endpoint URL (`app/liff/add-friend`, which *does* live on this app's domain).
- A URL's state transition (Published → Deprecated → Redirected → Removed) is recorded at the time it happens, not reconstructed after the fact.
- No URL changes its response contract (shape, auth requirement) while remaining in the Published state — a contract change is a new URL (see [`versioning-policy.md`](./versioning-policy.md)) or goes through [`route-stability-policy.md`](./route-stability-policy.md).

## Validation Checklist

- [ ] Every `href` in `registry/portals.json` resolves to a real, live route
- [ ] The LIFF endpoint URL registered in the LINE Developers console matches the live `/liff/add-friend` path on the current domain
- [ ] No Published URL's response shape changed without a corresponding version bump or an explicit, recorded exception
- [ ] No Published URL's `requireAuth` tier changed silently (cross-check against [`route-stability-policy.md`](./route-stability-policy.md))
- [ ] Every URL currently in the Deprecated state has an active redirect (cross-check against [`redirect-policy.md`](./redirect-policy.md))

## Failure Conditions

- A URL that previously returned 200 now returns 404 or 500 with no redirect in place
- A URL's JSON response gains or loses fields in a way an existing consumer depends on, without a version change
- A URL silently redirects to content unrelated to the caller's original intent
- An external system (LINE console, a partner's saved link) references a URL this repo has already moved or removed

## Recovery Procedure

1. Restore the previous route or add the correct redirect immediately (see [`redirect-policy.md`](./redirect-policy.md) and [`rollback-policy.md`](./rollback-policy.md)).
2. If immediate restoration isn't possible, redirect to the nearest valid replacement and treat the gap as a [`route-stability-policy.md`](./route-stability-policy.md) incident.
3. If an external system's stored URL is now wrong (e.g. LIFF endpoint after a domain change), update that system's configuration in the same change window — not as a follow-up task.
