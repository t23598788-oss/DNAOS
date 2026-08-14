# Checks API Live-Test Plan — resolving the OAuth2-vs-token UNKNOWN

**status: PLAN ONLY. Not executed.** No `VERCEL_TOKEN` (or any `VERCEL_*`
credential) exists anywhere in this session or repo — re-verified
2026-08-14: `dna-os-deadboard/.env.local` holds 23 keys (Supabase, OpenAI,
LINE, Gmail, Kasikorn, RunPod, `GITHUB_PAT_INFRASTRUCTURE`), none of them
Vercel; no `VERCEL_*` in the shell environment either. This document exists
so the test is fully specified and ready to run the moment a project-scoped
token exists, without re-deriving the design under time pressure.

## What this resolves

The 2026-08-14 Vercel capability research round found Vercel's own
documentation internally disagrees on whether `POST`/`PATCH` on the Checks
v2 API (`/v2/projects/{id}/checks`, `/v2/deployments/{id}/check-runs`)
requires an OAuth2 Integration client, or accepts a plain bearer token
(personal/project access token):

- The narrative `/docs/checks/*` pages say OAuth2 is required: *"The
  `post` and `patch` endpoints must be called with an OAuth2, or it will
  produce a `400` error"*; error table: `403` = *"The provided token is
  not from an OAuth2 client OR you do not have permission..."*
- The `checks-v2` REST reference declares only `bearerToken: HTTP bearer`
  auth, lists `400/401/403/410/500` with no OAuth2 clause, and its
  `create-a-check` request body accepts `source.kind: "webhook"` — not an
  Integration concept at all.

Not resolvable from documentation alone. This is the single fact
`governance/release-gate/`'s entire Vercel-facing design depends on — see
`../../governance/architecture-rules/VERCEL_BOUNDARY_PLAN.md` §4 (Rule 4:
no production write/deploy capability is authorized until this is proven
one way or the other).

## Preconditions before running

1. A **project-scoped** Vercel access token, stored as an env var. For
   this isolated test, any locally-scoped throwaway name is fine (e.g.
   `VERCEL_TEST_TOKEN`) — never committed, never reused as the eventual
   production credential channel once `connections/vercel/` is actually
   built.
2. The token's project is a **disposable/test Vercel project**, not one
   carrying real traffic — this test is a genuine (if small, reversible)
   write.
3. That project has at least one real deployment (`deploymentId`), needed
   for the check-run leg of the test (Step 3).

## Exact test steps

### Step 1 — the decisive call

```
POST https://api.vercel.com/v2/projects/{projectIdOrName}/checks
Authorization: Bearer {VERCEL_TEST_TOKEN}
Content-Type: application/json

{
  "name": "dna-os-gate-test",
  "requires": "deployment-url",
  "blocks": "none",
  "source": { "kind": "webhook" }
}
```

`blocks: "none"` deliberately — this call must never actually hold up a
real deployment while testing.

### Step 2 — interpret the result

| Response | Meaning | Consequence for `governance/release-gate/` |
|---|---|---|
| `200` with a check object, `id` present | A project-scoped token IS sufficient for Checks writes | `connections/vercel/` can implement Checks writes directly with the project token — no App needed |
| `400`/`403` whose message contains "OAuth2" (matching the documented text above) | Confirms the OAuth2-only claim | `governance/release-gate/` cannot report through Vercel Checks with a plain token — needs a future Vercel Integration/App capability, same shape as `../github/ARCHITECTURE_DECISIONS.md`'s ADR-GH-001 trigger condition #2 |
| Any other 4xx/5xx | Genuinely new information, not covered by existing docs | Stop. Record the verbatim response. Do not guess — report to Owner as a new finding before proceeding |

### Step 3 — if Step 1 succeeded, verify the check-run leg too

```
POST https://api.vercel.com/v2/deployments/{deploymentId}/check-runs
Authorization: Bearer {VERCEL_TEST_TOKEN}
Content-Type: application/json

{ "checkId": "{id from Step 1}" }
```

then

```
PATCH https://api.vercel.com/v2/deployments/{deploymentId}/check-runs/{checkRunId}
Authorization: Bearer {VERCEL_TEST_TOKEN}
Content-Type: application/json

{ "status": "completed", "conclusion": "neutral" }
```

`conclusion: "neutral"` deliberately — per the docs, `neutral` does not
fail or pass anything real regardless of a check's `blocks` setting.

### Step 4 — cleanup, mandatory

```
DELETE https://api.vercel.com/v2/projects/{projectIdOrName}/checks/{checkId}
```

Confirm with `GET /v2/projects/{projectIdOrName}/checks` that it no longer
lists the test check. This test must leave the test project exactly as it
found it.

## What this test does NOT do

- Never sets `blocks` to anything but `"none"` — never gates a real
  deployment during the test.
- Does not create, cancel, promote, or roll back any deployment — Rule 4's
  production-write freeze applies regardless of this test's outcome.
- Does not use any token other than the disposable `VERCEL_TEST_TOKEN` —
  never a Full Account token, never the eventual production credential
  channel.
- Does not get executed automatically by any session — requires the Owner
  (or an Owner-authorized session) to provision the test token and a
  disposable project first, then explicitly approve running it.

## After this test runs

Record the real, observed result (verbatim status code + message) as a
dated addendum to this file — same discipline as
`../github/CHANGE_PLAN_API_VERSION.md`, which recorded its actual PASS
result rather than resting on the plan alone. Do not mark this resolved,
or unblock Rule 4, based on documentation reasoning alone.
