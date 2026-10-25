# Production Governance — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** This document and its three companions (`domain-governance.md`, `route-lifecycle.md`, `deployment-contract.md`) are a policy draft, not adopted policy. Nothing here is enforced by any script, guard, or CI step today. No source code, route, schema, or config was changed to produce this set — verified by grep/inspection only.

## Why this exists

Requested as a pre-domain-connection exercise: define what "permanent public interface" should mean for this system before a custom domain is attached (see `domain-governance.md` — no domain is connected yet, so this is genuinely pre-facto, not describing something already live).

## Where this sits in the existing governance stack

Per `CLAUDE.md` / `registry/CONSTITUTION.json`, this system already has a layered governance model:

```
Constitution (registry/CONSTITUTION.json)   — supreme law, human-authored only
  → EXECUTION_CONTRACT.json                  — how to comply with the law
    → Runtime                                — enforces
      → Scheduler                            — assigns
        → Workers                            — execute
```

And a 5-level approval ladder for any proposed change:

| Level | Meaning | Who approves |
|---|---|---|
| 1 | Informational | Runtime logs, proceeds |
| 2 | Recommended (safe refactor) | Runtime auto-approves |
| 3 | High impact (e.g. API change) | Runtime does impact analysis, plan awaits review |
| 4 | Approval required (high risk) | Owner/CEO via dashboard |
| 5 | Forbidden | Runtime refuses outright |

**This proposal is a Level 4 change.** It declares routes, domains, and public APIs immutable and makes route removal/deploy failure conditional on owner-approval gates — that is exactly the class of change the existing ladder reserves for explicit human sign-off, not something a worker (AI or otherwise) adopts unilaterally by drafting it.

It also interacts with two things already on record:

- **Plan Lock** (`registry/TASK_QUEUE.json`, `CURRENT_STATE.json.plan_lock`): no new Module/Page/Feature until TASK-001 (SSO, `in_progress`), TASK-002 (real data, `pending`), TASK-003 (clean+deploy, `pending`) are all DONE. The *enforcement tooling* this policy implies (route-graph validator, navigation-drift checker, redirect validator — see `deployment-contract.md`) would be new tooling/feature work. Writing the policy text is not blocked by Plan Lock; **building the validators is**, until the gate tasks close.
- **Architecture freeze** (`CURRENT_STATE.json.architecture_freeze`, declared 2026-07-13): Phase 3 of the Relationship-Centric Workspace migration is blocked pending explicit owner authorization. `route-lifecycle.md` uses that migration's real routing decisions (the `/admin/line-customers` → `/admin/relationships` move) as worked examples — reading them for precedent does not touch frozen scope, but *acting* on `PHASE3_BACKLOG.md` item 7 (the planned `/admin/partners` → `/admin/relationships` redirect) still requires the same Phase 3 authorization it already required before this document existed.

## What adoption would actually require

1. Owner reviews and explicitly approves each of the three policy documents (they can be approved independently — domain policy, route lifecycle, and deployment contract are separable decisions).
2. Approved rules get transcribed into `registry/CONSTITUTION.json` (`iron_rules` or a new section) by a human edit, per the "Constitution is human-authored only" rule — an AI session should not write directly into that file on the strength of a chat instruction alone.
3. Enforcement tooling (the validators listed in `deployment-contract.md`) gets built as its own scoped, authorized task — subject to Plan Lock like any other new feature.

## Companion documents

**Foundational (written first)**
- [`domain-governance.md`](./domain-governance.md) — primary domain / public URL immutability; corrected to reflect the real registered domain `dnaos.co.th` (see `domain-migration-policy.md` for the governed-change process)
- [`route-lifecycle.md`](./route-lifecycle.md) — route states, rename/move/removal rules, grounded in this repo's real precedent
- [`deployment-contract.md`](./deployment-contract.md) — proposed pipeline stages vs. what actually exists in `package.json`/`scripts/` today

**Production-grade specification set (Objective / Architecture Principle / Requirements / Validation Checklist / Failure Conditions / Recovery Procedure each)**
1. [`url-lifecycle-policy.md`](./url-lifecycle-policy.md) — the URL as external contract, layered on top of `route-lifecycle.md`
2. [`route-stability-policy.md`](./route-stability-policy.md) — path/auth/response-shape stability once Published
3. [`domain-migration-policy.md`](./domain-migration-policy.md) — governed process for any domain/DNS/Vercel-binding change, using the real `engines/domains/*` tooling already in this repo
4. [`deployment-contract.md`](./deployment-contract.md) — the 9-stage pipeline and its current implementation gap
5. [`backward-compatibility-rules.md`](./backward-compatibility-rules.md) — known external/internal consumers enumerated, additive-by-default rule
6. [`zero-broken-url-policy.md`](./zero-broken-url-policy.md) — link-integrity detection, grounded in two real known-broken-link cases
7. [`zero-dead-route-policy.md`](./zero-dead-route-policy.md) — filesystem/registry/nav consistency, continuous version of the Phase 2 closeout's manual reconciliation
8. [`redirect-policy.md`](./redirect-policy.md) — mechanics of a route move, closing the exact gap that caused the `/admin/line-customers` incident
9. [`versioning-policy.md`](./versioning-policy.md) — formalizes this repo's existing but undocumented `/api/v1/*` vs. unversioned `/api/admin/*` split
10. [`rollback-policy.md`](./rollback-policy.md) — code + data rollback, honestly scoped against this repo's current uncommitted-work gap (`TASK-003`)
