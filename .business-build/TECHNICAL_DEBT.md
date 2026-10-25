# Technical Debt Register — as of Phase 2 Closeout (2026-07-13)

Every item below was found by direct inspection during this migration (registry read, disk-existence check, grep, or live-data query) — not inferred or assumed. Items are grouped by whether Phase 2 already resolved them, or they remain open for Phase 3+.

## Resolved this migration (Phase 1 + Phase 2)

| Item | Fix |
|---|---|
| Workspace identity keyed by `line_user_id`, excluding companies with no LINE history | Re-keyed to `relationship_id` (`companies.id`); new `/admin/relationships` list is rooted at `companies`, not `line_events` |
| No deep-linkable per-contact workspace URL | `/admin/relationships/[relationshipId]` |
| 15 dead `module-registry.json` entries (files deleted, registry still said `"active"`) | Removed |
| 13 files created this migration with no registry entry | Registered |
| `architecture.json` declared `validation/resolver` — file never existed anywhere in the repo | Removed the reference |
| `architecture.json` declared `debt` and `commands` — real files are `debt/` (a directory) and `command-registry.json` | Corrected to `debt/engine` and `command-registry` |
| `architecture.json`'s `presenter` layer purpose string falsely claimed "Timeline" — `presenter` is structurally forbidden from importing `engines` (`dependency-graph.json`'s `presenter_no_engines` rule), so Timeline logic could never legitimately live there | Purpose string corrected |
| `buildFeed()` and `buildPartnerTimeline()` independently reimplemented event-to-document linking | Extracted to `engines/presentation/timeline-engine.ts::linkDocumentsToEvents()`; verified byte-identical output against 3 real relationships |
| `EVENT_STYLE` (`partners/[id]`) and `EVENT_ICONS` (`jobs/[id]`) independently defined | Relocated (values untouched — they already differ for the same `event_type`) to `engines/presentation/event-style.ts` |
| `getMaterialTypes()` queried a `products` table that doesn't exist in this schema — silently returned `[]` forever | Fixed to query the real `material_types` table |
| Quotation/invoice/BOQ documents created via chat always rendered with 0 items and 0.00 total | Root-caused to `buildDebtItems()` misuse for non-debt documents; replaced with real material/quantity extraction + real pit-pricing lookup |
| `DocumentViewer.tsx` leaked a global `<style>` rule (including a `body{width:800px}` selector) into the live page's DOM via `dangerouslySetInnerHTML` | Fixed with iframe isolation |
| 9 dead `ui-kit` components (a superseded floating-window OS with zero live consumers) | Deleted |

## Open — discovered, not yet fixed (Phase 3+ candidates, see `PHASE3_BACKLOG.md` for the authorized ones)

| Item | Evidence | Severity |
|---|---|---|
| **`partner.timeline` command is dead** — declared as a handler in `dispatcher.ts`'s `QUERY_MAP` but missing from `command-registry.json`'s `commands` object, so `dispatch()` rejects it as a "Shadow Command" before the handler ever runs | Traced `dispatch()` line-by-line; confirmed `partner.timeline` absent from the registry's `commands` keys | Medium — currently non-functional either way, but `app/examples/page.tsx` advertises it as a working example, which is misleading |
| 3 duplicate Timeline *rendering* implementations remain (`jobs/[id]`'s inline event list, `TransactionPanel`'s private `TransactionCard` block, `partners/[id]`'s `TimelineEntry`) — only their icon/style *data* was deduplicated this phase | Confirmed via the Timeline Ownership Audit (this session) | Medium — cosmetic/maintenance debt, not a correctness bug |
| Business Event reads still have 2-3 independent query shapes with different field projections | Confirmed Phase 1's relationship route selects raw extractor fields (`material_text`, `contact_name`...) while `getBusinessEventsByPartner` selects normalized fields (`title`, `description`, `metadata`) for the same table | Medium — a careless future merge could silently drop data one consumer currently shows |
| Automation settings (`debtReminderAutoEnabled`/`Hour`, VAT override, document terms) are global (`app_configs`), not per-relationship, despite being conceptually per-relationship | Confirmed `app_configs` has no relationship-scoping column | Medium — requires a schema migration, not just code |
| Pricing ownership not fully verified — `engines/pricing.ts` vs `engines/quote-price.ts` vs `engines/cost.ts` | Explicitly marked "NOT ENOUGH EVIDENCE" during the Ownership Audit; never re-verified since | Low-Medium — unknown unknown, not confirmed broken, just unconfirmed |
| No dedicated Payment or Delivery data model | Confirmed no `payment`/`delivery` source kind exists in `template-resolver.ts`; both are modeled as Document sub-types | Low — a recorded design decision, not a defect, but worth knowing before anyone assumes otherwise |
| `registry/SCHEDULER.json` has no corresponding runtime code anywhere in the repository | Grepped for scheduler-executing code; zero matches outside the registry JSON itself | Low — matches `CONSTITUTION.json`'s own honesty note that "Runtime" is largely process/documentation today |
| `app/admin/dashboard/page.tsx`'s `routeFor()` builds `/admin/invoice/{id}` (path-segment) links; the target pages only ever read `?documentId=` (query param) | Found during an earlier Explore-agent pass this session; not re-verified at this closeout but not touched since | Low — a broken "view" link on the dashboard, not a data-integrity issue |
| `components/admin/AdminSidebarNav.tsx` still contains a dead `href === "/admin/line-customers"` check for a route that no longer exists | Confirmed the component itself has zero live JSX mounts anywhere (`grep` for `<AdminSidebarNav` returns nothing) | Negligible — dead reference inside dead code |
| `git status` shows hundreds of modified/untracked files across this and prior sessions, nothing committed | Confirmed via `git status --short` at this closeout | Not itself a bug, but a real operational risk — this repo has no commit history for any of this migration's work; a lost working tree would lose it all |

## Debt explicitly declined (recorded as a decision, not an oversight)

- Unifying `EVENT_STYLE` and `EVENT_ICONS` into one mapping was considered and rejected — they render different icons for the same `event_type` today, and forcing agreement would have been an uninstructed UI behavior change.
- Merging `buildFeed()`/`buildPartnerTimeline()`'s *output shapes* (not just their linking logic) was explicitly out of scope for Phase 2 and is deferred to Phase 3 (`PHASE3_BACKLOG.md` item 1).
