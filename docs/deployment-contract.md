# Deployment Contract — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. No script, config, or CI step was added or changed to produce this document — every "exists today" claim below was verified by reading `package.json` and `scripts/`, not assumed.

## Objective

Define the exact sequence of validation gates a change must pass before reaching production, and make explicit which gates already exist versus which are proposed — so "deploy" stops meaning "typecheck + build" implicitly and starts meaning a defined, complete contract.

## Architecture Principle

Fail closed: any gate in the pipeline failing blocks the deploy, it does not warn and continue. A public route missing from the build, or a broken navigation link, is treated as a release failure with the same severity as a type error — not a follow-up ticket filed after users hit it.

```
TYPECHECK → REGISTRY_VALIDATION → ROUTE_GRAPH_VALIDATION → NAVIGATION_VALIDATION
  → LINK_VALIDATION → REDIRECT_VALIDATION → BUILD → SMOKE_TEST → PRODUCTION_DEPLOY
```

## Requirements

Each pipeline stage, checked against what actually exists in this repo today (not assumed):

| Pipeline stage | Exists today? | Evidence |
|---|---|---|
| TYPECHECK | **Yes** | `npm run type-check` → `tsc --noEmit` |
| REGISTRY_VALIDATION (module/command/dependency-graph) | **Partial** | `npm run guard` (`scripts/pre-commit-check.sh`) runs Guards 0-8: architecture health, no leaked credentials, no mock/fake in engines, no direct Supabase import bypassing layers, no duplicate types, dependency-graph cross-layer import check, Connector Lifecycle Law. None of these check *routes* specifically. |
| ROUTE_GRAPH_VALIDATION (every route in registry has a real file, vice versa) | **No** | No script diffs `registry/portals.json` hrefs against `app/**/page.tsx` on disk. This is precisely the gap that let `/admin/line-customers` go stale in `portals.json` after the page was deleted — nothing would have failed a build over it. |
| NAVIGATION_VALIDATION (nav renders only live routes) | **No** | Same gap as above; `portals.json` is hand-maintained, not generated or checked. |
| LINK_VALIDATION (internal `<Link>`/`fetch` targets resolve) | **No** | No link-checker in `scripts/` or `package.json`. `TECHNICAL_DEBT.md` separately documents a real instance this would have caught: `app/admin/dashboard/page.tsx`'s `routeFor()` builds `/admin/invoice/{id}` path-segment links, but the target pages only read `?documentId=` query params — a broken link that shipped and sat undetected. |
| REDIRECT_VALIDATION | **No** | No redirects exist in `next.config.ts` yet (confirmed — file only sets `turbopack.root`), so there's nothing to validate today. Becomes relevant once [`redirect-policy.md`](./redirect-policy.md) entries exist. |
| BUILD | **Yes** | `npm run build` → `next build` |
| SMOKE_TEST | **No** | No post-build smoke-test script exists. `npm run precommit` runs guards + lint + type-check, not a running-server check. |
| PRODUCTION_DEPLOY | **Manual** | `.vercel/project.json` links the repo to Vercel project `dna-os-deadboard`; deploy is not gated by any of the missing stages above. |

## Validation Checklist

The proposed exit conditions for a deploy to be considered contract-compliant (target state):

- [ ] Zero dead route — no `registry/portals.json` entry without a matching real page
- [ ] Zero broken link — no internal `<Link>`/`fetch` call to a path that doesn't resolve
- [ ] Zero public 404 on a Published route (per [`route-lifecycle.md`](./route-lifecycle.md)'s definition of Published)
- [ ] Zero registry drift — filesystem and `registry/*.json` agree (per [`zero-dead-route-policy.md`](./zero-dead-route-policy.md))
- [ ] Zero navigation drift — rendered nav matches the route registry exactly

None of these are measured today.

## Failure Conditions

- Any gate above returns non-zero / fails its check
- SMOKE_TEST (once built) receives a 5xx from any Published route
- A deploy proceeds with uncommitted changes not reflected in the deployed commit (see [`rollback-policy.md`](./rollback-policy.md) — this is a current, real gap: `CURRENT_STATE.json`'s `working_tree_note` records hundreds of uncommitted files as of the last check)

## Recovery Procedure

1. Block the deploy at the first failing gate — do not proceed past it manually "just this once."
2. If a bad change already reached production before this contract existed/was enforced, follow [`rollback-policy.md`](./rollback-policy.md).
3. Record the failure and its cause in `registry/CHANGELOG.json`, per this project's existing AI Execution Protocol ledger — this is the established mechanism for recording what happened, not a new one invented by this document.

## Adoption gap (why this isn't enforced yet)

Adopting this contract as binding (per [`production-governance.md`](./production-governance.md)'s approval path) would still leave REGISTRY_VALIDATION / ROUTE_GRAPH_VALIDATION / NAVIGATION_VALIDATION / LINK_VALIDATION / SMOKE_TEST unbuilt. Building them is new tooling — new feature work — which `CURRENT_STATE.json.plan_lock` blocks until TASK-001/002/003 are DONE. This document records the target so that work has a spec once unblocked; it does not itself unblock anything.

**Immediate, already-actionable finding, independent of this contract's adoption status**: the one known instance of what ROUTE_GRAPH_VALIDATION would have caught today is `registry/portals.json:220` (`/admin/line-customers`, dead) — a one-line data fix, not a new feature, flagged in the prior route audit, available for normal Level 2 handling whenever the owner wants it fixed.
