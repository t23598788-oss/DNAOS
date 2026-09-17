# Route Deprecation Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no route was changed to produce this document.

## Objective

Define the decision process and sunset window for a route entering and leaving the **Deprecated** state (per [`route-lifecycle.md`](./route-lifecycle.md)'s state table), so "deprecated" means a tracked, time-boxed transition rather than an informal label nobody acts on.

## Architecture Principle

`route-lifecycle.md` defines *what* Deprecated means and *that* [`redirect-policy.md`](./redirect-policy.md) governs the mechanical redirect. This document is the missing middle layer: *who* decides a route is deprecated, *how long* it stays reachable before removal, and *what evidence* justifies moving it forward a state. Without this layer, "Deprecated" has no exit condition — exactly the gap that let `/admin/line-customers` skip straight from Published to gone (`registry/CHANGELOG.json`, `DNA-000021`) instead of passing through a real sunset window.

## Requirements

- **Entering Deprecated requires a named replacement**, not just an announcement that the old route is going away — matching `route-lifecycle.md`'s own definition ("marks it superseded and names the replacement"). `PHASE3_BACKLOG.md` item 7 (`/admin/partners` → `/admin/relationships`) is the one currently-planned, correctly-shaped example: replacement already exists and is named before deprecation would begin.
- **Sunset window is stated explicitly at the moment of deprecation, not decided later.** Proposed default: minimum 30 days for any route with a known external dependency (LIFF endpoint, partner-shared bookmark per `route-lifecycle.md`'s Published definition), since those callers cannot be pushed a code update the way this app's own UI can.
- **Exit from Deprecated to Removed requires evidence, not just elapsed time.** At minimum: server logs (once `SMOKE_TEST`/access logging exists, per [`deployment-contract.md`](./deployment-contract.md)'s gap list) showing zero real traffic to the deprecated path for the sunset window, or explicit owner confirmation that the known external dependency has been updated (e.g., LINE console LIFF URL changed).
- **Deprecation of a route with a live external contract** (per [`public-url-contract.md`](./public-url-contract.md)) is at minimum a Level 3 (High Impact) change on the Constitution's approval ladder; deprecating a Draft route with zero external references is ordinary Level 2 work.
- **The deprecation record lives with the redirect entry**, not in a separate untracked place — proposed: a comment or metadata entry alongside the corresponding `next.config.ts` `redirects()` entry once that exists (see `redirect-policy.md`), naming the deprecation date and sunset deadline.

## Validation Checklist

- [ ] Every Deprecated route has a named replacement route already in the Published state
- [ ] Every Deprecated route has an explicit sunset date recorded, not an open-ended "eventually"
- [ ] No route skips from Published directly to Removed without passing through a recorded Deprecated period (the exact failure already on record for `/admin/line-customers`)
- [ ] A route with a known external dependency (LIFF, webhook, partner bookmark) is not moved to Removed until that dependency is confirmed updated

## Failure Conditions

- A route is deleted with no deprecation record at all (the current, real, unfixed state of `/admin/line-customers`)
- A route sits in Deprecated indefinitely with no sunset date, so it never actually gets cleaned up (silent technical-debt accumulation, the opposite failure mode)
- A route is Removed while an external system (LINE console, a partner's saved link) still depends on it, because nobody checked before removing

## Recovery Procedure

1. If a route was removed without passing through Deprecated: restore it as a redirect to its actual replacement (per `redirect-policy.md`) rather than leaving a 404 in place, then let it complete a proper sunset window before full removal.
2. If a Deprecated route has no sunset date, assign one retroactively rather than leaving it open-ended, using the 30-day default unless a shorter/longer window is explicitly justified.
3. Confirm with the owner before any Removed-state action on a route that has ever had a known external dependency — do not infer that enough time has passed.
