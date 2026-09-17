# Deployment Gate Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. No script, config, or CI step was added or changed to produce this document.

## Objective

Define what a "gate" actually means as an enforcement mechanism — a boolean, non-bypassable checkpoint tied to the Constitution's approval ladder — as distinct from [`deployment-contract.md`](./deployment-contract.md), which lists the pipeline *stages* themselves. This document answers: when a stage fails, what happens next, and who (if anyone) can override it.

## Architecture Principle

A gate is not a warning. `deployment-contract.md`'s own Architecture Principle already states "fail closed... not warn and continue" — this document makes that binding by mapping every gate to the Constitution's existing 5-level approval ladder (`registry/CONSTITUTION.json` → recommendation/approval levels), so "what happens on failure" is never improvised per incident.

## Gate-to-approval-level mapping

| Gate (from `deployment-contract.md`) | Failure severity | Override authority |
|---|---|---|
| TYPECHECK (`npm run type-check`) | Level 5 — Forbidden | None. A type error blocks deploy unconditionally; this already exists and already behaves this way in practice (a failing `tsc --noEmit` has no bypass flag in this repo's scripts). |
| REGISTRY_VALIDATION (`npm run guard`, Guards 0-8) | Level 5 for Guards 0/1/2 (credential leak, mock data in engines, direct-Supabase-bypass) — these map directly to iron_rules; Level 4 for the rest | Level 4 items (e.g. a deliberate, reviewed dependency-graph exception) require owner sign-off per [`owner-approval-policy.md`](./owner-approval-policy.md), never a worker's own judgment call |
| ROUTE_GRAPH / NAVIGATION / LINK / REDIRECT validation | Not yet built (per `deployment-contract.md`'s gap table) — proposed Level 5 once built, since these catch exactly the class of incident already on record (`/admin/line-customers` dead link) | N/A until built |
| BUILD (`npm run build`) | Level 5 | None — a failed `next build` cannot produce a deployable artifact by definition |
| SMOKE_TEST | Not yet built | Proposed Level 4 — a smoke-test failure on a route that isn't user-facing yet (e.g. still Draft) might reasonably be owner-overridden; one on a Published route should not be |
| PRODUCTION_DEPLOY (`vercel --prod`) | The deploy action itself | Level 4 — per [`release-policy.md`](./release-policy.md), a real production deploy is a deliberate act, not an automatic consequence of gates passing |

## Requirements

- A gate failure produces a specific, actionable message (which file, which rule) — not a generic "guard failed." `scripts/pre-commit-check.sh`'s existing Guards 0-8 already do this; any new gate should match that standard.
- No gate is silently skipped. If a gate doesn't exist yet (most of the route/nav/link row above), that absence is itself recorded as a known gap in `deployment-contract.md`, not papered over by pretending the stage ran.
- Level 5 gates (Forbidden) have no override path in code or process — consistent with the Constitution's own definition ("Runtime จะปฏิเสธและหยุดการทำงานทันที").
- Level 4 gates (Approval Required) route to the owner, never to another AI session's judgment — consistent with `owner-approval-policy.md`'s core rule that authorization must be explicit and direct, never inferred.

## Validation Checklist

- [ ] Every gate in `deployment-contract.md`'s pipeline table has an assigned severity level in this document (no gate left unmapped)
- [ ] No Level 5 gate has a bypass flag or environment variable that skips it
- [ ] Every Level 4 gate failure is routed to a recorded owner decision (e.g. `registry/CHANGELOG.json` entry), not resolved silently

## Failure Conditions

- A gate exists but is bypassed via an undocumented flag (`--no-verify`-equivalent) without owner authorization
- A new gate is added without an assigned severity level, leaving its failure-handling ambiguous
- A Level 5 gate failure is worked around instead of fixed at the root cause

## Recovery Procedure

1. If a gate was bypassed improperly: treat the bypass itself as the incident, not just whatever the gate would have caught — record it in `registry/CHANGELOG.json`.
2. Fix the root cause the gate flagged; re-run the full gate sequence from TYPECHECK forward, not just the one gate that failed, since a fix can introduce a new regression upstream of where it was applied.
3. For an unmapped gate discovered during recovery: assign it a severity level in this document before considering the incident closed, so the same ambiguity doesn't recur.
