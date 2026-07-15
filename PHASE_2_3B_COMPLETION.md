# Phase 2.3B — Registry Synchronization Cleanup — Completion Report

Registry-only cleanup. No business logic, runtime behavior, authentication, API behavior, UI, database schema, or workflow logic modified. Two governance tooling scripts (`scripts/build-arch-book.ts`, and separately `registry/module-registry.json` + `package.json`) were the only files touched, matching the phase's "generated registry artifacts" / "stale references" allowance.

## Starting state

`npm run guard` → Registry Sync: **9 BROKEN**, then (once BROKEN was cleared and the check could proceed further) **44 UNUSED**. Both are sub-checks of the same "Architecture health" gate in `scripts/pre-commit-check.sh`.

## Root causes found (not guessed — each traced to source before any fix)

1. **`scripts/build-arch-book.ts`'s source-file glob was `.ts`-only** (`"**/*.ts"`) — never scanned `.tsx` files as import *sources*, so real imports made by `.tsx` files (like `app/admin/create-document/page.tsx`) were invisible.
2. **Its target-resolution logic always appended `.ts`**, even when the real import target was a `.tsx` file (e.g. `@/components/documents/DocumentBuilder`) — every such edge silently resolved to a nonexistent path and never counted as a real import.
3. **Its directory-import (`/index`) fallback only tried `/index.ts`**, never `/index.tsx` (caught via `@/styles/tokens` resolving to `app/page.tsx`'s real, single-quoted import).
4. **`ENTRY_POINT_PATTERNS` was missing `middleware.ts`** (Next.js framework-auto-loaded, never explicitly imported) and its route-handler pattern only matched `app/api/.../route.ts`, missing valid non-`/api` routes like `app/observer.json/route.ts`.
5. Several individual `module-registry.json` entries had genuinely stale data (5 entries) or a straightforwardly deleted file (1 entry).
6. `package.json` had 5 CLI script paths still pointing at the pre-reorg `lib/runtime/*` location instead of the real current `core/runtime/*`.

## Classification of all findings

| Finding | Classification | Evidence |
|---|---|---|
| `engines/documents/draft-builders.ts` | **False positive** | Root cause #1 — real import confirmed via direct grep of the caller file |
| `gateway/index.ts` | **Stale registry** | `declared_callers` pointed at `app/api/action/route.ts`, confirmed non-existent; real functionality (`dispatchAction` etc.) is used elsewhere via direct import from `gateway/actions.ts` |
| `plugins/platform/mac/mac-platform.ts` | **Stale registry** | `declared_callers` pointed at `app/api/control-center/route.ts`, confirmed non-existent |
| `components/business/BusinessSidebarNav.tsx` | **Deleted module** | File confirmed absent from disk |
| `core/runtime/cockpit.ts` | **Stale registry** | Genuinely 0 exports (CLI script, invoked via `npx tsx`) — registry's "1 export" claim was wrong |
| 4× `supabase/functions/*/index.ts` | **Stale registry** | Deno `Deno.serve()` pattern, no `export` syntax at all — registry's "1 export" claim was wrong for each |
| `app/observer.json/route.ts`, `middleware.ts`, + ~40 `.tsx` components (DocumentBuilder, SecretaryChat, LogoutButton, all `ui-kit/*`, all `workspace/canvas/*`, etc.) | **False positive** | Root causes #2, #3, #4 — all genuinely imported/used, invisible to the checker before the fix |
| `core/runtime/dbd.ts` | **Stale registry** | Real CLI entry point per `package.json` (`npx tsx core/runtime/dbd.ts`), just not located under `scripts/` |
| `components/workspace/WorkspaceContext.tsx` | **Stale registry (deprecated)** | Verified via the file's own current header comment: "Not mounted into app/admin/layout.tsx or WorkspaceShell.tsx yet" |
| `supabase/functions/line-webhook-v2/helpers.ts`, `engines/impact/engine.ts`, `core/auth/index.ts`, `components/admin/AdminSidebarNav.tsx` | **Genuine orphan — NOT fixed** | Zero real importers anywhere, confirmed by grep. No current evidence justifies a `deprecated`/`entry_point` claim for these 4 — not applying one would mean asserting something unverified. Left as accurately-flagged UNUSED. |

## Regenerated / repaired

**`scripts/build-arch-book.ts`** (governance tooling, not application code):
- Source glob: `"**/*.ts"` → `"**/*.{ts,tsx}"`
- Target resolution: added `.tsx` fallback before the index-fallback path
- Index fallback: added `/index.tsx` alongside the existing `/index.ts`
- `ENTRY_POINT_PATTERNS`: added `middleware.ts`, broadened the route-handler pattern from `app/api/.../route.ts` to `app/.../route.ts`

**`registry/module-registry.json`** — 8 entries repaired:
- Removed: `components/business/BusinessSidebarNav.tsx` (confirmed deleted file)
- `gateway/index.ts`: `declared_callers` cleared, `deprecated: true` added
- `plugins/platform/mac/mac-platform.ts`: `declared_callers` cleared, `entry_point: true` added
- `core/runtime/cockpit.ts`: `exports` corrected to `[]`, `entry_point: true` added
- 4× `supabase/functions/*/index.ts`: `exports` corrected to `[]`, `entry_point: true` added each
- `core/runtime/dbd.ts`: `entry_point: true` added
- `components/workspace/WorkspaceContext.tsx`: `deprecated: true` added

**`package.json`** — 5 stale script paths corrected (`lib/runtime/*` → `core/runtime/*`): `diagnosis`, `existence-intelligence`, `cockpit`, `why`, `dbd`

**`registry/architecture-book.json`** — regenerated automatically by `npm run guard`'s sync step (generated artifact, not hand-edited)

## Final guard result

```
Type Check (tsc): PASSED
Registry Sync:
  Total: 445 modules
  OK: 377
  Broken: 0        (was 9)
  Unused: 4         (was 44)
  Unregistered: 64  (unrelated to this phase's scope — real files never registered, not a sync-consistency issue)

Guard exit: still non-zero (4 UNUSED remain)
```

`type-check` and `npm run build` both clean.

## Not resolved — needs an owner decision, not a guess

4 modules are genuine orphans (zero real importers, confirmed by direct grep, no evidence of intentional retirement):
- `supabase/functions/line-webhook-v2/helpers.ts`
- `engines/impact/engine.ts`
- `core/auth/index.ts`
- `components/admin/AdminSidebarNav.tsx`

Each needs one of: a real caller added, `entry_point: true` if it's meant to be invoked directly, `deprecated: true` if genuinely retired, or deletion if dead. I did not guess which applies — that's a decision only the file's owner can make honestly. Registry Sync cannot reach a clean pass without one of these four actions applied to each.

Stopping here per phase scope.
