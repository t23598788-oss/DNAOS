# DNA-OS-INFRASTRUCTURE

**Status: skeleton only. Nothing in this repo can command, read, or modify any external program, AI model, server, or software yet. Every capability below is explicitly NOT_YET_BUILT unless stated otherwise.**

## What this repo is

The source code for DNA OS's control system: the layer that will let external
programs, AI agents, and future software workspaces connect to DNA OS as
their own scoped identities, instead of sharing one owner/service-role
credential. This repo holds only: source code, contracts, registry schema,
permissions, connector definitions, execution logic, and governance for that
control system.

## What this repo is NOT

This repo does not contain, and must never contain:

- Business Logic of DNA OS's own operations (that stays in the Operational
  system — `dna-os-deadboard`)
- Operational UI
- Business data or business documents
- Any operational database

## Boundary rule (non-negotiable, per Owner directive 2026-08-14)

**Operational (`dna-os-deadboard`) and Infrastructure (this repo) connect
only through Contract/API/Event. No direct database dependency between the
two systems, in either direction.** The Operational system owns its own
Supabase project and may keep querying it directly — that is its own
database, owned by the service that owns it. This repo must never reach
into Operational's Supabase directly, and Operational must never reach into
whatever database this repo eventually owns directly either. See
`contracts/operational-bridge.ts`.

## Core permission principle

**Platform Owner ≠ Data Owner.** The DNA OS Owner has ultimate authority
over DNA OS's own systems (source code, infrastructure, AI, deployment,
policy, connectors, and DNA OS's own company data) — not automatic read
access to every external account/tenant's data. See
`permissions/boundary.ts` for the enforceable version of this rule.

## Relationship to `dna-os-deadboard` — corrected 2026-08-14

**`dna-os-deadboard` is not one single "Operational Account."** DNA OS's
own business is made of multiple real Business Domains (distinct business
lines/operating areas — that codebase already has real, live precedent for
this split: `factory_app_role` vs `business_app_role` Postgres roles,
Factory/Infrastructure-Control kept separate from Business
Finance/invoicing at the DB-permission layer). Each real Business Domain
is its own Account under this repo's model, with its own scope — same as
any external program's Account, structurally — not a single blob, and
never a "master account" over the others just because they share one
human Owner. Which concrete domains dna-os-deadboard actually has is not
decided here; that needs its own evidence pass, not a guess.

**Corrected top-level shape:**

```
Multiple Business Domains  <-- Contract/API/Event -->  Control / Infrastructure (this repo)
```

not:

```
"DNA OS Business" (one account)  <-->  Control
```

Control / Software Factory / Infrastructure (this repo) is its own
category, not a peer to any Business Domain and not counted as one — it's
the layer every domain (business or external) connects through, not a
member of the set it governs.

`dna-os-deadboard`'s existing ~200+ Business API routes are **not** being
converted to account-scoped APIs in this round. Nothing in that repo
changes as a result of this repo existing. TASK-172 (the GitHub connector
work built 2026-08-14, before this boundary was defined) is frozen in a
legacy/pending-migration state in that repo's own registry until this
repo's contracts define where that capability actually belongs.

## Status of every module

| Folder | Real content today | Status |
|---|---|---|
| `contracts/` | Identity/Account/Tenant/Software/Workspace type definitions, Command/Event envelope, Operational↔Infrastructure bridge contract | Types only — no runtime enforcement yet |
| `permissions/` | The enforceable permission boundary spec (Owner/Tenant/Service/cross-tenant rules) | Spec only — nothing calls this yet |
| `execution/` | Command lifecycle state machine spec | Spec only — no executor exists |
| `registry/` | Source-code-level schema for what an Account/Tenant/Software/Adapter registration record looks like | Type definitions only — **no real database**, no persistence |
| `controller/` | Responsibility statement for the EMS-style gateway (authenticate → authorize → classify → route) | NOT_YET_BUILT |
| `connectors/` | Responsibility statement for destination adapters (Supabase adapter, GitHub, Vercel, AI provider, etc.) | NOT_YET_BUILT |
| `models/` | Responsibility statement for per-destination-type data shape | NOT_YET_BUILT |
| `agents/` | Responsibility statement for AI-agent-specific identity/execution scope | NOT_YET_BUILT |
| `governance/` | This repo's own hard rules | Written as a document — no mechanical enforcement yet |
| `audit/` | Responsibility statement for durable per-command/event evidence | NOT_YET_BUILT |
| `config/` | Responsibility statement + the env-var-by-reference pattern (proven in TASK-172, reused here) | Pattern documented — no real config loader yet |

No migration has been run. No source code has been moved. No existing
Supabase table has been touched or deleted. This file and every other file
in this repo is the Owner-requested report artifact, not a working system.
