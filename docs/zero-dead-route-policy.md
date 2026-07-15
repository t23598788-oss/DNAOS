# Zero Dead Route Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

No route exists in one source of truth (filesystem, `registry/portals.json`, `registry/module-registry.json`) without existing consistently in all of them.

## Architecture Principle

The filesystem (`app/**/page.tsx`), the nav registry (`portals.json`), and the module registry (`module-registry.json`) are three independent views of the same graph. This project already treats registry/filesystem drift as a real, recurring problem — the Phase 2 closeout found and removed "15 dead `module-registry.json` entries (files deleted, registry still said `active`)" and "13 files created this migration with no registry entry" (`TECHNICAL_DEBT.md`). That was a manual, one-time reconciliation pass. This policy proposes making that check continuous instead of a periodic closeout exercise, distinct from [`zero-broken-url-policy.md`](./zero-broken-url-policy.md), which is about the *external* URL working, not the *internal* bookkeeping being consistent.

## Requirements

- Every route classifies cleanly into one of:
  - **Orphaned** — real page on disk, not in `portals.json` nav. Usually harmless (`route-lifecycle.md`'s Draft state), not automatically a bug.
  - **Phantom** — registered in `portals.json` or `module-registry.json`, no real page behind it. Always a bug — this is what `/admin/line-customers` became after its deletion.
- A phantom route is never left in place silently; it's either fixed (page restored, if it should still exist) or the registry entry is removed.
- Removing a registry entry for a route that was reachable by real users still passes through [`route-lifecycle.md`](./route-lifecycle.md)'s owner-approval requirement for Published-route removal — deleting the stale pointer is not itself the governed action if the underlying route mattered.

## Validation Checklist

- [ ] Diff `find app -name page.tsx` output against every `href` in `registry/portals.json`
- [ ] Diff `registry/module-registry.json` entries against actual file existence on disk
- [ ] Classify every mismatch as Orphaned or Phantom before deciding an action
- [ ] Confirm no Phantom route currently exists uncatalogued (known one on record today: `/admin/line-customers` in `portals.json:220`)

## Failure Conditions

- Any Phantom route is found and left unaddressed
- A registry entry is removed for a route that turns out to still be externally referenced (violates [`backward-compatibility-rules.md`](./backward-compatibility-rules.md))

## Recovery Procedure

1. For a Phantom route: confirm via `route-lifecycle.md`'s "published" test whether it was ever externally reachable/linked.
2. If yes — restore the page or add a redirect (`redirect-policy.md`) before removing the registry entry.
3. If no (pure Draft/orphan cleanup) — remove the stale registry entry directly, Level 2, no extended process needed.
