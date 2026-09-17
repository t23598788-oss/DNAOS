# Route Lifecycle Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. No route was changed to produce this document.

## Why this needs a definition here specifically

This repo already has a real, recent case of both the failure mode this policy targets and the correct pattern for avoiding it:

- **Failure mode, real**: `app/admin/line-customers/page.tsx` was deleted during the 2026-07-13 Relationship-Centric Workspace migration (`registry/CHANGELOG.json`, `DNA-000021`) and relocated to `app/admin/relationships/`. The move itself was fine — but `registry/portals.json:220` (nav entry, label "ลูกค้า LINE") was never updated, so it still links to a route that 404s today. `TECHNICAL_DEBT.md` also separately records a dead `href === "/admin/line-customers"` check inside `components/admin/AdminSidebarNav.tsx` (itself unmounted dead code). Two independent stale references from one unredirected route deletion.
- **Correct pattern, already planned**: `PHASE3_BACKLOG.md` item 7 proposes exactly the shape this policy would require for `/admin/partners` → `/admin/relationships`: keep the old path alive as a redirect during a transition window, remove it only once "no external bookmark dependency remains." That item is currently unauthorized (blocked by the architecture freeze) — this document does not authorize it, it just cites it as the template for what "moved correctly" looks like.

## Route states

| State | Meaning | Who can reach it |
|---|---|---|
| **Draft** | Exists on disk, not linked from `registry/portals.json` or any nav component | Only by typing the exact URL |
| **Published** | Linked from `registry/portals.json` nav, or has a real external dependency (LINE LIFF, webhook callback, partner-shared bookmark) | Real users, external systems |
| **Deprecated** | Still resolves, but a `route-lifecycle` record marks it superseded and names the replacement | Existing bookmarks/links, discouraged for new links |
| **Redirected** | Old path issues a permanent redirect to the new path | Anyone hitting the old URL, transparently |
| **Removed** | Path no longer resolves at all | Nobody — only reachable after Redirected state has run for a defined window with no remaining external dependency |

A route only reaches **Removed** by passing through **Deprecated → Redirected** first, per RULE_005/RULE_012 below. Deleting a **Published** route directly to nothing (what happened to `/admin/line-customers`) is exactly the failure this policy exists to prevent going forward.

## Proposed rules

- **RULE — Published route, never delete outright.** A Published route may move to Deprecated/Redirected, never straight to gone.
- **RULE — Rename is forbidden; a rename is a move.** Changing a Published route's path is modeled as: create new path → old path becomes a permanent redirect. There is no in-place rename that skips the redirect step.
- **RULE — Move = permanent redirect only**, not a temporary one, unless the move itself is explicitly marked experimental/reversible before it ships.
- **RULE — Navigation is generated from the route registry, not hand-maintained in parallel.** The `/admin/line-customers` incident happened because `registry/portals.json` is a hand-maintained list that drifted from what `app/admin/` actually contains. A route registry that both the nav and a validator read from the same source would have caught this at build time instead of leaving a live dead link. (This is a tooling proposal — see `deployment-contract.md`'s gap analysis; nothing currently reads `portals.json` against the filesystem.)
- **RULE — Route removal requires explicit owner approval**, tracked the same way `PHASE3_BACKLOG.md` item 7 already is: named, risk-rated, and waiting on an explicit authorization naming it directly — not bundled into an unrelated change.

## What "published" means concretely in this repo

A route counts as Published if any of:
1. It has an entry in `registry/portals.json`'s nav arrays (`docs[]`, `business[]`, etc.)
2. It's referenced by an external system's stored config — LINE Messaging API webhook URL, Supabase Edge Function callback, LIFF endpoint URL (`app/liff/add-friend/`)
3. It's been shared as a direct link to a partner/customer outside the codebase (not discoverable from the repo — requires the owner to say so)

Everything else (an orphaned `page.tsx` with no nav entry and no external reference) is Draft, and can be deleted under the normal Level 2 "safe refactor" tier — no special process needed.
