# Redirect Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Define the mechanics of a redirect precisely enough that a route move never produces a broken link during — or after — the transition.

## Architecture Principle

Prefer platform-level redirects (Next.js `redirects()` in `next.config.ts`, or Vercel edge config) over ad-hoc client-side `router.push()`. A server-level redirect is cacheable, crawlable, works even if the old page's JS bundle is gone, and is declared in one central place instead of scattered through component logic.

## Requirements

- Permanent moves use HTTP 308 (permanent redirect, preserves request method), not 302, once the move is confirmed final.
- Redirect entries live in one place — proposed: `next.config.ts`'s `redirects()` array, which today has **zero entries** (confirmed: the file only sets `turbopack.root`). This would be the first use of it.
- A redirect is added **in the same change** that moves or removes the old route — never as a follow-up. This is the exact gap that produced the current `/admin/line-customers` incident: the page moved to `/admin/relationships` (`registry/CHANGELOG.json`, `DNA-000021`), but no redirect was added and `portals.json` still points at the old path.
- A redirect target is verified to itself resolve (no double-hop to another dead end) before being committed.

## Validation Checklist

- [ ] Every route in [`route-lifecycle.md`](./route-lifecycle.md)'s Deprecated state has a matching `next.config.ts` redirect entry
- [ ] Redirect source path returns 308 with the correct new-path target, not 200 (still serving old content) or 404
- [ ] Redirect target itself returns 200, not another redirect or a 404
- [ ] No route enters the Removed state without having passed through Redirected first (per [`route-lifecycle.md`](./route-lifecycle.md))

## Failure Conditions

- A route moves without a paired redirect — the current, real, unfixed state of `/admin/line-customers` → should point at `/admin/relationships`, does not today
- A redirect target itself 404s (double-hop failure)
- A redirect uses 302 for what is actually a permanent move, causing search engines/caches to keep hitting the old path

## Recovery Procedure

1. Add the missing redirect as an immediate, narrowly-scoped hotfix — this is data/config, not a feature, and doesn't require unblocking Plan Lock.
2. For the specific known gap on record: `/admin/line-customers` → `/admin/relationships` is the concrete, already-identified first candidate for this policy's first real redirect entry, whenever the owner authorizes making the change.
3. Re-run [`zero-broken-url-policy.md`](./zero-broken-url-policy.md)'s validation checklist after adding any redirect to confirm no new double-hop was introduced.
