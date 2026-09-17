# Zero Broken URL Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

No internal or external link this system produces ever points at a URL that fails to resolve as the link implies it should.

## Architecture Principle

Link integrity is checked structurally, the same way type integrity is checked by `tsc` — a link is a claim about the route graph, and that claim should be validated mechanically, not caught by a user hitting it first. This policy is the *detection* layer; [`zero-dead-route-policy.md`](./zero-dead-route-policy.md) is its narrower sibling for *registry bookkeeping* specifically, and [`url-lifecycle-policy.md`](./url-lifecycle-policy.md) covers the broader contract a URL represents once it resolves correctly.

## Requirements

- Every internal `<Link href=` and `fetch(` target must resolve to a route that actually exists on disk.
- Every entry in `registry/portals.json` must resolve to a live page.
- Every externally-registered URL (LINE console webhook/LIFF endpoint) must be checked against what this app actually serves, not assumed correct.
- Two real, already-known counter-examples ground why this is needed, not hypothetical:
  - `registry/portals.json:220` links to `/admin/line-customers`, deleted 2026-07-13, never redirected or removed from nav.
  - `app/admin/dashboard/page.tsx`'s `routeFor()` builds `/admin/invoice/{id}` path-segment links; the target pages only read `?documentId=` query params (`TECHNICAL_DEBT.md`).

## Validation Checklist

- [ ] Static scan: every `<Link href="...">` and template-string `fetch(\`/admin|/api...\`)` target matches a real file under `app/`
- [ ] `registry/portals.json` href audit against the filesystem route tree
- [ ] Post-deploy live probe of every Published route returns a non-5xx, non-404 status
- [ ] External URL registrations (LINE console) spot-checked after any domain or route change

## Failure Conditions

- Any of the above scans finds a mismatch
- A live probe returns 404/5xx on a route listed as Published in the registry

## Recovery Procedure

1. If the fix is a pure data correction (e.g. a stale `portals.json` href), apply it directly — Level 2, safe, no feature work involved.
2. If the underlying route is genuinely gone, add a redirect to the nearest valid replacement per [`redirect-policy.md`](./redirect-policy.md) rather than leaving a dead end.
3. Track the incident under [`route-stability-policy.md`](./route-stability-policy.md) if it reveals a pattern (e.g. multiple links assumed a contract the target never implemented).
