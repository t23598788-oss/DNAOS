# Phase 3 Backlog — Relationship-Centric Workspace Migration

**This is a backlog, not an authorization.** Nothing in this document may be implemented without a fresh, explicit Phase 3 execution order from the owner naming Phase 3 directly, per `registry/CURRENT_STATE.json`'s `architecture_freeze`. Risk ratings below have been revised from earlier turns in this migration where a closeout re-verification found the original rating was based on an incorrect assumption (see item 3).

## Backlog items, in dependency order

### 1. Build the Unified Timeline Engine (actual output merge)
- **What**: `buildFeed()` (`app/admin/relationships/feed.ts`) and `buildPartnerTimeline()` (`engines/partner/timeline.ts`) still independently build their own output shapes from the shared `linkDocumentsToEvents()` primitive (Phase 2 only unified the linking logic, not the two functions). Phase 3 would build one engine producing `buildFeed`'s superset shape, with `buildPartnerTimeline`'s narrower shape reachable as a filtered/mapped view of it.
- **Prerequisite**: a recorded decision on the business_events field-set question (raw extractor fields vs. normalized `title`/`description`/`metadata` fields) — a naive merge defaulting to the narrower projection would silently drop real data (material text, contact info) that `partners/[id]` doesn't currently show but the relationship workspace does.
- **Risk**: **Medium.** (Previously rated on the assumption that `partner.timeline`'s public contract had to be preserved exactly — see item 3's correction. The output shape of `buildPartnerTimeline` still needs preserving for its one real internal consumer, `app/api/admin/partners/[id]/timeline/route.ts`, but there is no external caller to protect.)

### 2. Consolidate Business Event and Document read ownership
- **What**: 2-3 independent query shapes for `business_events` (Phase 1's relationship route, `services/supabase/queries.ts::getBusinessEventsByPartner`, and whatever `/api/admin/transactions*` selects — never verified this migration) still exist. Same pattern for Document reads.
- **Prerequisite**: item 1's field-set decision informs this directly.
- **Risk**: **Medium** — read-only consolidation, no schema change, but touches multiple live routes.

### 3. Fix the dead `partner.timeline` command (correction from this closeout)
- **What**: `partner.timeline` is declared as a handler in `engines/validation/dispatcher.ts`'s `QUERY_MAP` but is missing from `registry/command-registry.json`'s `commands` object, so `dispatch()` rejects every call before the handler ever runs (`"Shadow Command ถูกปฏิเสธ"`). Either register it properly (if a real external consumer is wanted) or remove the dead handler and the misleading example in `app/examples/page.tsx` that advertises it as usable.
- **Why this belongs in Phase 3, not before**: this is new information from the closeout pass, not something the owner has weighed in on yet.
- **Risk**: **Low** — it's currently non-functional either way; the only question is which direction to resolve it, which is a product decision, not an engineering risk.

### 4. Embeddable `DocumentBuilder.tsx` / `TransactionPanel.tsx`
- **What**: both components currently own their full viewport (`flex h-screen overflow-hidden`) and cannot be mounted inline inside the Relationship Workspace. Rewriting them to support an embedded/inline mode is required before document creation or job details can live inside the workspace instead of a separate page.
- **Risk**: **High** — these are the components that generate/browse every real invoice/receipt/quotation/job in production today. Any rewrite must be driven in a real browser against the golden path and edge cases before being called done, per this project's own verification standard for UI changes.

### 5. Delete duplicate pages, once (and only once) feature parity is confirmed
- **What**: `app/admin/partners/[id]/page.tsx` (credit pill, job-chain cards, LINE mini-viewer) and `app/admin/jobs/[id]/page.tsx` (expected/extra document checklist, event icons) each have real content with no confirmed replacement in the Relationship Workspace yet. Do not delete either until every distinct capability they provide has a verified home in the workspace.
- **Also in scope for eventual deletion**: the 6 `DocumentBuilder mode="browser"` pages (`invoice`, `receipt`, `purchase-order`, `delivery-order`, `payment-voucher`, `debt-notice`) and `/admin/create-document`, once document creation/browsing is fully in-workspace.
- **Risk**: **Medium-High** depending on which page — deleting a still-linked, still-used page before replacement parity is a real feature regression, not architecture cleanup.

### 6. Automation / Settings schema migration
- **What**: move `debtReminderAutoEnabled`/`debtReminderHour`/VAT-override/document-terms from global `app_configs` to a per-relationship-scoped owner, per the Canonical Ownership decision that Automation is inherently per-relationship.
- **Risk**: **High** — a schema change against a table used by every document-creation call in production, holding real customer financial defaults. Recommend an additive migration (new table, `app_configs` untouched) so rollback is a table drop, not a data-loss risk.

### 7. Routing cleanup
- **What**: `/admin/partners` and `/admin/partners/[id]` become redirects to `/admin/relationships`/`/admin/relationships/[id]` during a transition window, then are removed once no external bookmark dependency remains. `app/admin/dashboard/page.tsx`'s `routeFor()` (builds `/admin/invoice/{id}` path-segment links that don't match those pages' actual `?documentId=` contract) gets fixed as part of whichever phase touches those pages next.
- **Risk**: **Low.**

## Suggested execution order

1 → 2 (share the field-set decision) → 3 (independent, can happen anytime, needs only a product decision) → 4 → 5 → 6 → 7. Item 3 has no dependency on the others and could be resolved on its own if the owner wants a quick, isolated fix before committing to the larger phases.

## Explicit reminder

No item above may begin without the owner issuing a fresh Phase 3 execution order that names Phase 3 directly. `registry/CURRENT_STATE.json`'s `architecture_freeze` key is the enforcement point — any AI session must read it before touching any file in this scope.
