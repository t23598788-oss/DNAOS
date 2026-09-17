# Rollback Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, UI, registry, database, or API was changed to produce this document.

## Objective

Define how to undo a bad production change quickly, at both the code and data layers, without improvising under pressure — and be honest about where this repo's current state falls short of that today.

## Architecture Principle

Rollback is a first-class operation planned before a deploy, not invented after an incident. This repo already has real tooling for the data layer (`scripts/backup.ts`, `npm run backup` / `npm run restore -- backups/DIR`, exporting every table to `backups/YYYY-MM-DD_HHmmss/` and restoring from it). Code-layer rollback rides on Vercel's deployment history plus git — and is only as good as what's actually been committed.

## Requirements

- Every production deploy corresponds to a real git commit — no deploying uncommitted work.
  - **This is currently violated.** `CURRENT_STATE.json`'s `working_tree_note` records hundreds of modified/untracked files that no AI session has committed, sitting on top of real prior history (`git log` shows real commits, e.g. `ec63bd1`). Until that's resolved, code-layer rollback can only reliably reach the last real commit, not "whatever was actually running."
  - Resolving this is explicitly `TASK-003` (Plan Lock gate 3: "clean repository, ready to deploy") — this policy treats a clean working tree as a *precondition* it can't consider met until that task closes, not something it can wave through.
- A `npm run backup` snapshot is taken before any schema-touching or bulk-data change.
- The previous Vercel deployment is the designated code-rollback target — confirmed not deleted/expired before starting a risky release, so "promote previous deployment" is actually available if needed.

## Validation Checklist

- [ ] `git status` is clean immediately before each deploy (currently fails — see Requirements)
- [ ] A dated `backups/` snapshot exists from immediately before any deploy that touches data
- [ ] The previous Vercel deployment is confirmed promotable (present in deployment history, not expired) before starting a risky release
- [ ] The rollback target (git commit + backup snapshot pair) is identified *before* the deploy starts, not searched for during an incident

## Failure Conditions

- A bad deploy ships and there is no clean commit to revert to — this repo's actual current state, per `working_tree_note`
- A data migration corrupts rows with no matching `backups/` snapshot taken beforehand
- The previous Vercel deployment has already expired/been pruned by the time a rollback is needed

## Recovery Procedure

1. **Code**: promote the prior Vercel deployment if available; otherwise `git revert` the offending commit(s) and redeploy.
2. **Data**: `npm run restore -- backups/<snapshot>` against the pre-change snapshot.
3. Both paths depend on the Requirements above having actually been followed — this policy is as much a pre-deploy checklist as an after-the-fact recipe, precisely because this repo's current uncommitted-work state shows what happens when the checklist isn't followed.
4. Record the rollback and its trigger in `registry/CHANGELOG.json`.
