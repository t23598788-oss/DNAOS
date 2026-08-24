# SAME-DATA DUPLICATE GATE — architecture-book.json / module-registry.json Presentation Layer

**Mode: measurement + canonicalization determination only. STOP after this report, per the task's own instruction.** Nothing moved, deleted, renamed, rewritten, or created. Repository: `/Users/tam/Desktop/dna-os-deadboard`. Every claim cited to file:line, read in full for all five routes and their direct imports.

---

## CAPABILITY MATRIX

| Route | Capability | Raw source | API | Calculation | Write behavior | Unique behavior | Consumers (of its API) | Business dependency | Candidate canonical owner |
|---|---|---|---|---|---|---|---|---|---|
| `/admin/system` | Architecture graph + health summary + violations + sync trigger + realtime pulse | `registry/architecture-book.json` | `GET/POST /api/build`, `GET /api/governance` | `round(ok/total*100)`, client groupBy for layer table | **Yes** — POST triggers `execSync("sync-registry.ts && build-arch-book.ts")`, writes both registry files | 3D force-graph render (`ForceGraph3DView`), Realtime pulse (Supabase `ai_tasks` subscription) | Itself (both APIs) | None found | **YES — recommended canonical owner for the architecture-book.json graph** |
| `/admin/graph` | None — `redirect("/admin/system")` | n/a | n/a | n/a | None | **None.** Explicit 2026-08-04 owner-authored code comment: *"/admin/build, /admin/graph and /admin/telemetry merged into one screen — see app/admin/system/page.tsx"* | n/a | None | No — already superseded by its own author's decision |
| `/admin/architecture` | 6-tab registry viewer: List (module-registry.json search), Flow (architecture-book.json dependents/deps as cards), System Map (`system-control-graph.json` — a **separate, larger graph**, 1,483 nodes/4,098 edges), Runtime Flow (command/event tracer), Health & Drift (`ARCHITECTURE_HEALTH_REPORT.json` — circular deps, duplicate registrations, missing metadata), Infrastructure (`infrastructure.json`/`drivers.json`/`connector-lifecycle.json`) | `module-registry.json` (bundled import), `architecture-book.json` (bundled import), `registry/system-control-graph.json`, `registry/ARCHITECTURE_HEALTH_REPORT.json`, `registry/infrastructure.json`, `registry/drivers.json`, `registry/connector-lifecycle.json`, `registry/command-registry.json`, `registry/events.json` | `GET /api/admin/architecture/control-graph` (System Map refresh only; read-only, never triggers regeneration) | Command/event runtime trace composition; text search/filter | None found — read-only everywhere, confirmed no `writeFileSync` in page or its one API route | 5 of 6 tabs show data **no other route shows at all** (module-registry Thai purpose-text search across all layers, the entire system-control-graph, health/drift drilldown, runtime command/event tracer, infra/driver/connector inventory) | Itself only | None found | No — but must NOT be deleted; see below |
| `/admin/build` | Same summary/health/violations data as `/admin/system` (subset: only broken+unregistered, not the full 5-status breakdown or the graph), same "Sync Now" trigger, inert command-hint text | `registry/architecture-book.json` | `GET/POST /api/build`, `GET /api/governance` | Same formula as `/admin/system` | **Yes** — identical POST trigger to `/admin/system`'s | **None found beyond `/admin/system`.** Command-hint text (`npm run sync`/`npm run watch`) is static, inert, not wired to any control | Itself (both APIs) | None found | No for capability — **but see the navigation-reachability finding below, which is decision-relevant** |
| `/admin/engine-explorer` | Search/browse `module-registry.json` entries filtered to `layer === "engines"` only, showing owner + status + purpose + exports-as-pills | `registry/module-registry.json` (bundled import — **not** architecture-book.json at all) | None (static import, zero fetch) | Client-side filter/search only | None found | Surfaces `owner` field and `exports` array as individually searchable pills — not shown by any other route, but scoped to one layer only (`engines`) | n/a (no API) | None found | Partial — only for the `engines`-layer slice of module-registry.json |

---

## CLASSIFICATION (not by name or visual similarity — by underlying measurement identity)

| Route | Classification | Why |
|---|---|---|
| `/admin/system` | **CANONICAL** | Most complete presentation of `architecture-book.json` (graph + all 5 status counts + health % + layer breakdown + sync trigger + realtime pulse), accessed through the cleanest indirection (API routes, not raw file imports), and already the Owner's own designated merge target per the 2026-08-04 directive found in `/admin/graph`'s own source comment. |
| `/admin/graph` | **DEAD** | Zero UI, zero API call, zero unique data — a pure `redirect()`. The Owner already decided this on 2026-08-04. The underlying component files (`GraphView.tsx`, `ForceGraph3DView.tsx`) are not dead — they are the actual implementation `/admin/system` imports directly — only the standalone *route* is dead. |
| `/admin/architecture` | **UNIQUE_CAPABILITY** (route-level), containing one **PARTIAL_DUPLICATE** sub-component | 5 of 6 tabs read real data no other route surfaces at all (see matrix). Only the **Flow tab** is a partial duplicate — the code's own comment (page.tsx lines 698-705, per the tracing pass) explicitly states it is "the same data the 3D graph already computes, just presented as readable flow cards instead of a 3D node cloud." |
| `/admin/build` | **DUPLICATE_PRESENTATION** | Every capability on this page (summary/health subset, violations subset, sync trigger) already exists, more completely, on `/admin/system`. The command-hint text is not a control — it does not execute anything. No unique data, no unique write path. |
| `/admin/engine-explorer` | **UNIQUE_CAPABILITY** (narrow) — but **DEAD by reachability**, not by capability | The owner+exports+purpose search for the `engines` layer is genuinely not duplicated anywhere else in the app — but zero inbound link to this route exists anywhere in the entire repository (confirmed by a full-repo grep for the literal string `engine-explorer` returning no matches outside its own file). It is real, unique, and currently unreachable except by typing the URL. |

---

## ANSWERS TO THE 10 QUESTIONS

**1. Which ONE component/API pipeline should own architecture-book/module-registry visualization?**

This splits into two separate answers because the two files are genuinely different data, read by different route sets:

- **`architecture-book.json` (the import/dependency graph)**: `/admin/system`'s pipeline — `GraphView.tsx` + `ForceGraph3DView.tsx` + `GET /api/governance` + `GET/POST /api/build` — is the correct canonical owner. It is already the most complete presentation, already API-mediated (not a raw file import, unlike `/admin/architecture` and `/admin/engine-explorer`), and the Owner already documented an intent to consolidate onto it (2026-08-04 comment in `/admin/graph`'s source).
- **`module-registry.json` (the per-file owner/purpose registry)**: **no existing route is a clean, complete canonical owner today.** `/admin/architecture`'s List tab is the broadest existing presentation (all layers, full search), but it is bundled via a raw static `import` rather than an API, and it is one tab among six on a page whose other five tabs read five *other* files entirely. `/admin/engine-explorer` covers only the `engines` layer. This question is **not resolved by this round's evidence** — it is a real decision for the Owner, not guessed here.

**2. Which routes contain genuinely unique capabilities that must survive?**
`/admin/architecture` (5 of 6 tabs — List/Map/Runtime Flow/Health & Drift/Infrastructure) and `/admin/engine-explorer` (owner+exports+purpose search, engines-layer only). Both must survive relocation intact — **their underlying data files, generator scripts, and API routes must not be deleted or recreated**, per the task's own constraint.

**3. Which routes are presentation-only duplicates?**
`/admin/graph` (100%, already dead) and `/admin/build` (100% of its capability; its command-hint text is inert, not a control). `/admin/architecture`'s Flow tab specifically (not the whole route).

**4. Does `/admin/build` contain execution/build controls beyond architecture visualization?**
**No.** Confirmed by full file read of `app/admin/build/page.tsx` and `app/api/build/route.ts`: the only real action is the same `execSync("npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts")` that `/admin/system`'s own "Sync Now" button already triggers. No `npm run build`, `tsc`, lint, deploy, CI, or test execution exists on this page — the "Command hints" block is static, inert text, not wired to any button or handler.

**5. Does `/admin/engine-explorer` contain unique inspection capability?**
**Yes, but narrow and currently unreachable.** It surfaces `module-registry.json`'s `owner` field and `exports` array as individually searchable pills, for the `engines` layer only — not available on any other route. It has no source-code viewer (that capability belongs exclusively to the separate `/admin/reader` page, which this route does not link to).

**6. Does `/admin/architecture` contain information not recoverable from the canonical graph (`architecture-book.json` via `/admin/system`)?**
**Yes, extensively.** `module-registry.json`'s `owner`/`purpose`/`purpose_th` narrative text (not shown by `/admin/system` at all); the entire separate `system-control-graph.json` (1,483 nodes / 4,098 edges — a different, larger graph `/admin/system` never loads); `ARCHITECTURE_HEALTH_REPORT.json`'s circular-dependency cycles and duplicate-registration list (`/admin/system` only shows the 5 summary counts, not cycle/duplicate detail); the command/event runtime tracer; and the infrastructure/driver/connector-lifecycle inventory.

**7. Every consumer of `GET /api/governance`:**
`app/admin/graph/GraphView.tsx` (2 call sites: full book, single-node detail), `app/admin/system/page.tsx` (2 call sites: full book, layer filter — plus an identical duplicate pair in the stray `page 2.tsx` file), `app/admin/build/page.tsx` (1 call site: full book, filtered client-side for broken/unregistered only). **3 distinct live route files** (system, build, and graph's embedded component — `/admin/graph`'s own route file does not call it directly, only via the redirect target).

**8. Every consumer of `GET/POST /api/build`:**
`app/admin/system/page.tsx` (GET + POST, plus duplicate pair in `page 2.tsx`), `app/admin/build/page.tsx` (GET + POST). **Exactly 2 distinct live route files can trigger the real registry-regeneration `execSync` call.**

**9. Every writer and reader of `registry/architecture-book.json` and `registry/module-registry.json`:**

- **`architecture-book.json` writer**: exactly one — `scripts/build-arch-book.ts:648` (`writeFileSync`), reachable from the UI only via `POST /api/build` (question 8's two callers).
- **`architecture-book.json` readers**: far broader than the 5 UI routes in question — confirmed real reads in `app/OperationalWorkspace.tsx`, `app/business/page.tsx`, `app/report/page.tsx`, `app/admin/architecture/page.tsx`, plus an entire `app/api/admin/ide/_lib/` runtime family (`systemRealityRuntime.ts`'s shared `loadArchitectureBook()`, consumed by `deadEndSweepRuntime.ts`, `architectureSummaryRuntime.ts`, plus separate local re-parses in `contextPlannerRuntime.ts`, `changeSetRuntime.ts`, `monitoringRuntime.ts`, `buildRuntime.ts`, `executionContextRuntime.ts`), `app/api/admin/workspace/status/route.ts`, `app/api/dbd/route.ts` (3 call sites), several `plugins/drivers/*.selfDescription.ts` and `engines/*.selfDescription.ts` files, `engines/workspace/dependencyDiscovery/scanTypescriptImports.ts`, and `scripts/hello.ts`. **This file is load-bearing infrastructure for far more than the 5 presentation routes in this audit — any relocation plan must account for these ~20 non-UI consumers separately, not bundle them with the UI-duplicate question.**
- **`module-registry.json` writers**: `scripts/sync-registry.ts:46` (the real generator, reachable via the same `POST /api/build` — wait, verify: actually reachable via the Sync Now button which runs both scripts) and `scripts/new-module.ts:120` (a CLI scaffolding script, not reachable from any UI). A separate governed-proposal path exists (`app/api/v1/mcp/governance/registry-proposals/route.ts`) that writes proposals to a Supabase table `dev_loop_registry_proposals` rather than the file directly — a real but distinct approval workflow.
- **`module-registry.json` readers**: even broader than `architecture-book.json`'s — `core/workspace/moduleRegistry.ts`, `app/observer.json/route.ts`, `app/business/page.tsx`, `app/admin/architecture/page.tsx`, `app/admin/engine-explorer/page.tsx`, `app/start/page.tsx`, `app/observer/page.tsx`, `app/api/v1/modules/route.ts`, `engines/workspace/fileExistenceRegistry.ts`, `core/runtime/contextBroker.ts`, the same `ide/_lib` runtime family (via `classification.ts`'s shared `loadModuleRegistry()`), `app/api/dbd/route.ts`, more `selfDescription.ts` files, `engines/workspace/dependencyDiscovery/{scanJsonRegistry,diff}.ts`, `scripts/impact-analyzer.ts`, `scripts/hello.ts`, `scripts/build-factory-registry.ts`, `scripts/build-code-classification.ts`.

**10. Confirm the actual navigation paths reaching all five routes:**

| Route | Reachable via live UI navigation? | Evidence |
|---|---|---|
| `/admin/system` | **Weak — 1 link, on a page not independently re-verified as itself reachable** | `app/admin/business-experiment/page.tsx:171` |
| `/admin/graph` | **No** | Only reference is from `/admin/dbd` (`onNavigate("/admin/graph")`), and `/admin/dbd` itself has zero inbound links anywhere in the repo |
| `/admin/architecture` | **No** | Only references are from the confirmed-**unmounted** `app/OperationalWorkspace.tsx` (verified: `app/page.tsx` renders `OwnerConsole`, not `OperationalWorkspace` — zero live import of that component anywhere) and from the same unreachable `/admin/dbd` |
| `/admin/build` | **Yes — strong, confirmed** | Central `IconRail` navigation array in `app/admin/relationships/workspace.tsx:82`, itself used by 6 real, confirmed-live admin pages (`relationships`, `relationships/[id]`, `dev-loop`, `owner-board`, `developer-board`, `infrastructure/github`) |
| `/admin/engine-explorer` | **No — zero matches anywhere** | Full-repo grep for `engine-explorer` outside its own file: no results |

**This is the single most decision-relevant finding in this report**: the route with the *strongest* live user-reachability (`/admin/build`) has **zero unique capability** (Classification: DUPLICATE_PRESENTATION), while the route this report recommends as the canonical *code* owner (`/admin/system`) has only one weak, unverified inbound link. Any canonicalization must resolve this mismatch explicitly — collapsing `/admin/build` into `/admin/system` without addressing navigation would make the architecture-graph capability **harder** to reach for real users, not easier.

---

## CANONICAL CAPABILITY BOUNDARY (proposed, not implemented)

```
architecture-book.json (the code import/dependency graph)
  CANONICAL OWNER: /admin/system's pipeline
    (GraphView.tsx + ForceGraph3DView.tsx + GET /api/governance + GET/POST /api/build)
  DUPLICATE, TO BE RETIRED (presentation only — data/generator/API untouched):
    /admin/graph (already dead, redirect only)
    /admin/build (100% subset of /admin/system's own data + trigger)
  PARTIAL DUPLICATE, TO BE RECONCILED, NOT DELETED:
    /admin/architecture's Flow tab (same data, card presentation — the other 5 tabs are NOT duplicates)

module-registry.json (the per-file ownership/purpose registry)
  CANONICAL OWNER: UNRESOLVED — no existing route is a complete, API-mediated presentation
  covering all layers. /admin/architecture's List tab (broadest) and /admin/engine-explorer
  (owner+exports search, engines-layer only) both hold real, non-overlapping capability that
  must survive. Do NOT force one to "win" without an explicit Owner decision — see Q1.

system-control-graph.json, ARCHITECTURE_HEALTH_REPORT.json, infrastructure.json (viewed on
/admin/architecture), drivers.json, connector-lifecycle.json, command-registry.json, events.json
  CANONICAL OWNER: /admin/architecture (the only route that reads any of these) — not in
  question, no duplicate presentation exists for these six files anywhere in this audit.
```

---

## IMPACT PROOF — removing each duplicate presentation (proof only, nothing executed)

**`/admin/graph` (route file only)**
- What breaks: nothing. Zero live inbound link, zero unique data, zero API calls of its own.
- What must remain: `GraphView.tsx`/`ForceGraph3DView.tsx` (still imported directly by `/admin/system`) — these are components, not the route, and are out of scope for this removal.
- Consumers of `/api/governance`/`/api/build` affected: none (this route never called either API itself).

**`/admin/build`**
- What breaks: the one confirmed-live navigation path to *any* architecture-graph presentation (the central `IconRail`'s "ระบบ" item, used across 6 real admin pages) would go dead, **unless** that nav link's `href` is repointed to `/admin/system` first. This is the one real, proven dependency an Owner must resolve before removing this route — not a code dependency, a **navigation** dependency.
- What must remain: the underlying `/api/build`/`/api/governance` APIs (still used by `/admin/system`), `registry/architecture-book.json`/`module-registry.json` (evidence, untouched), `scripts/sync-registry.ts`/`scripts/build-arch-book.ts` (still triggered by `/admin/system`'s own Sync Now).
- Business runtime impact: none (no business-domain dependency found in either round of tracing).

**`/admin/architecture`'s Flow tab only (not the whole route)**
- What breaks: nothing, if only the Flow tab's redundant card-view is removed while the other 5 tabs and the page shell remain — the underlying `architecture-book.json` `dependents`/`internal_dependencies`/`data_tables` fields it reads are also read by other tabs on the same page (Health & Drift, System Map) and by `/admin/system` itself, so no data becomes orphaned.
- What must remain: `module-registry.json`, `system-control-graph.json`, `ARCHITECTURE_HEALTH_REPORT.json`, `infrastructure.json`, `drivers.json`, `connector-lifecycle.json`, `command-registry.json`, `events.json` — all still read by this page's other 5 tabs.

**`/admin/engine-explorer` (if ever consolidated into a canonical module-registry view — not currently proposed as "remove," since it has zero duplicate; listed for completeness)**
- What breaks: nothing today (zero inbound links means zero real users currently depend on this exact URL) — but its **capability** (owner+exports+purpose search for the `engines` layer) would need to be preserved somewhere before this route could be safely retired, per the task's "do not destroy the graph data" / capability-preservation instruction. This is a capability-migration question, not a simple deletion.

**No item in this impact proof requires touching**: `registry/architecture-book.json`, `registry/module-registry.json`, `scripts/build-arch-book.ts`, `scripts/sync-registry.ts`, `GET /api/governance`, `GET/POST /api/build`, or any of the ~40 non-UI consumer files enumerated in Question 9 — all of those are shared infrastructure outside this UI-duplication question and are untouched by every scenario above.

**STOP — evidence and canonicalization proposal only, per the task's own instruction. No file moved, deleted, rewritten, or created.**
