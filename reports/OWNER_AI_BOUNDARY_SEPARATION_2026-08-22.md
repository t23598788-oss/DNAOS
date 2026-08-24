# Owner AI Boundary Separation — เลขาส่วนตัว/AI extraction from Business Application

**2026-08-22 — combines with, does not replace:** `ADMIN_RELATIONSHIPS_FULL_TRACE_2026-08-22.md`, `ADMIN_SYSTEM_RELATIONSHIPS_SEPARATION_AUDIT_2026-08-22.md`, `ARCHITECTURE_UI_CANONICALIZATION_GATE_2026-08-22.md`. This report is the implementation that follows those audits' findings, not a new standalone audit.

**Scope executed (owner-approved, larger of two offered options):** UI/System boundary separation of the Owner AI ("เลขาส่วนตัว") away from the Business Application, **plus** staged externalization of business logic bound into `cognitive/pipeline.ts`. Repo: `dna-os-deadboard`.

## Before → after, proven by source trace

`/admin/dashboard` (`components/admin/SecretaryChat.tsx`) and `/admin/relationships` both called the same real AI stack — `POST /api/chat` → `cognitive/pipeline.ts`'s `runCognitivePipeline()` → `services/ai/gateway.ts`'s `invokeAiGateway()` → Ollama/Anthropic. One real stack, not a duplicate — confirmed by direct trace before any code was touched. The AI was embedded as a page inside the Business admin shell (`app/admin/*`), not above it.

## Work done

### Part 1 — UI/System boundary move
- `app/owner/SecretaryChatSection.tsx` (new): `SecretaryChat` + its `openingText`/pulse-fetch logic, moved verbatim from `app/admin/dashboard/page.tsx`.
- `app/owner/OwnerConsole.tsx`: now renders two separate, clearly labeled command surfaces — "เลขาส่วนตัว / AI" (`SecretaryChatSection`) and "สั่งงานระบบ" (`OwnerCommandSection`, the existing DNA-OS-INFRASTRUCTURE bridge) — never merged into one input.
- `app/admin/dashboard/page.tsx`: now a bare `redirect("/")`, mirroring the repo's own existing `/admin/graph → redirect("/admin/system")` precedent.
- `app/admin/relationships/workspace.tsx`: `RAIL_ITEMS[0]` ("เลขา") href changed from `/admin/dashboard` to `/`.
- Stale-reference sweep and fix: `cognitive/pipeline.ts`'s `NAV_KEYWORDS` (`ผู้ช่วย|เลขา` → `/`), `core/navigation/resolveNavItems.ts`'s Admin workspace href (was `/admin/dashboard`, now points directly at the real Admin home `/admin/relationships` to avoid a redirect hop), `public/manifest.json`'s PWA `start_url` (`/admin/dashboard` → `/`), `registry/portals.json`'s docs entry.

### Part 2 — Business logic externalized from `cognitive/pipeline.ts` (staged A–D)
New file `registry/business-intent-catalog.ts` — mirrors `registry/command-registry.json`'s externalization convention (kept as `.ts`, not `.json`, because `WORKFLOWS`/`NAV_KEYWORDS` contain live `RegExp`/function values that hand-transcription to JSON would risk silently altering — a real, disclosed deviation from the original plan wording, made to protect correctness).

| Stage | Moved | Threading |
|---|---|---|
| A | `INTENT_CATALOG`, `WORKFLOWS`, `NAV_KEYWORDS`, `NAV_VERB_PATTERN` | `WORKFLOWS` is now an explicit parameter of `runCognitivePipeline()`/`runCognitiveCore()`, replacing the module-level reference at the `plan()` call site |
| B | `BUSINESS_PERSONA_LINE`, `IDENTITY_RULES`, `NO_UNGROUNDED_FACTS_RULE`, `OWNER_IDENTITY_RULE`, `APP_LAUNCH_CAPABILITY_RULE` | `answerWithAi()` takes `personaLine` as a parameter |
| C | Direct imports of `engines/weather`, `engines/fuel-live`, `engines/bot-exchange-rate` (the one real dispatcher-seam violation in the file — everything else already went through `engines/validation/dispatcher.ts`) | `answerExternalFact()` takes an `ExternalFactProviders` object as a parameter |
| D | `operatingIntent()`'s dependency on `INTENT_CATALOG`/`WORKFLOW_INTENTS`/`TRANSPORT_INTENTS` | `operatingIntent()` takes a `BusinessIntentCatalog` bundle as a parameter |

Every stage default-parameterizes to the same real catalog every current caller already used — zero caller needs to change, and the generic orchestration shell (intent → plan → execute → reflect → board) now receives business data instead of hardcoding it.

## Verification performed (real, live — not code-review-only)

- **Baseline-diff methodology**: captured real `runCognitivePipeline()` outputs (direct function import via `npx tsx`, matching `/api/chat`'s real call shape) for a representative message set before/after each stage, using `git stash`/temporary local reverts to isolate each stage's change in turn. **Every stage (Part 1, A, B, C, D) diffed byte-identical against its pre-stage baseline** — 9 messages for Part 1/A/B, expanded to 12 for Stage C (explicitly exercising the changed fuel/weather/exchange-rate calls), expanded to 18 for Stage D (exercising `operatingIntent()` across nearly every intent category, including the named-customer regex path).
- Stage B's change was additionally proven structurally unreachable in every real caller today (all 3 real callers of `runCognitivePipeline` never pass `gatewayContext` — confirmed by direct grep — so `answerWithAi()` always returns via its `!gatewayContext` early-return guard, before the changed `personaLine` interpolation ever executes).
- `npx tsc --noEmit` clean (zero errors) after every individual stage and after the full combined change.
- `npx next build` — full production build, exit clean, `/admin/dashboard` present as a dynamic redirect route, zero new build errors.
- Live `curl` against the running dev server: `/admin/dashboard` → 307 to `/login?next=%2Fadmin%2Fdashboard` (auth gate fires before the page body, identical behavior to the existing `/admin/graph` precedent — confirmed side-by-side).
- Cross-boundary check: `127.0.0.1:8791` (DNA-OS-INFRASTRUCTURE's `owner-command-http`, PID 9611) and the dna-os-deadboard dev server (PID 4066) both confirmed still live; `app/api/infra-command/route.ts` confirmed untouched by this work (last-modified timestamp predates this session).
- Temporary verification scripts (`scripts/__baseline_*`) deleted after each verification pass — none left in the repo.

## Required report fields

- **AI_CURRENT_IDENTITY**: One real AI — `cognitive/pipeline.ts`'s `runCognitivePipeline()` → `services/ai/gateway.ts`'s `invokeAiGateway()` (Ollama for conversation/intent-classification, Anthropic for OCR/document-extraction only). No second AI exists or was created.
- **OLD_BUSINESS_REFERENCES_REMOVED**: `app/admin/dashboard/page.tsx` (now a redirect), `RAIL_ITEMS` href, `cognitive/pipeline.ts`'s own `NAV_KEYWORDS` self-reference, `core/navigation/resolveNavItems.ts`, `public/manifest.json`, `registry/portals.json`, `registry/module-registry.json` entries for both files.
- **OWNER_AI_CANONICAL_IDENTITY**: `app/owner/SecretaryChatSection.tsx` (client wrapper) + `components/admin/SecretaryChat.tsx` (chat UI, unchanged), mounted from `app/owner/OwnerConsole.tsx`.
- **UI_SOURCE_LOCATION**: `app/owner/OwnerConsole.tsx`, `app/owner/SecretaryChatSection.tsx`, `components/admin/SecretaryChat.tsx`.
- **UI_ROUTE**: `/` (root — the pre-existing, separately auth-gated Owner Control Center; `middleware.ts`'s exact-match `PROTECTED_EXACT_PAGES` already covers it, unchanged).
- **RUNTIME_URL**: `http://localhost:3000/` (confirmed 307-gated to `/login` when unauthenticated, matching `/admin/*` gating behavior).
- **REUSED_AI_COMPONENTS**: `services/ai/gateway.ts` (untouched), `cognitive/pipeline.ts` (orchestration shell, refactored not rewritten), `components/admin/SecretaryChat.tsx` (untouched), the existing `live_commands` Supabase Realtime subscription (untouched, confirmed route-agnostic).
- **COMMAND_PATH**: Two, deliberately separate: (1) natural-language business/LINE chat — `SecretaryChat` → `/api/chat` → `runCognitivePipeline`; (2) structured infra command — `OwnerCommandSection` → `/api/infra-command` → `127.0.0.1:8791` → `owner-command` → `command-router` → dispatcher/Agent Gateway (DNA-OS-INFRASTRUCTURE, untouched by this work).
- **CONNECTED_SYSTEMS**: Business/Sales/LINE data layer (via `engines/validation/dispatcher.ts`'s registry-gated `dispatchCommand`, unchanged), DNA-OS-INFRASTRUCTURE (via the existing `/api/infra-command` bridge, unchanged).
- **REGISTRY_RECORD**: `registry/module-registry.json` updated in place — `app/owner/OwnerConsole.tsx` and `components/admin/SecretaryChat.tsx` entries corrected, `app/owner/SecretaryChatSection.tsx` and `registry/business-intent-catalog.ts` added, `app/admin/dashboard/page.tsx` entry updated to describe the redirect. No new DNA-OS-INFRASTRUCTURE registry entry created — the existing `consumer-registry.ts` `dna-os-deadboard` record and the live `owner-command-http` bridge already constitute sufficient registration (confirmed no correct shape exists in `connections/connection-registry/` for a peer-system caller — reported as a non-gap).
- **RELATIONSHIPS**: Owner Console (`/`) → Business/LINE data (via dispatcher seam) and → DNA-OS-INFRASTRUCTURE (via infra-command bridge) — Business/LINE is the destination system commanded/queried, never the AI's owner.
- **DUPLICATES_FOUND**: `app/OperationalWorkspace.tsx` (749 lines) — a prior, abandoned draft Owner-console attempt, confirmed still not mounted anywhere in the app's real render tree (`app/page.tsx` renders `OwnerConsole`, not this file). Pre-existing, not created by this work.
- **DUPLICATES_REMOVED**: None deleted — `app/OperationalWorkspace.tsx` is flagged as a finding, not silently removed (out of this round's authorized scope; a separate owner decision is needed before deleting dead code that isn't part of this task).
- **BUSINESS_BOUNDARY_STATUS**: Clean — Business/LINE (`/admin/*`) no longer hosts the AI as one of its own pages; `/admin/dashboard` only redirects. The Owner AI's orchestration shell (`cognitive/pipeline.ts`) no longer hardcodes business phrase catalogs, workflow definitions, persona/policy text, or external-fact providers — all four are now supplied as parameters, sourced from `registry/business-intent-catalog.ts`.
- **RUNTIME_VERIFICATION**: `npx next build` clean; live `curl` redirect-chain verification passed; both real backing processes (dev server, `owner-command-http`) confirmed live.
- **REGRESSION_RESULT**: Zero behavioral difference across all 4 pipeline stages, verified via real baseline-diff (not code-review-only) — see Verification section above.
- **BLOCKED_ITEMS**: None. `app/OperationalWorkspace.tsx`'s dead-code status is a disclosed finding requiring a separate owner decision (delete vs. keep as reference), not a blocker to this task's completion.
