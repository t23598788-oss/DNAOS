# Route Stability Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Guarantee that once a route reaches the Published state (per [`route-lifecycle.md`](./route-lifecycle.md)), its path, authentication requirement, and response contract stay stable unless changed through a governed process — so internal refactors never become invisible external breakage.

## Architecture Principle

Stability is a promise to the caller, not a property of the code behind it. Internal implementation is free to change — which engine backs `/api/admin/line-customers/[lineUserId]/ask`, for example, can be rewritten at will — as long as the path, the `requireAuth(TIER)` requirement, and the response shape don't change out from under whatever's calling it. This mirrors the layer boundary this repo already enforces internally (`dependency-graph.json`'s cross-layer import rules); Route Stability is the same idea applied at the app/API boundary, where the "caller" may not even be part of this repo.

## Requirements

- A route's path, once Published, does not change in place. A path change is a move (`route-lifecycle.md`: Published → Redirected), never an in-place rename.
- A route's `requireAuth` tier does not change silently. Tightening (e.g. adding a check) or loosening (e.g. `ADMIN_TIER` → something weaker) is a deliberate, called-out decision, not a side effect of an unrelated change.
- A route's JSON response shape is additive-only while the route stays at its current version — fields may be added, not removed or repurposed, without a version change (see [`versioning-policy.md`](./versioning-policy.md)).
- Known real consumers of internal admin routes must be checked before a shape change — e.g. `app/admin/relationships/workspace.tsx` calls `/api/admin/line-customers/[lineUserId]/{ask,reply,send-debt,send-document,build-event}` directly; those response shapes are load-bearing for that component today.

## Validation Checklist

- [ ] Diff the `requireAuth(...)` call on any modified route against its previous version — flag any tier change explicitly
- [ ] Diff the response `NextResponse.json(...)` shape against previous version — flag any removed/renamed field
- [ ] Grep the repo for `fetch(` calls targeting the modified path to identify real internal consumers before changing shape
- [ ] Confirm the route's path itself is unchanged, or that a redirect was added per [`redirect-policy.md`](./redirect-policy.md) if it moved

## Failure Conditions

- A route's auth tier is downgraded (e.g. `ADMIN_TIER` removed) without an explicit, recorded decision — a real security regression, not just a compatibility break
- A route's auth tier is upgraded in a way that breaks an existing caller that isn't aware of the new requirement
- A consumer like `workspace.tsx` breaks because a field it reads (`res.json()` shape) was renamed or dropped upstream
- A path changes with no redirect, producing the exact failure already on record for `/admin/line-customers` (see [`route-lifecycle.md`](./route-lifecycle.md))

## Recovery Procedure

1. Revert the breaking change immediately.
2. If the change is intentional, route it through [`versioning-policy.md`](./versioning-policy.md) (new path/version) instead of an in-place break, or through [`redirect-policy.md`](./redirect-policy.md) if it's a pure move.
3. Re-verify every known internal consumer of the affected route against the corrected/reverted contract before considering the incident closed.
