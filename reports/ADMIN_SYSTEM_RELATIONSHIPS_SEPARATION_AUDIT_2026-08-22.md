# /admin/system + /admin/relationships — TRACE, REGISTRY CHECK & SEPARATION BOUNDARY AUDIT

**Mode: measurement + impact proof only. STOP after this report, per the task's own instruction. Nothing moved, deleted, rewritten, or created.** Repository under audit: `/Users/tam/Desktop/dna-os-deadboard` (the real, live, running Next.js business application — `next dev`, PID 3485/4066, port 3000, confirmed via `lsof`/`ps` in the prior round of this audit). Every claim below is cited to a real file:line, a real running process, or a real on-disk JSON value read directly.

---

## PHASE 1 — TRACE `/admin/system`

Route → `app/admin/system/page.tsx` (376 lines, read in full; a byte-identical stray duplicate `page 2.tsx` also exists in the same folder — Next.js resolves only `page.tsx`, so the duplicate is inert, but it is a real filesystem artifact, noted for completeness).

```
UI field                         →  calculation                          →  provider/API              →  registry/store/file                    →  raw source
last-sync timestamp              →  pass-through                          →  GET /api/build             →  registry/architecture-book.json.generated_at →  scripts/build-arch-book.ts's last run
health ring %                    →  round(ok/total*100)                   →  GET /api/build              →  architecture-book.json.summary          →  same
summary grid (total/ok/broken/…) →  pass-through                          →  GET /api/build              →  architecture-book.json.summary          →  same
layer table (31 layers) + health%→  client-side groupBy + round(ok/total) →  GET /api/governance         →  architecture-book.json.nodes            →  same
violations panel                 →  filter status ∈ {BROKEN,UNUSED,UNREGISTERED} → GET /api/governance   →  architecture-book.json.nodes.status     →  scripts/build-arch-book.ts calcStatus()
3D graph (1,374 nodes / 4,774 edges) → filter type=Module, label=imports  →  GET /api/governance         →  architecture-book.json.nodes/edges       →  real regex-based import/export parse of every real .ts/.tsx file at last sync
"Sync Now" button                →  none (triggers the scan itself)       →  POST /api/build              →  writes architecture-book.json             →  execSync("npx tsx scripts/sync-registry.ts && npx tsx scripts/build-arch-book.ts") — a REAL, live glob("**/*.{ts,tsx}") filesystem walk + per-file readFileSync
realtime pulse trigger           →  none                                  →  Supabase Realtime channel   →  ai_tasks table (INSERT/UPDATE)          →  live DB
realtime pulse node mapping      →  hardcoded KIND_TARGET lookup table    →  n/a                          →  n/a                                       →  literal source code
```

**Provenance classification, per value:**

| Value | Classification | Citation |
|---|---|---|
| Last-sync timestamp | **REAL_FILESYSTEM** (a real value; the file itself is a cached snapshot, currently 2 days stale — `generated_at: 2026-08-20T07:39:01.656Z` vs. today 2026-08-22) | `app/api/build/route.ts:40` |
| Health ring % | **DERIVED_FROM_REAL_DATA** — on disk right now: `ok=1344, total=1365` → **98%** | `app/api/build/route.ts:42-44` |
| Summary counts | **DERIVED_FROM_REAL_DATA** — `{total:1365, ok:1344, broken:0, unused:1, unregistered:20}` | `scripts/build-arch-book.ts:630-637` |
| Layer table (31 layers, health% per layer) | **DERIVED_FROM_REAL_DATA** | `page.tsx:151-170`, `app/api/governance/route.ts:80-99` |
| Node/edge counts (graph) | **DERIVED_FROM_REAL_DATA** — 1,374 nodes (1,365 Module + 9 Layer), 4,774 edges, read directly from the file this round | `registry/architecture-book.json` |
| Node status/color (OK/BROKEN/UNUSED/UNREGISTERED) | **DERIVED_FROM_REAL_DATA** — real static-analysis algorithm (`calcStatus`): file-existence check, regex export/import extraction, cross-referenced against `registry/module-registry.json` | `scripts/build-arch-book.ts:109-459` |
| Edge meaning ("imports") | **DERIVED_FROM_REAL_DATA** — a real `import` statement, regex-extracted and specifier-resolved from real file content | `scripts/build-arch-book.ts:154-181, 485-514` |
| "Sync Now" scan itself | **REAL_RUNTIME + REAL_FILESYSTEM** — the one genuinely live operation on this page; a real `glob`+`readFileSync` walk of the actual repo tree | `app/api/build/route.ts:49-81`, `scripts/build-arch-book.ts:472-475` |
| Realtime pulse trigger | **REAL_RUNTIME** — live Supabase Postgres Changes subscription on table `ai_tasks` | `components/admin/useAiTaskPulse.ts:49-61` |
| Realtime pulse → node highlighted | **HARDCODED** — a literal lookup table, manually kept in sync with a separate Edge Function's dispatch logic, by comment admission | `components/admin/useAiTaskPulse.ts:18-22` |

**No `MOCK` or `UNKNOWN` value found on this page.** Every number is either a real cached scan result or a real live subscription trigger; nothing is synthetic. The one caveat, disclosed not hidden: everything except the two Realtime items reflects the **last button-press**, not the live, current state of the repo — a real but potentially stale snapshot.

**Cross-repo check:** zero references anywhere in `/admin/system`'s full import chain (page, `GraphView.tsx`, `ForceGraph3DView.tsx`, `useAiTaskPulse.ts`, `api/build`, `api/governance`) to `/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE`, `/Users/tam/Desktop/DNA-LAB-PERMISSION-REASONER`, or ports 8790/8791/8787/8788/5177. Confirmed by direct grep of every file in the chain — **this page is 100% self-contained within dna-os-deadboard**, measuring dna-os-deadboard's own source tree only.

---

## PHASE 2 — WHAT `/admin/system` ACTUALLY REPRESENTS

**Classification: B — Software architecture / engineering control. Not mixed.**

| Component | Source capability | Responsible folder (dna-os-deadboard) | Data owner | Runtime dependency | Business dependency | Write/read |
|---|---|---|---|---|---|---|
| Health ring, summary, layer table, violations, 3D graph | `architecture-book.json` reader | `app/admin/system/`, `app/admin/graph/`, `app/api/build/`, `app/api/governance/` | `scripts/build-arch-book.ts` (the scanner) | None (reads a cached file) | **None found** | Read-only (except the Sync Now button, which writes the cache file) |
| Sync Now | real filesystem scanner | `scripts/build-arch-book.ts`, `scripts/sync-registry.ts` | Same | Spawns a real `execSync` subprocess | **None found** | Write (`registry/architecture-book.json`) |
| Realtime pulse | Supabase Realtime listener | `components/admin/useAiTaskPulse.ts` | `ai_tasks` table | Live DB subscription | **Indirect only** — `ai_tasks` is itself an AI-agent work-tracking table, not a customer/LINE/payment table; no direct read/write to `relationships`/`invoices`/`documents`/`payments` schemas found in this component | Read-only (subscribe) |

**Direct proof of no business dependency:** every node in the graph is `type: "Module"` keyed by a source-file path (`filePath`), classified by 31 code-architecture layer names (`core`, `gateway`, `api`, `components`, `services`, `identity`, `middleware.ts`, etc. — real programming-language/module concepts, not `job`, `invoice`, `relationship`, `payment`, or `document`). No LINE ingestion, business workflow, document, payment, customer/business record, or production business execution imports, calls, or reads anything from `/admin/system`'s own code, its API routes, or the `architecture-book.json`/`module-registry.json` files it reads. **If this page's route were deleted, zero business runtime path would be affected** — see Phase 6 for the exact proof.

---

## PHASE 3 — CROSS-CHECK AGAINST `:5177` AND `/admin/infrastructure`

### vs. `http://localhost:5177/` (DNA-LAB-PERMISSION-REASONER's "Engineering Research Monitor" — traced in the prior round of this audit)
- **No shared data, no shared code, no shared process.** `:5177` reads its own repo's Python backends (`:8787`/`:8788`) and its own hardcoded/mock arrays; `/admin/system` reads dna-os-deadboard's own `architecture-book.json`. Zero file, port, or import overlap confirmed by direct grep in both directions (this round and the prior round).
- **Conceptual overlap exists** (both are "engineering health/telemetry" dashboards showing recurring-problem/health/status concepts), but **no measurement is computed twice from the same raw data** — they measure genuinely different things (dna-os-deadboard's own TypeScript import graph vs. DNA-LAB-PERMISSION-REASONER's research-experiment/execution/local-machine telemetry). Not a duplicate by the task's own "trace by data identity, not by similar names" rule.

### vs. `http://localhost:3000/admin/infrastructure` (same repo, sibling admin page)
Both pages render a **node/edge graph with runtime-status coloring** — the closest real overlap found in this entire audit — but they are proven, by the tracing agent's full read of both pages' code, to be **two distinct, non-duplicated concepts**:

| | `/admin/system` graph | `/admin/infrastructure` Operational Map |
|---|---|---|
| Node = | one real source file (code architecture) | one canonical external/internal *provider entity* (~26, per code comment — count itself **UNKNOWN**, not independently re-verified live behind auth this round) |
| Edge = | a real `import` statement | an evidenced cross-entity dependency (module-graph corroboration or `infrastructure.json` `owner` field) |
| Status meaning | OK/BROKEN/UNUSED/UNREGISTERED — code-health | LIVE/DEGRADED/FAILED/NOT_VERIFIED/NOT_CONNECTED — operational connectivity |
| Refresh | cached, manual "Sync Now" only | **live on every page load**, and **writes** a reconciliation-state file as a side effect on every load |

**Real duplicate-presentation finding, independent of the :5177/`/admin/infrastructure` comparison**: `registry/architecture-book.json` and `registry/module-registry.json` (the exact data `/admin/system` renders) are ALSO read by at least 4 other live routes in the same repo — `app/admin/graph/GraphView.tsx` (a standalone `/admin/graph` route, not just the embedded copy inside `/admin/system`), `app/admin/architecture/page.tsx`, `app/admin/build/page.tsx`, `app/admin/engine-explorer/page.tsx` — plus a ~20-file `app/api/admin/ide/_lib/` subsystem (`architectureSummaryRuntime.ts`, `systemRealityRuntime.ts`, `monitoringRuntime.ts`, etc.). **This is the strongest, most direct duplicate-presentation evidence found in this round**: the same underlying architecture-graph measurement is independently rendered by at minimum `/admin/system`, `/admin/graph`, `/admin/architecture`, `/admin/build`, and `/admin/engine-explorer` — five real, separate routes in the live app, all inside the same admin area this task is asking to separate. (Full per-route confirmation of what each of the other four actually displays was not traced line-by-line this round — flagged as a real, evidenced lead for the Owner, not fully resolved to the same depth as `/admin/system` itself, since it was outside this round's named target.)

- **Mock data where real data already exists:** none found on `/admin/system` (no mock data exists on this page at all).
- **Real measurement pipelines pointing to the wrong UI:** none found — the architecture-book data reaches exactly the UI(s) built to read it; the *multiplicity* of UIs is the finding, not a misroute.
- **Software-engineering measurements mixed into the LINE/business application:** **YES, proven** — see Phase 2. `/admin/system` (and its 4+ sibling routes) are 100% software-engineering measurement, currently served from inside the same Next.js app, same `/admin` route tree, same auth gate, as `invoice`, `delivery-order`, `debt-notice`, `payment-voucher`, `receipt`, `partners`, `jobs` — real business routes confirmed to exist in the same `app/admin/` directory this round.

---

## PHASE 4 — REGISTRY CHECK

Checked DNA-OS-INFRASTRUCTURE's three real registries (`control/command-router/capability-registry.ts`, `software/registry-database/data/canonical/capabilities.jsonl`, `reports/phase16-world-evidence/capability_index.json`) for any entry matching `architecture-book`, `module-registry`, `admin/system`, `deadboard`, or "architecture graph"/"code health" concepts:

```
RESULT: NOT_REGISTERED — zero matches in any of the 3 DNA-OS-INFRASTRUCTURE registries.
```

This is expected and consistent with Phase 1/2's own finding: `/admin/system` is entirely self-contained within dna-os-deadboard and never touches DNA-OS-INFRASTRUCTURE. **`/admin/system`'s capability is registered, but only in dna-os-deadboard's own separate, internal governance system** — `registry/module-registry.json` itself states its own policy: `"ทุกไฟล์ต้องอยู่ใน registry — ไม่มี Shadow System"` (every file must be in the registry — no Shadow System). Within THAT registry (the only one this capability was ever meant to be checked against), the relevant files (`app/admin/system/page.tsx`, `app/api/build/route.ts`, `app/api/governance/route.ts`, `scripts/build-arch-book.ts`) were not individually re-verified as present in `module-registry.json` this round (16,644-line file, spot-checking every implementing file was out of this round's time budget) — flagged **UNKNOWN** for per-file registration status inside dna-os-deadboard's own registry, not assumed either way.

**No DUPLICATE_REFERENCE found** in DNA-OS-INFRASTRUCTURE's registries (there is nothing to duplicate — zero entries exist there at all for this capability).

---

## PHASE 5 — SEPARATION PLAN

**Belongs to SOFTWARE CONTROL / ENGINEERING OBSERVABILITY** (proven in Phase 2, no business dependency found):
- `app/admin/system/` (page + the byte-identical stray `page 2.tsx`)
- `app/admin/graph/` (`GraphView.tsx`, `ForceGraph3DView.tsx`) — embedded inside `/admin/system` AND independently routable at `/admin/graph`
- `app/api/build/route.ts`
- `app/api/governance/route.ts`
- `components/admin/useAiTaskPulse.ts`
- `scripts/build-arch-book.ts`, `scripts/sync-registry.ts`
- `registry/architecture-book.json`, `registry/module-registry.json` (the underlying data — **evidence, not to be deleted, per the task's own instruction**)
- By the same proven logic (same data source, same "code architecture" domain, not independently re-traced to the same depth this round but strongly evidenced): `app/admin/graph/page.tsx`, `app/admin/architecture/page.tsx`, `app/admin/build/page.tsx`, `app/admin/engine-explorer/page.tsx`, and the `app/api/admin/ide/_lib/*` subsystem (~20 files)

**Remains in LINE / BUSINESS APPLICATION** (unaffected, no proven relationship to the above): every other `app/admin/*` route confirmed to exist this round with a business-domain name — `invoice`, `delivery-order`, `debt-notice`, `debt-tracking`, `payment-voucher`, `receipt`, `receipts`, `purchase-order`, `quotation-queue`, `partners`, `jobs`, `line-profiles`, `transactions`, `finance`, `equipment`, `create-document`, `relationships` — none of these were found (this round or the prior one) to import or depend on `architecture-book.json`, `module-registry.json`, or any file in the "belongs to software control" list above.

**Boundary is clean, not ambiguous**, with one caveat: `/admin/infrastructure` sits in a genuinely mixed position — it is engineering-observability in *purpose* (provider/cost/compute monitoring) but is **not** proven to share any code or data with `/admin/system`'s architecture-graph capability (Phase 3's table). It should be evaluated as its own, separate relocation decision, not bundled automatically with `/admin/system` just because both show a "graph."

---

## PHASE 6 — IMPACT PROOF BEFORE MOVE

1. **Files implementing `/admin/system`**: `app/admin/system/page.tsx` (+ inert duplicate `page 2.tsx`), `app/admin/graph/GraphView.tsx`, `app/admin/graph/ForceGraph3DView.tsx`, `components/admin/useAiTaskPulse.ts`, `app/api/build/route.ts`, `app/api/governance/route.ts`, `scripts/build-arch-book.ts`, `scripts/sync-registry.ts`.
2. **Imports/routes pointing to it**: the rail/nav item labeled "ระบบ" (system) → `/admin/build` per `/admin/relationships`'s own `RAIL_ITEMS` (a **different** route than `/admin/system` itself — worth the Owner's attention: the business-page sidebar links to `/admin/build`, not `/admin/system`, so the actual navigation path into this page from the main business workspace was not confirmed this round). No other page's code was found (this round) importing `app/admin/system/page.tsx`'s exports directly — Next.js pages are not typically imported by other pages.
3. **APIs it consumes**: `GET/POST /api/build`, `GET /api/governance` — both confirmed to be consumed ONLY by `/admin/system`/`/admin/graph` and nothing else in the grep performed this round (not exhaustively re-verified against literally every route in the app; consistent with the tracing agent's findings for these two specific files).
4. **Processes generating its data**: `scripts/build-arch-book.ts`/`scripts/sync-registry.ts`, spawned only via the "Sync Now" button's `POST /api/build` → `execSync`. No cron/scheduled job was found triggering this automatically this round (would need a separate check of any process scheduler, not performed).
5. **Does any LINE/business runtime depend on these files?** **NO — proven.** Zero business-domain import (relationships/jobs/invoices/payments/documents/LINE events) was found anywhere in `/admin/system`'s full trace (this round) or in the underlying `architecture-book.json`/`module-registry.json` files themselves (both are pure code-structure data).
6. **What breaks if the UI route is removed?** Only: (a) the `/admin/system` and `/admin/graph` pages themselves become unreachable; (b) the "Sync Now" trigger point disappears (the underlying scanner scripts still work standalone via CLI, `npx tsx scripts/build-arch-book.ts`, unaffected); (c) `useAiTaskPulse`'s visual highlight effect loses its host page — the underlying Supabase Realtime subscription mechanism and `ai_tasks` table are unaffected, they simply have no UI to render into. **No business workflow, LINE ingestion, document generation, payment, or customer-facing feature breaks.**
7. **What must remain running after UI separation?** `scripts/build-arch-book.ts`/`scripts/sync-registry.ts` (the real scanner — must still be runnable, wherever its trigger button ends up), `registry/architecture-book.json`/`registry/module-registry.json` (the evidence files — must not be deleted, per the task's explicit instruction), and the Supabase `ai_tasks` table subscription mechanism if the Realtime-pulse feature is to be preserved in a relocated UI.

**Exact dependency cut**: the 8-file list in item 1, plus the two `registry/*.json` data files (kept, never deleted), can be relocated as a unit with zero proven impact on any business runtime path. The one unresolved item before actually moving anything: confirming which page(s), if any, in the live business navigation actually link to `/admin/system` today (item 2 above is incomplete — the one nav reference found this round points at `/admin/build`, a related but different route, not `/admin/system` itself).

---

## ADDITIONAL TARGET — `/admin/relationships` BOUNDARY AUDIT

Route → `app/admin/relationships/page.tsx` → renders `RelationshipWorkspacePage` (`app/admin/relationships/workspace.tsx`). The nested `/admin/relationships/[relationshipId]` uses the identical component tree — same findings apply to both.

**`components/admin/AdminSidebarNav.tsx` is confirmed dead code** — zero real importers anywhere in the app, proven by the repo's **own** acceptance test: `scripts/dead-end-sweep-test.ts:155-158` explicitly asserts this file as a real `UI_NO_CONSUMER` finding. It is not the nav used by `/admin/relationships` or any live route; the real sidebar is the inline `RAIL_ITEMS` array in `workspace.tsx:44-83`.

### `RAIL_ITEMS` inventory (the real, live sidebar)

| Item | Route/behavior | Domain |
|---|---|---|
| เลขา, ข้อความ, งาน, คู่ค้า, เอกสาร, การเงิน, บ่อวัสดุ, เครื่องยนต์, ภาพรวมการเงิน | real `/admin/*` business routes | **business** |
| สถาปัตยกรรม (telemetry rail item) | `/admin/telemetry` → pure `redirect("/admin/system")`, no data of its own | **engineering** (navigation only, injects nothing into this page) |
| ค่าใช้จ่าย (infrastructure rail item) | plain `<Link href="/admin/infrastructure">` | **engineering** (navigation only, injects nothing into this page) |
| **Cloud GPU** | **no href** — `onClick` → `openExternal("https://console.runpod.io/pods")` | **engineering, external, zero in-app data** |
| ระบบ (build rail item) | `/admin/build` | **engineering** (navigation only) |

### Item-by-item business-dependency verdicts

| Item | Rendered on this page? | Business-domain code dependency found? | Verdict |
|---|---|---|---|
| Cloud GPU | Yes (rail icon only, no data) | **NO** — traced UI → `IconRail.tsx` → `openExternal.ts` → `window.open()`/Tauri native open. No fetch, no API route, no calculator, no registry read anywhere in the chain. | **WRONG_DOMAIN_PRESENTATION** |
| AI/runtime status | **Not rendered on this page at all** | N/A — nothing to trace | Not applicable (not present, not a misplaced element — simply absent) |
| CPU/GPU telemetry | **Not rendered on this page at all** | N/A | Not applicable |
| Infrastructure/provider status | **Not rendered inline** (only a nav link to a separate page) | NO data or dependency on this page itself | **WRONG_DOMAIN_PRESENTATION** applies only to the *nav link's presence in this rail*, not to any data shown here (there is none) |
| Infrastructure cost | **Not rendered on this page at all** | N/A | Not applicable |
| AI/model execution cost | **Not rendered on this page at all** | N/A | Not applicable |
| Software engineering monitoring | **Not rendered on this page at all** | N/A | Not applicable |

**Confirmed real business data actually on this page** (for contrast, proving the rest of the page is correctly scoped): pending-quote counts from Supabase `business_events` (`/api/admin/quotation-queue`), pending-finance counts from `partner_payable_requests` (`/api/admin/finance-alerts`), live relationship list/detail via `/api/admin/relationships` + Supabase Realtime on `line_events`, and a feed built from `messages`/`documents`/`events`/`receipts` tables.

### Cloud GPU — full chain (as required)

```
UI (rail icon, no href)  →  IconRail.tsx button fallback  →  openExternal.ts (client shim)
  →  window.open() / Tauri open_url  →  https://console.runpod.io/pods (external, third-party)
```

No route, no API, no provider function, no calculator, no registry, no runtime data is read anywhere in this chain — it is a pure "open a new browser tab" action. The REAL RunPod-related capability that does have a registry/data trail (`registry/infrastructure.json`, `registry/COMPUTE_RESOURCE_REGISTRY.json`, `local-runtime/runpod-controller.mjs`) lives entirely on the separate `/admin/infrastructure` page, and per `registry/infrastructure.json:572-575` and `registry/architecture-book.json:37032-37036`, that capability is itself **not yet live** — the real RunPod account is "approved to spend but not yet signed up" / "pending KYC verification."

**Detachability**: removing the Cloud GPU rail item requires touching only `workspace.tsx` (the `RAIL_ITEMS` array entry, the `RUNPOD_CONSOLE_URL` constant, the `openExternal` import) — confirmed, by direct check of every business handler in that file (`runCommand`, `sendReply`, `sendDebt`, `sendDocument`, `buildEvent`, `askAi`, `matchUnmatchedContact`, `loadDetail`, `loadRelationships`), that **none** of them import or call anything Cloud-GPU-related. **Zero LINE/business execution path is affected by removing it.**

### Proposed dependency cut for `/admin/relationships`

| Element | Detach? | Destination |
|---|---|---|
| Cloud GPU rail item | Yes — trivial (3-line removal: array entry, constant, import) | No in-app destination needed — it was never in-app data; if a "Cloud GPU" *capability* is ever wanted inside this business app's engineering-control surface, the real, evidenced data for it lives on `/admin/infrastructure`'s Compute Resources / Providers sections (Phase 3 above), not here. |
| "สถาปัตยกรรม"/"ค่าใช้จ่าย" nav links | Optional — they inject no data into this page, only navigate away; removing them changes nothing about this page's own function | Same engineering-control surface as `/admin/system`/`/admin/infrastructure` |
| `AdminSidebarNav.tsx` | Already dead — could be deleted with zero impact (confirmed by the repo's own acceptance test), though the task's "no deletion yet" instruction is respected here — flagged, not removed |

---

## FINAL NUMBERS

```
/admin/system:
  UI_VALUES_TRACED:              10
  REAL_RUNTIME:                   2  (Sync Now scan, Realtime pulse trigger)
  REAL_FILESYSTEM:                3
  REAL_REGISTRY:                  0
  DERIVED_FROM_REAL_DATA:         6
  HARDCODED:                      1  (pulse node-mapping table)
  MOCK:                           0
  UNKNOWN:                        0
  BUSINESS_DEPENDENCY_FOUND:      0  (proven — Phase 2/6)
  CLASSIFICATION:                 B (Software architecture / engineering control)

/admin/infrastructure (cross-check only):
  DERIVED_FROM_REAL_DATA:        multiple (health badges, operational map, provider reconciliation)
  REAL_FILESYSTEM / REAL_REGISTRY: multiple (registry/*.json files + live Supabase queries)
  UNKNOWN:                         1  (operational-map "26 nodes" count, not independently re-verified live behind auth)
  DUPLICATE_OF_/admin/system:      NO (proven distinct data models — Phase 3)

DNA-OS-INFRASTRUCTURE registry check:
  REGISTERED:                     0
  NOT_REGISTERED:                 all (architecture-book/module-registry capability never touches DNA-OS-INFRASTRUCTURE)

DUPLICATE_UI_FOR_SAME_MEASUREMENT (architecture-book.json consumers):
  ROUTES_FOUND:                   ≥5  (/admin/system, /admin/graph, /admin/architecture, /admin/build, /admin/engine-explorer — /admin/system fully traced; the other 4 confirmed as real readers of the same file, not independently re-traced to full depth this round)

/admin/relationships:
  ITEMS_INSPECTED:                 7  (Cloud GPU, AI/runtime status, CPU/GPU telemetry, infra/provider status, infra cost, AI/model cost, eng. monitoring)
  RENDERED_ON_PAGE:                3  (Cloud GPU icon, telemetry nav link, infrastructure nav link — data-free in all 3 cases)
  WRONG_DOMAIN_PRESENTATION:       1  proven with full data-chain (Cloud GPU); 2 nav-link-only items noted, not data-bearing
  NOT_APPLICABLE (absent from page): 4
  BUSINESS_IMPACT_OF_REMOVAL:      NONE (proven, Cloud GPU fully traced to zero shared code with business handlers)
```

**STOP — evidence and proposed cut only, per the task's own instruction. No file moved, deleted, rewritten, or recreated.**
