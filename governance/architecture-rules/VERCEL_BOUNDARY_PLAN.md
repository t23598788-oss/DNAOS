# Vercel Boundary Plan — connections/vercel/, webhook ingress, drain ingress, governance/release-gate/

**status: PLAN ONLY. No full capability built this round (Owner, 2026-08-14).**
This document exists so four related, easily-confused areas get separated
correctly *before* any of them gets a single source file — a mistake here
would mean re-splitting real code later instead of drawing the line once,
on paper, first.

Grounded in the Vercel capability research round (2026-08-14, documentation
only, no live API call made — see the audit report delivered that round).
Not a new capability itself — this is governance-level, cross-capability
architecture, same category as `CAPABILITY_FOLDER_LAW.md`.

## Duplicate/overlap check (Capability Folder Law §4/§5) — done before writing this

Checked `connections/` (only `github/`, `vercel/`, `supabase/`,
`ai-providers/`, `servers/`, `external-software/` exist) and grepped every
`.md` in the repo for "webhook" — the only hit is
`connections/github/README.md`'s NOT_YET_BUILT list item ("webhook / event
ขาเข้าจาก GitHub"), which is a note that GitHub webhook ingress doesn't
exist yet, not a folder. **No `DUPLICATE`, no `OVERLAPPING_CAPABILITY`.**
The four areas below are genuinely new namespace.

## Why four, not one

The 2026-08-14 audit's own Capability Folder Law flags section named this
exact split. Restated with the reasoning:

- **Direction of data flow** — `connections/vercel/` is DNA OS calling
  Vercel (outbound). Webhook and drain ingress are Vercel calling DNA OS
  (inbound). These have different failure modes (an outbound call times out
  and can be retried on our schedule; an inbound call must respond fast and
  correctly the first time, on Vercel's schedule) and different auth
  shapes (a bearer token we send vs. a signature we verify).
- **Webhook vs. drain, both inbound, still not the same thing** — a
  webhook is a low-volume lifecycle notification (`deployment.ready`,
  `project.domain.created`, ...); a drain is a high-volume, billed
  ($0.50/GB per Vercel's pricing docs), schema-typed stream (`log`,
  `trace`, `analytics`, `speed_insights`, `audit_log`, `connect` — one
  schema per drain). Different retention, different cost exposure,
  different Capability Folder Law §7 answer to "can this be deleted as one
  folder without touching the other."
- **Decision logic is not transport** — `governance/release-gate/` decides
  *whether* a deployment should be blocked or released. `connections/vercel/`
  is the only thing allowed to *say so to Vercel* (via the Checks API).
  Folding gate policy into the adapter folder would violate Capability
  Folder Law §9 (cross-capability communication only through a declared
  contract) the moment any other capability ever needs the same policy.

---

## 1. `connections/vercel/` — outbound adapter (same shape as `connections/github/`)

**Scope:** everything that is DNA OS calling Vercel's REST API —
project/deployment CRUD, promote, rollback, env vars, domains, build
config, reading deployment/Checks status, and (once §4's gate below
clears) writing Check/Check-Run results.

**Auth:** exactly one credential channel per controlled Vercel project — a
single **project-scoped** access token (never Full Account — see the
audit's §1 least-privilege reasoning: a project token cannot mint further
tokens and cannot reach team/user-level resources, which is what makes
Rule 2 below cheap to enforce instead of merely promised). Same
single-channel-enforcement pattern as `connections/github/`'s
`EXPECTED_GITHUB_CREDENTIAL_ENV_VAR_NAME` / P-GH-013 — the exact env var
name is a build-time decision, not fixed here.

**Explicitly OUT of scope for this folder:**
- (a) receiving inbound webhook calls — see §2.
- (b) receiving inbound drain/log streams — see §3.
- (c) any Billing/FOCUS endpoint — see Rule 2, forbidden outright,
  independent of what a token's scope would technically permit.

## 2. `connections/vercel-webhooks/` — inbound webhook receiver (NOT_YET_BUILT, new stub this round)

**Scope:** an HTTPS endpoint receiving Vercel's `POST` webhook payloads
(`deployment.*`, `project.*`, `domain.*`, `budget.reached`, ...),
verifying the `x-vercel-signature` header (HMAC-SHA1 against the webhook's
own secret) before trusting anything in the body, translating a verified
payload into an `EventEnvelope`.

**Explicitly OUT of scope:** creating/listing/deleting the webhook
registration itself (`POST/GET/DELETE /v1/webhooks`) — that is an outbound
call and belongs in `connections/vercel/`. This folder only receives; it
never registers itself.

## 3. `connections/vercel-drains/` — inbound log/observability drain receiver (NOT_YET_BUILT, new stub this round)

**Scope:** an HTTPS endpoint receiving Vercel Drains push traffic, one
`schema` at a time (`log`/`trace`/`analytics`/`speed_insights`/
`audit_log`/`connect`).

**Explicitly OUT of scope / explicit hazard:** this folder must never
persist raw drain payload content as if it were this repo's own data — see
G-ARCH-001 and root `README.md`'s "must never hold" list. A log line about
someone else's deployment can easily smuggle in content DNA OS has no
business retaining; whatever gets built here may extract only the
operational metadata it actually needs (deployment id, status, timestamp,
level) and must discard the rest, not store-then-filter.

## 4. `governance/release-gate/` — Approval Gate decision logic (existing NOT_YET_BUILT stub, scope extended this round)

Its existing scope (final gate before `execution/deploy/` runs, checking
that governance/source-validation, dependency-rules, permission-rules, and
`execution/test/`'s result all passed) is unchanged. Made concrete for
Vercel this round:

- This folder owns the **decision** of what verdict
  (`succeeded`/`failed`/`neutral`) to report for a Vercel Check tied to
  `blocks: "deployment-alias"` or `"deployment-promotion"`.
- The actual outbound `PATCH .../check-runs/{id}` call is still made
  through `connections/vercel/`'s declared contract — **never a direct
  HTTP call from this folder.** Same one-way shape as the existing
  `contracts/` → `permissions/` rule, applied here to
  `connections/vercel/` ↔ `governance/release-gate/`:
  `governance/release-gate/` may depend on `connections/vercel/`'s
  contract; `connections/vercel/` must never depend on
  `governance/release-gate/`.
- Also owns: which blocking level (`build-start` / `deployment-start` /
  `deployment-alias` / `deployment-promotion`) DNA OS's own deployments
  register at — a DNA OS policy choice, not a Vercel API detail, so it
  does not belong in `connections/vercel/`.

---

## Dependency direction (extends root `README.md`'s existing rule)

```
connections/vercel/          → contracts/ only
connections/vercel-webhooks/ → contracts/ only (emits EventEnvelope; never calls connections/vercel/ or release-gate/ directly)
connections/vercel-drains/   → contracts/ only (same)
governance/release-gate/     → contracts/ + connections/vercel/'s declared contract (to report Checks results)
```
Never the reverse on the last line — `connections/vercel/` must not depend
on `governance/release-gate/`.

## Rule 2 (Owner, this round): Billing/FOCUS forbidden outright

`GET /v1/billing/charges`, `GET /v1/billing/contract-commitments`,
`POST /v1/billing/buy` must never be called from `connections/vercel/` or
any capability in this repo — regardless of what a token's scope
technically permits. The FOCUS charges response is invoice-grade financial
data (`BilledCost`, `EffectiveCost`, `BillingCurrency`, `ChargeCategory`)
— structurally exactly what G-ARCH-001 already bans. The least-privilege
choice in §1 (project-scoped token) already makes this endpoint
unreachable in practice — it's role-gated to Owner/Member/Developer/
Security/Billing team roles, a project token cannot reach it — but this
rule exists so the ban holds by policy, not by accident, in case a future
capability is ever handed a broader token by mistake. Cross-referenced
from `governance/architecture-rules/README.md`'s G-ARCH-001.

## Rule 4 (Owner, this round): no production write/deploy until the Checks auth path is proven

No write-capable `connections/vercel/` intent that touches a real
deployment (create deployment with `target: production`, promote,
rollback) is authorized to be built until
`../../connections/vercel/CHECKS_API_LIVE_TEST_PLAN.md`'s test has
actually run against a real project-scoped token and produced a real,
observed result — either PASS (a project token is sufficient) or the
OAuth2-required finding (a Vercel Integration/App is needed, same shape as
`connections/github/ARCHITECTURE_DECISIONS.md`'s ADR-GH-001 trigger
condition #2 for GitHub Check Runs). Reason: whichever answer comes back
changes `governance/release-gate/`'s entire design — whether it can report
Check results itself through a plain token, or must hand that off to a
future Vercel-App capability. Building the write path before knowing this
risks building the wrong shape and redoing it.

## What this round does NOT do

- Does not create `connections/vercel/`'s source files
  (adapter-contract.ts, adapter-config.ts, credential-resolution.ts, ...)
  — full capability build stays explicitly deferred.
- Does not create `governance/release-gate/`'s source files.
- Does not execute the Checks-API test — no `VERCEL_TOKEN` exists anywhere
  in this session or repo (re-checked 2026-08-14: no `VERCEL_*` key in
  `dna-os-deadboard/.env.local`'s 23 keys, none in shell env).
- Does not pick a Vercel credential env var name — a build-time decision
  for when the full capability is actually authorized.
- Does not touch `connections/github/` in any way.

## Related

- `../../connections/vercel/CHECKS_API_LIVE_TEST_PLAN.md` — the plan Rule
  4 above gates on.
- `../../connections/vercel/README.md` — updated this round to reflect
  this boundary.
- `../../connections/vercel-webhooks/README.md`,
  `../../connections/vercel-drains/README.md` — new NOT_YET_BUILT stubs
  staking out §2/§3 above.
- `../release-gate/README.md` — updated this round with the §4 cross-ref.
- `../../connections/github/ARCHITECTURE_DECISIONS.md` — the GitHub
  precedent this plan's Rule 4 deliberately mirrors.
