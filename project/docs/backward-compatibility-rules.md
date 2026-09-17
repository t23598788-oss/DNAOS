# Backward Compatibility Rules — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Ensure changes to routes, APIs, and their response contracts never break an existing external consumer without a governed, intentional transition.

## Architecture Principle

Additive by default. Extending a contract (new optional field, new route) is a Level 2 safe change; mutating or removing part of an existing contract that a real consumer depends on is a breaking change and must go through [`versioning-policy.md`](./versioning-policy.md) or an explicit, owner-approved exception (e.g. a security fix that must break compatibility on purpose).

## Requirements

Known external/decoupled consumers in this repo, enumerated so compatibility has a concrete surface to check against rather than a vague "don't break things":

| Consumer | Where it lives | What it depends on |
|---|---|---|
| LINE Messaging API webhook | `supabase/functions/line-webhook-v2` (Supabase Edge Function, **separate domain** from this Next.js app) | Its own payload/signature contract — not affected by this app's domain or route changes |
| LIFF app | `app/liff/add-friend/page.tsx`, served from this app's domain | The domain itself (see [`domain-migration-policy.md`](./domain-migration-policy.md)) and the LINE console's registered endpoint URL |
| `app/admin/relationships/workspace.tsx` | Internal, but calls its own backend via `fetch` like an external consumer would | Response shape of `/api/admin/line-customers/[lineUserId]/{ask,reply,send-debt,send-document,build-event}` |
| `app/admin/dashboard/page.tsx`'s `routeFor()` | Internal | Already a documented broken-contract example (`TECHNICAL_DEBT.md`): builds `/admin/invoice/{id}` path-segment links; target pages only read `?documentId=` query params. Cited here as the concrete failure mode this policy exists to catch before it ships, not after. |
| Any future partner-facing API | Not yet built | Would become the first genuinely external (outside-this-repo, independently-released) consumer — treat its first version as `/api/v1/*` per [`versioning-policy.md`](./versioning-policy.md) from day one |

## Validation Checklist

- [ ] A changed route's response shape is diffed against known internal consumers (`grep` for `fetch(` calls to that path) before merge
- [ ] LINE webhook payload handling in `line-webhook-v2` is unaffected by any change to this Next.js app (different domain, different deploy) — confirm no accidental coupling was introduced
- [ ] LIFF redirect URI / endpoint URL matches the LINE console's registered value after any domain or path change
- [ ] Deep-link query-param contracts (e.g. `?documentId=`) are checked against actual consumers, not assumed from the producer side alone

## Failure Conditions

- An internal consumer like `workspace.tsx` breaks because an upstream route's response shape changed
- LIFF login fails because the app's domain or LIFF path changed without updating the LINE console
- A dashboard or nav link is built against a contract (path-segment ID) the target page never actually implements — the `routeFor()` pattern already on record

## Recovery Procedure

1. Revert the breaking change.
2. If the change must ship, add the new contract alongside the old one (additive) or version it (see [`versioning-policy.md`](./versioning-policy.md)) rather than mutating in place.
3. Re-check every enumerated consumer above against the corrected contract before closing the incident.
