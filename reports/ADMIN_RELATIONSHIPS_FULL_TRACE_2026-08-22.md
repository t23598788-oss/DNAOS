# /admin/relationships — FULL SOURCE TRACE (continuation of this morning's audit)

**Mode: DISCOVERY ONLY.** Nothing edited, moved, created, or guessed. This round reuses the morning's audit (`ADMIN_SYSTEM_RELATIONSHIPS_SEPARATION_AUDIT_2026-08-22.md`) as a starting baseline and re-verifies every claim against the live source tree right now, plus traces one thread that morning's audit did not cover: the AI/Agent connection chain (`askAi` → cognitive pipeline → AI Gateway → real providers).

Repository: `/Users/tam/Desktop/dna-os-deadboard`. Route: `app/admin/relationships/page.tsx` → `RelationshipWorkspacePage` (`app/admin/relationships/workspace.tsx`).

---

## FULL CHAIN: UI → component → API → data source → registry → relationship → runtime/AI

```
app/admin/relationships/page.tsx
  → workspace.tsx (RAIL_ITEMS nav, business handlers, Cockpit panel, chat)
      → /api/admin/quotation-queue          → Supabase business_events            [BUSINESS]
      → /api/admin/finance-alerts           → Supabase partner_payable_requests   [BUSINESS]
      → /api/admin/relationships[/:id]      → Supabase relationships/contacts     [BUSINESS]
      → Supabase Realtime: line_events                                            [BUSINESS]
      → feed.ts                             → messages/documents/events/receipts  [BUSINESS]
      → /api/admin/line-customers/:id/ask   → engines/material-resolver +
                                                engines/quote-price (real pricing) [BUSINESS]
                                             → falls through to cognitive/pipeline.ts
      → /api/chat, /api/chat/confirm        → cognitive/pipeline.ts (runCognitivePipeline)
                                             → services/ai/gateway.ts (invokeAiGateway)
                                                 → Anthropic (claude-haiku-4-5, ONLY for
                                                   document.ocr/document.event_extract/
                                                   code.generate/data.analyze/text.generate)
                                                 → Ollama (localhost, model "thawatchai",
                                                   for conversation.answer/intent.classify/
                                                   screen.describe/document.crop/
                                                   memory.draft/material.resolve)
      → openExternal("https://console.runpod.io/pods")  [NOT BUSINESS — see WRONG_SYSTEM]
      → Link → /admin/telemetry → redirect → /admin/system  [NOT BUSINESS — see WRONG_SYSTEM]
      → Link → /admin/infrastructure                        [NOT BUSINESS — see WRONG_SYSTEM]
      → Link → /admin/build                                 [NOT BUSINESS — see WRONG_SYSTEM]
```

---

## CLASSIFIED FINDINGS

### KEEP — real DNA OS + LINE business system, confirmed this round

| # | Source path | Real destination | Evidence |
|---|---|---|---|
| 1 | `app/admin/relationships/workspace.tsx:181,255,271-296` | `GET/POST /api/admin/relationships[/:id]` → Supabase `relationships`/contacts tables, Realtime on `line_events` | Re-confirmed live this round |
| 2 | `workspace.tsx:139,193-208` | `GET /api/admin/quotation-queue` → Supabase `business_events` | `app/api/admin/quotation-queue/route.ts:1-20` |
| 3 | `workspace.tsx:143,210-221` | `GET /api/admin/finance-alerts` → Supabase `partner_payable_requests` | `app/api/admin/finance-alerts/route.ts:17-25` |
| 4 | `feed.ts` | `messages`/`documents`/`events`(business_events)/`receipts` tables | Re-confirmed structure this round |
| 5 | RAIL_ITEMS: `dashboard`,`relationships`,`jobs`,`partners`,`transactions`,`debt-tracking`,`pits`,`equipment`,`finance` | `/admin/dashboard`,`/admin/jobs`,`/admin/partners`,`/admin/transactions`,`/admin/debt-tracking`,`/admin/pits`,`/admin/equipment`,`/admin/finance` — all real business routes | `workspace.tsx:45-56` (fresh read this round — unchanged from this morning) |
| 6 | `workspace.tsx:576-618` `askAi()` | `POST /api/admin/line-customers/:id/ask` → `engines/material-resolver.ts` + `engines/quote-price.ts` (real material pricing engine, uses contact's real GPS from `line_events`) | `app/api/admin/line-customers/[lineUserId]/ask/route.ts:1-56` — deterministic, real Supabase `material_types` lookup before any AI call |
| 7 | `askAi`/`runCommand` fallthrough | `cognitive/pipeline.ts`'s business-intent handling (view customer, view debt, create document, workflow intents) | `cognitive/pipeline.ts:918-935` (`answerWithAi`), `operatingIntent()` — all business-domain intent classification |
| 8 | AI provider routing for business questions | `services/ai/gateway.ts`'s `CAPABILITY_PROVIDER["conversation.answer"] = "ollama"`, `"material.resolve"] = "ollama"` | `services/ai/gateway.ts:99-111` — confirmed genuinely business-purposed capability names |

### WRONG_SYSTEM — Control/Infrastructure/Software-Factory content reachable from this page

| # | Source path | Real destination | Evidence | Note |
|---|---|---|---|---|
| 1 | `workspace.tsx:81` `{key:"runpod", label:"Cloud GPU"}` | `openExternal("https://console.runpod.io/pods")` (`components/admin/openExternal.ts`) | Confirmed this morning, re-verified unchanged this round | Zero business data — pure external link |
| 2 | `workspace.tsx:65` `{key:"telemetry", label:"สถาปัตยกรรม"}` | `href="/admin/telemetry"` → `redirect("/admin/system")` (`app/admin/telemetry/page.tsx`) → the real architecture/dependency-graph control page (established in the two prior audit rounds) | `workspace.tsx:60-64` code comment confirms this is a **deliberate Owner placement** (2026-07-26 instruction), not an accident | Software-Factory content, explicitly Owner-requested on this rail |
| 3 | `workspace.tsx:72` `{key:"infrastructure", label:"ค่าใช้จ่าย"}` | `href="/admin/infrastructure"` — real provider/cost/compute control page (established in the two prior audit rounds) | `workspace.tsx:66-71` code comment: explicit 2026-08-03 Owner request | Infrastructure content, explicitly Owner-requested |
| 4 | `workspace.tsx:82` `{key:"build", label:"ระบบ"}` | `href="/admin/build"` — confirmed, in the immediately-prior audit round, to be a 100% presentation-duplicate of `/admin/system`'s architecture graph, with zero unique capability | Same rail, no dedicated comment found for this specific entry's placement rationale | Software-Factory content |
| 5 | `cognitive/pipeline.ts:754,763,590,612` | `pulse_node: "module:src-tauri/src/lib.rs"` — desktop-app-native window/app-launch control directives (`open_app`, `window_action`) | Real, part of the SHARED backend `askAi`/`runCommand` route through | **Not rendered by this page** — `workspace.tsx` never destructures/uses `pulse_node`, `open_app`, or `window_action` from the API response (confirmed by direct grep this round: zero matches in `workspace.tsx`). This is a shared-backend capability, not a direct page contamination. Flagged for completeness, not counted as an active leak into this page's own UI. |
| 6 | `cognitive/pipeline.ts:332,487` | References `registry/architecture.json`'s `"module:<path>"` node-id scheme (a real, separate, small hand-authored architecture-ontology file — confirmed to genuinely exist, not a stale/broken reference) | Same shared-backend caveat as #5 — this scheme is available to the AI backend `/admin/relationships` calls into, but this page's own UI never surfaces a `module:*` id anywhere | Same as #5 — backend-shared, not page-rendered |

### MISSING_CONNECTION

| # | What | Currently | Evidence |
|---|---|---|---|
| 1 | The business AI Gateway (`services/ai/gateway.ts`) has **zero connection** to DNA-OS-INFRASTRUCTURE's own AI/execution orchestration layer (`control/agent-gateway`, `control/command-router`, `permissions/execution-policy`) | Confirmed by direct grep this round: zero occurrences of `DNA-OS-INFRASTRUCTURE`, port `8790`/`8791`, `command-router`, or `agent-gateway` anywhere in `cognitive/pipeline.ts` or `services/ai/gateway.ts` | Direct grep, this round |
| 2 | Cloud Claude fallback path in the business AI is configured in code but **not actually reachable** | `services/ai/gateway.ts:143-144` — `anthropicProvider()` throws `AI_GATEWAY_ANTHROPIC_NOT_CONFIGURED` whenever `ANTHROPIC_API_KEY` is unset; `cognitive/pipeline.ts:779` 's own code comment confirms "ANTHROPIC_API_KEY was never actually set (confirmed: zero occurrences in .env.local)" | Self-documented in source |
| 3 | `services/ai/translator.ts` — an entity-extraction module — is **written but never wired into the pipeline anywhere** | `cognitive/pipeline.ts`'s own code comment (near the Entity-Enrichment section): "services/ai/translator.ts was written but never wired in (confirmed via grep: zero importers anywhere)" | Self-documented in source, re-confirmed this round |

### MISSING_REGISTRATION

| # | What | Currently | Evidence |
|---|---|---|---|
| 1 | `services/ai/gateway.ts` (the business AI Gateway) IS properly registered **within dna-os-deadboard's own governance system** | `registry/module-registry.json`, entry `"services/ai/gateway.ts"`, `status: "active"`, real purpose text describing all 8 capabilities and their provider routing | Confirmed this round, direct read |
| 2 | The SAME AI Gateway capability has **zero registration in any of DNA-OS-INFRASTRUCTURE's three registries** (`control/command-router/capability-registry.ts`, `software/registry-database`, `reports/phase16-world-evidence/capability_index.json`) — no entry for "dna-os-deadboard," "cognitive pipeline," "AI gateway," "Ollama," or "conversation.answer" anywhere | Confirmed by grep of all three DNA-OS-INFRASTRUCTURE registries this round: zero matches | Direct grep, this round |
| 3 | No real "connection" record exists in `connections/connection-registry/` (DNA-OS-INFRASTRUCTURE) for dna-os-deadboard's Ollama/Anthropic providers, even though DNA-OS-INFRASTRUCTURE's own `connections/` capability group is exactly the pattern that would hold such a record for an external service | No match found — this is the exact cross-repo counterpart to MISSING_CONNECTION #1 above; the two findings describe the same gap from opposite sides (dna-os-deadboard doesn't call out, DNA-OS-INFRASTRUCTURE has no record of it) | Direct grep, this round |

### BROKEN_REFERENCE

**None found for this page this round.** One candidate was checked and ruled out: `cognitive/pipeline.ts:332,487`'s comment cites `registry/architecture.json` — this file was verified to genuinely exist (49 lines, a real, separate, hand-authored layer-ontology document, distinct from the 115,281-line generated `architecture-book.json`) and is a real, correct reference, not stale. `AdminSidebarNav.tsx` (confirmed dead code in the prior audit round) is not imported by this page at all, so it does not constitute a broken reference reachable from `/admin/relationships` specifically.

---

## ANSWER TO "which AI/Agent/service should this connect to but currently lacks connection/registration"

Two distinct, evidence-based candidates, reported as findings, not proposals:

1. **DNA-OS-INFRASTRUCTURE's own `permissions/execution-policy`/`control/agent-gateway` layer** — this is DNA-OS-INFRASTRUCTURE's real, built, tested gate for "should this AI/agent action be allowed" — and it has zero visibility into or connection with dna-os-deadboard's real, live AI Gateway, which independently makes its own ALLOW/DENY-equivalent decisions (`assertSafeRequest`, `services/ai/gateway.ts:117-122`) with its own separate logic. Whether these SHOULD be connected is an architecture decision for the Owner — this report only establishes, with evidence, that they currently are not, and that both sides have a real, working permission-gate concept that could theoretically be unified.
2. **`services/ai/translator.ts`** — a real, already-written entity-extraction module, confirmed by the codebase's own comment to have zero importers anywhere. This is the one MISSING_CONNECTION that is entirely internal to dna-os-deadboard (no cross-repo question at all) and the most concrete, narrowly-scoped gap found this round.

No other specific AI/Agent/service was found, by code evidence, to have a proven "should connect but doesn't" relationship to this page — the business AI's own provider routing (Ollama for business capabilities, Anthropic reserved for OCR/document/code capabilities) is internally consistent and fully wired for every capability it declares.

---

## SUMMARY

```
KEEP:                 8 real business data/AI paths confirmed intact
WRONG_SYSTEM:         6 (4 direct nav items — 3 explicitly Owner-placed by their own code
                       comments, 1 unexplained; 2 shared-backend-only, not page-rendered)
MISSING_CONNECTION:   3 (DNA-OS-INFRASTRUCTURE orchestration layer unconnected;
                       Anthropic fallback unconfigured; translator.ts unwired)
MISSING_REGISTRATION: 3 (AI Gateway registered locally but absent from all 3
                       DNA-OS-INFRASTRUCTURE registries; no connection-registry record either)
BROKEN_REFERENCE:      0 (one candidate checked and ruled out — a real, existing file)
```

**STOP — discovery only. No file edited, moved, created, or guessed at.**
