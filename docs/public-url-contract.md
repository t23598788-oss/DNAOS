# Public URL Contract — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only.

## Objective

Define what any external caller — a real user, LINE's platform, a partner's saved bookmark, a webhook sender — is entitled to assume about a Published URL (per [`route-lifecycle.md`](./route-lifecycle.md)), independent of internal implementation.

## Architecture Principle

This is the content of the promise; [`url-lifecycle-policy.md`](./url-lifecycle-policy.md) and [`route-stability-policy.md`](./route-stability-policy.md) govern how and when that promise can change state. A URL's contract has three parts: **reachability** (resolves, doesn't 404/500 unexpectedly), **shape** (response format/fields a caller depends on), and **authority requirement** (whether/what auth is needed) — matching the three things `route-stability-policy.md`'s Requirements section already names as immutable-without-process (path, auth tier, response shape).

## Real external contracts already in force today (verified, not hypothetical)

- **LINE Messaging API webhook** — registered against a Supabase Edge Function domain (`supabase/functions/line-webhook-v2`), not this app's domain. Its contract: must return fast (this repo's own `DNA-000018` fix moved event processing to `EdgeRuntime.waitUntil` specifically because LINE's platform has its own timeout expectations), and must accept the exact signature-verification headers LINE sends.
- **LIFF endpoint URL** (`app/liff/add-friend`) — registered in the LINE Developers console against this app's own domain. Unlike the webhook, this one *does* move if `dnaos.co.th` gets bound and the canonical host changes (see [`canonical-url-policy.md`](./canonical-url-policy.md)) — the LINE console entry must be updated in the same change window, not as a follow-up.
- **`/api/v1/*` routes** (`capabilities`, `constitution`, `drivers`, `modules`, `query`, `spec`, `workflows`) — the closest thing this repo has to a declared public API surface. `TECHNICAL_DEBT.md` (from the 2026-07-13 migration closeout) already records a real defect class here: the `partner.timeline` command was advertised as callable in `app/examples/page.tsx` but was actually unreachable (missing from `registry/command-registry.json`) — a contract violation that shipped undetected because nothing validates "documented as callable" against "actually registered."

## Requirements

- Every Published URL's contract (reachability/shape/auth) is written down somewhere discoverable — this document doesn't mandate a new format, but a URL with no recorded contract is itself a policy gap worth flagging, not silently accepted.
- A contract change (shape, auth) follows [`route-stability-policy.md`](./route-stability-policy.md) and, if the change is breaking, [`versioning-policy.md`](./versioning-policy.md).
- External-system-held URLs (LINE webhook, LIFF endpoint) are enumerated explicitly (this document's list above is the starting enumeration) — not discovered by incident.

## Validation Checklist

- [ ] Every entry in this document's "real external contracts" list still matches what's actually configured in LINE's console (webhook URL, LIFF endpoint URL) — drift here is invisible from this repo alone and must be checked against the external platform directly
- [ ] Every `/api/v1/*` command documented as callable in `app/examples/page.tsx` or `app/admin/api-tokens/page.tsx` is confirmed present in `registry/command-registry.json` (closing the exact gap `TECHNICAL_DEBT.md` already found for `partner.timeline`)

## Failure Conditions

- A documented/advertised command or endpoint is not actually reachable (the `partner.timeline` case)
- LINE's webhook or LIFF config points at a URL this repo no longer serves correctly

## Recovery Procedure

1. For a dead advertised command: either register it properly in `command-registry.json` or remove the misleading documentation — this is a product decision (which direction), not an engineering one, per the existing `TECHNICAL_DEBT.md` note on this exact issue.
2. For an external-system misconfiguration: update the LINE console (or other external registration) directly; this repo's own code cannot fix a stale entry in a system it doesn't control.
