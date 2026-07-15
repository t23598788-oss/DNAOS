# DNA OS — Relationship-Centric Workspace Migration — Phase 2 Closeout

**Status: PHASE 2 CLOSED.** Baseline `DNA-000021`, accepted and frozen by the owner 2026-07-13. Phase 3 requires a fresh, explicit execution order — see `PHASE3_BACKLOG.md`.

This document is the single persisted record of the Canonical Architecture Specification produced during this migration. Prior to this file, that specification existed only in conversation history — closing that exact gap is itself one of this closeout's deliverables.

---

## 1. Final Architecture Report

### 1.1 Canonical Ownership (target state, reached for the items marked ✅; not yet reached for ⏳)

| Capability | Canonical Owner | Status |
|---|---|---|
| Customer / Relationship / Company / Partner | `app/api/admin/relationships/*` over `companies` table | ✅ Owner established (Phase 1). `partners` pages still exist in parallel — not yet merged (Phase 4). |
| Conversation | Relationship detail route's multi-thread LINE aggregation | ✅ |
| Timeline (event↔document linking logic) | `engines/presentation/timeline-engine.ts::linkDocumentsToEvents()` | ✅ Single owner of the one duplicated piece of logic. `buildFeed()` and `buildPartnerTimeline()` remain two functions by design (external contract — see §1.4 correction). |
| Business Event (reads) | Still 2-3 independent query shapes | ⏳ Not consolidated — deferred to Phase 3. |
| Document (generation) | `engines/documents/engine.ts` | ✅ Already single-owned, untouched. |
| Document (reads) | Still split across inline queries and `services/supabase/queries.ts` | ⏳ Not consolidated — deferred to Phase 3/4. |
| Debt | `engines/debt/*` | ✅ Already single-owned. |
| Event icon/style | `engines/presentation/event-style.ts` | ✅ Single file owns both `EVENT_STYLE` and `EVENT_ICONS` (not unified into one mapping — see §1.4). |
| Payment / Delivery | Not a first-class capability by design — modeled as Document sub-types | ✅ Decision recorded, not a gap. |
| Pricing | `engines/pricing.ts` / `engines/quote-price.ts` | ⚠️ `cost.ts`'s exact role never verified — see Known Limitations. |
| Automation | Global (`app_configs`) today; per-relationship is the canonical target | ⏳ Requires schema migration — Phase 5. |
| Runtime/Registry/Gateway/Service | Unchanged, already compliant | ✅ |

### 1.2 Canonical Timeline, Canonical Workspace, Canonical Routing, Canonical Runtime Flow, Canonical Dependency Graph

Full specifications for each of these were produced and are preserved verbatim in this repository's conversation history for this migration. Summarized:

- **Timeline**: Conversation, AI Action, Business Event, Document, Delivery, Payment, Debt, Job, Notification, and Automation each have a defined Producer/Consumer/Database/Renderer mapping. Payment and Delivery are explicitly *not* separate data models — they are Document sub-types (`receipt`, `delivery_order`) surfaced through the same renderer.
- **Workspace**: identity = `relationship_id` (= `companies.id`), never `line_user_id`. Child resources: Conversation (multi-thread), Jobs, Documents, Business Events, Debt, Inspector, Automation (target: per-relationship), Map, Settings.
- **Routing**: keep `/admin/relationships`, `/admin/relationships/[relationshipId]`, `/admin/dashboard`; merge `/admin/partners*`, `/admin/jobs*`, `/admin/transactions`, `/admin/quotation-queue`, `/admin/event-inbox`, `/admin/debt-tracking`, `/admin/pending`; delete `/admin/create-document` and the 6 document-type pages once workspace parity is confirmed.
- **Runtime flow**: User → Route → Workspace → Component → Presenter (`template-resolver.ts`) → Engine → Gateway (writes only) → Service → Database → Timeline → UI.
- **Dependency graph**: unchanged from `registry/dependency-graph.json` — the target architecture fits inside the existing, already-correct import rules once `presenter`'s declared purpose is corrected (done, Phase 2).

### 1.3 What Phase 1 + Phase 2 actually did (verified, deployed)

- **Phase 1**: re-keyed the workspace from `line_user_id` to `relationship_id`. New `/admin/relationships` (list, rooted at `companies` — every real company gets a workspace regardless of LINE history) and `/admin/relationships/[relationshipId]` (deep-linkable — the old page had no per-contact URL at all). Verified against real production data before deploying.
- **Phase 2**: reconciled `registry/module-registry.json` (15 dead entries removed, 15 new files registered) and `registry/architecture.json` (2 broken references fixed, 1 documentation-drift corrected). Extracted the one real duplicated business-logic piece (event↔document linking) into `engines/presentation/timeline-engine.ts`; verified byte-identical output against 3 real relationships before and after. Consolidated the two duplicate event icon/style maps into `engines/presentation/event-style.ts` without unifying their *values* (they already render different icons for the same `event_type` — unifying values would have been a UI behavior change, which was out of scope).

### 1.4 Correction to the record — a finding from this closeout pass

While compiling the Public API Inventory below, I traced `engines/validation/dispatcher.ts::dispatch()` precisely and found that **`"partner.timeline"` is not actually a live, callable command today.** `dispatch()` checks `registry/command-registry.json`'s `commands` object *before* reaching its own internal `QUERY_MAP` handler table; `partner.timeline` is not a key in that registry file (only `partner.list`, `partner.find`, `computer.db.search_partner` are). Every real invocation attempt returns `{ ok: false, violations: ['command "partner.timeline" ไม่อยู่ใน registry — Shadow Command ถูกปฏิเสธ'] }` before the handler that calls `buildPartnerTimeline()` ever runs.

This corrects the risk assessment carried across the three prior audit/spec turns in this migration, where the `partner.timeline` command was treated as a live external API contract requiring careful preservation (rated **High** risk for the eventual Timeline-engine switch). It is not live. The actual reachable consumer of `buildPartnerTimeline()` is only `app/api/admin/partners/[id]/timeline/route.ts` (which calls it directly, bypassing the dispatcher entirely) — an internal admin-UI data path, not a public contract. This is now logged as its own item in `TECHNICAL_DEBT.md` (dead command handler + a misleading example in `app/examples/page.tsx` that advertises a command which cannot actually succeed) and the risk rating for the eventual Timeline merge is revised downward accordingly in `PHASE3_BACKLOG.md`.

---

## 2. Final Module Inventory

- `registry/module-registry.json`: **369 registered modules**, verified **0 dead entries** (every entry resolves to a real file on disk) as of this closeout.
- New modules added this migration: `engines/presentation/timeline-engine.ts`, `engines/presentation/event-style.ts`, `app/admin/relationships/{page.tsx, workspace.tsx, feed.ts, workspace-state.tsx, [relationshipId]/page.tsx}`, `app/api/admin/relationships/{route.ts, [relationshipId]/route.ts}`, `styles/tokens/{colors, elevation, semantic-colors, typography, spacing, index}.ts` — **15 files**.
- Modules removed (dead, 0 live consumers, confirmed before deletion): `app/admin/line-customers/{page.tsx, feed.ts, workspace-state.tsx}`, `components/ui-kit/{WorkspaceCanvas, WindowLayer, Dock, CommandPalette, Drawer, Timeline, DataTable, ChatPanel, PartnerCard, DocumentViewer}.tsx` — **13 files** (some pre-date this specific Timeline migration, from the earlier Presentation Architecture audit in the same session).

## 3. Final Dependency Inventory

- `engines/presentation/timeline-engine.ts` and `engines/presentation/event-style.ts`: **zero imports** — both are leaf modules, structurally cannot participate in a circular dependency.
- `engines/partner/timeline.ts` imports: `core/shared/types` (core), `engines/presentation/*` (engines self-import), `services/supabase/queries` (services) — all within `dependency-graph.json`'s declared `allowed_imports` for the `engines` layer.
- `app/admin/relationships/feed.ts` imports: `components/ui-kit` (components), `engines/presentation/*` (engines) — within `allowed_imports` for `app`.
- **Zero illegal cross-layer imports found** in the full migration scope, both at initial audit and at this closeout re-verification.

## 4. Final Public API Inventory

Real, verified public-facing surfaces:
- `app/api/v1/{capabilities, constitution, drivers, modules, query, spec, workflows}/route.ts` — 7 routes.
- `registry/command-registry.json`: **63 registered commands**, dispatched through `engines/validation/dispatcher.ts::dispatch()`. `partner.timeline` is **not** among them (see §1.4) — genuinely live commands touched by this migration: `partner.list` (unaffected), `material.list` (unaffected).
- `PartnerTimelineEntry` (`core/shared/types.ts`) — the type shape is unchanged by this migration, but per §1.4 it is not currently reachable via the public command dispatcher; it is only consumed internally by `app/api/admin/partners/[id]/timeline/route.ts`.

## 5. Runtime Capability Inventory

Real, working, verified-in-production capabilities as of this baseline:
- Relationship Workspace: open any company's workspace (with or without LINE history), see a merged Timeline (messages, business events, documents, AI actions).
- Create a quotation/invoice/BOQ via AI chat with real material/quantity extraction and real pit-pricing lookup (fixed this session — previously produced 0.00 documents).
- Build a Business Event from unlinked LINE messages (LLM extraction).
- Send an existing document to a customer via LINE; open any document's real HTML in a new tab.
- Debt display and debt-reminder send flow.
- Enterprise Light / Developer Dark themeable landing page backed by a real design-token system.

## 6. Known Limitations

- **Payment and Delivery have no dedicated data model** — by design decision (documented in the Canonical Timeline spec), not a defect, but worth knowing before anyone assumes a `payments` or `deliveries` table/module exists.
- **Automation settings are global, not per-relationship** — `app_configs` has no relationship-scoping column. The concept (debt-reminder enabled/hour, VAT override, document terms) is inherently per-relationship; reaching the canonical target requires a schema migration (Phase 5, not yet authorized).
- **Pricing ownership is not fully verified** — `engines/pricing.ts` vs `engines/quote-price.ts` vs `engines/cost.ts`'s exact division of responsibility was never confirmed with the same rigor as other capabilities. Flagged, not resolved.
- **Scheduler has no real runtime code** — `registry/SCHEDULER.json` exists but zero executing scheduler code was found anywhere in the repository; "Runtime" in this area is presently a registry declaration only.
- **`partner.timeline` command is dead** (§1.4) — advertised in `app/examples/page.tsx` as a usable example but rejected by the dispatcher before reaching its handler.
- Three duplicate *rendering* implementations of Timeline-like data still exist (`app/admin/jobs/[id]/page.tsx`'s inline event list, `components/transactions/TransactionPanel.tsx`'s private `TransactionCard` Timeline block, and `app/admin/partners/[id]/page.tsx`'s `TimelineEntry`) — only their icon/style *mappings* were deduplicated this phase; the rendering logic itself was explicitly out of scope (Phase 3).

## 7. Technical Debt Register

See `TECHNICAL_DEBT.md`.

## 8. Phase 3 Backlog

See `PHASE3_BACKLOG.md`.

## 9. Project Completion Statement

Phase 1 (Relationship Identity Migration) and Phase 2 (Registry Reconciliation + duplicate-logic elimination) are complete, individually verified (typecheck, build, deploy, and — for the Timeline-linking refactor specifically — byte-identical output diffed against real production data), and deployed to production. Zero schema changes, zero route deletions, zero UI behavior changes were made in reaching this baseline. This document, together with `PHASE3_BACKLOG.md` and `TECHNICAL_DEBT.md`, is the complete, persisted record of the migration to this point — no information from this migration exists only in conversation history as of this closeout.

## 10. Phase Status

**PHASE 2: CLOSED.** Recorded in `registry/CURRENT_STATE.json` (`architecture_freeze.phase_2_status = "CLOSED"`). Phase 3 requires an explicit, fresh execution order naming Phase 3 directly — see `PHASE3_BACKLOG.md` for exactly what that would authorize.
