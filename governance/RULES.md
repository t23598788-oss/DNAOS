# DNA-OS-INFRASTRUCTURE — Governance Rules

Hard rules for this repo specifically, decided by the Owner 2026-08-14. Not
a copy of `dna-os-deadboard`'s `CLAUDE.md` — this repo is architecturally
separate on purpose (see repo-level README.md) and has its own, narrower
rule set.

## R-INFRA-001 — No direct database dependency with Operational

This repo must never query `dna-os-deadboard`'s Supabase project directly,
and `dna-os-deadboard` must never query this repo's eventual database
directly. All communication is through `contracts/operational-bridge.ts`'s
Command/Event contract, whatever real transport it eventually gets.

## R-INFRA-002 — Domain owner accesses its own database; no one else does

The service that owns a piece of data may access its own database
directly. Any OTHER domain, UI, AI, or external software must go through
that owner's API/Event/Contract instead — never a shared/global query
surface across domains.

## R-INFRA-003 — `supabaseAdmin()` / service-role is not this system's authorization model

`dna-os-deadboard`'s `supabaseAdmin()` (service role, bypasses RLS) must
never be reused here as "how this system decides who can do what." This
repo's authorization model is `permissions/boundary.ts` — scope-checked
per Account, denied by default across accounts, with break-glass as the
only exception path and never a standing right.

## R-INFRA-004 — Platform Owner ≠ Data Owner

See `permissions/boundary.ts`. The Owner's platform-level authority never
implies automatic read access to a tenant's actual data.

## R-INFRA-005 — No fabricated capability or status

Anything not actually built and verified must say `NOT_YET_BUILT`,
explicitly, in code comments and in any status this system reports about
itself. No placeholder may render as if it were a working capability.

## R-INFRA-006 — Business Logic and Operational Data never enter this repo

See repo-level README.md. Enforced today by discipline only (no mechanical
check exists yet) — worth a real CI check once this repo has any CI.

## R-INFRA-007 — Every field earns its place

Don't add `identity_id`/`account_id`/`tenant_id`/`software_id` to a record
that doesn't need it just to "future-proof" it. The boundary envelope
(`contracts/envelope.ts`) is the one place all five belong together by
necessity — everything past that boundary carries only what it actually
uses (see `contracts/identity-model.ts`'s closing note).
