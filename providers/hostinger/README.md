# providers/hostinger/ — Hostinger External Live Intelligence Source

หน้าที่: registers Hostinger as a POINTER + SOURCE IDENTITY + ACCESS
CONTRACT so DNA OS can go re-check Hostinger's real documentation, MCP
server, and product pages from the source of truth — never a copy of
Hostinger's content stored here. See `../../reports/` for the prior
`REGISTER_HOSTINGER_AS_LIVE_EXTERNAL_INTELLIGENCE_SOURCE` task this folder
implements.

## What this is / is not

- **Is**: a real, static provider identity (`definition/*.json`,
  evidence-traceable to `evidence/HOSTINGER_PROVIDER_DISCOVERY.md`), a
  typed source-pointer registry (`sources/source-map.ts`), a working
  live-fetch + fingerprint + change-detection pipeline
  (`live-check/`), and a real registration path into the existing
  Persistent Software Registry (`register-candidates.ts`, via
  `control/registration-pipeline/`).
- **Is not**: a Hostinger *connection/adapter* that executes commands
  against Hostinger (compare `connections/digitalocean/` or
  `connections/github/`) — no credential is held or needed here, every
  registered source is a public documentation/repository URL. It is also
  not a new registry or database — see "Reuse decision" below.

## Reuse decision (Phase 1 of the task)

Checked before building anything:
1. `control/command-router/capability-registry.ts` — a hardcoded
   in-memory routing table, not a persistent registry. Not used.
2. `connections/connection-registry/` — real and persistent, but its
   `ConnectionRegistration` type (`contracts/connector/connection.ts`) is
   purpose-built for `SOURCE_AUTHORITY` git-host connections
   (owner/repository/branch, executor_capability_id, WRITE_SOURCE scope)
   used to authorize command *execution*. Forcing a documentation-page
   pointer into that shape would misuse it. Not used.
3. `control/registration-pipeline/` + `software/registry-database/` (the
   real Persistent Software Registry: Candidate -> Validation ->
   Classification -> Duplicate Resolution -> Registration Decision ->
   Repository Resolution -> Registry Writer) — **used**. `resource_type:
   PROVIDER_REFERENCE` (domain `INFRASTRUCTURE_CONTROL`) is a pre-existing
   enum value in `control/event-pipeline/domain-classification.ts`, not
   invented for this task, and Repository Resolution correctly resolves
   to `NOT_APPLICABLE` for a candidate with no owner/repository claim —
   exactly what an external doc pointer is.
4. `providers/digitalocean/` — the precedent this folder's
   `definition/`/`evidence/` split directly mirrors (same JSON schema
   discipline: never state a fact not traceable to the evidence file).

No new database, no new table, no new persistent-store engine — the
Registry Writer write path (`software/registry-database/adapters/
persistent-file-store.ts`, JSONL, already-proven) and its Duplicate Gate
are reused as-is. The one genuinely new persistent artifact is
`data/change-log.jsonl`, an append-only Change Detection log — this
did not already exist anywhere (no prior capability tracks external
documentation drift), so per Capability Folder Law §4/§5 it is new, but
follows the exact same JSONL-append convention as every other store in
this repo (see `live-check/change-log.ts`'s own header).

## Phases implemented

- **Phase 1** — this section.
- **Phase 2/3** — `sources/types.ts` (the exact field contract requested)
  + `sources/source-map.ts` (8 real pointers, each evidence-traced; no
  pointer registered from an UNKNOWN fact — Codex/Antigravity-specific
  config and a standalone VS Code page were deliberately excluded because
  no dedicated official page exists for them).
- **Phase 4** — `access_mode`/`freshness_mode` on every row in
  `source-map.ts`, honestly downgraded to `MANUAL_ONLY` for the two
  sources that don't have a fetchable `endpoint_pointer`
  (`developers.hostinger.com`'s JS-rendered reference, `nexos.ai`'s
  features page which returns HTTP 403 to a plain GET).
- **Phase 5** — `live-check/live-fetch.ts` is the real, transient
  Registered Source -> Resolver -> Live Fetch -> Normalize -> Fingerprint
  -> Compare pipeline. The raw fetched body exists only inside that one
  function call's stack; it is never returned, never logged, never
  written to disk — only a SHA-256 hex digest and a byte count leave the
  function.
- **Phase 6** — `live-check/change-log.ts`: append-only JSONL, stores
  exactly `{source_id, what_changed, when_detected, source_pointer,
  old_fingerprint, new_fingerprint, verification_state}` — proven live in
  `data/change-log.jsonl`.
- **Phase 7 — NOT CONNECTED, reported honestly.** A repo-wide search
  (see prior Explore-agent findings for this task) confirmed no "DNA OS
  Lab", `SystemCandidate`, `CapabilityCandidate`, or `Opportunity`
  concept exists anywhere in this codebase. Building one was out of this
  task's scope ("ห้ามสร้างระบบใหม่จาก Idea ที่ค้นพบ"). This folder emits
  real, structured Change Detection findings
  (`ChangeLogEntry`/`LiveCheckResult`) in a shape a future Lab could
  consume, but nothing here fabricates a Lab connection that does not
  exist.
- **Phase 8** — no token used anywhere in this folder; every registered
  endpoint is a public GET. `definition/scopes.json` documents Hostinger's
  real token flow for when an authenticated connector is ever built
  (that would live in `connections/hostinger/`, a distinct future
  capability, and would resolve its credential through
  `credentials/registry/` + Keychain exactly like `connections/github/`
  does today — never a token in this folder).
- **Phase 9** — `run-verification.ts`, run twice against the live
  internet during this task: first run produced 6 `INITIAL_BASELINE`
  fingerprints + 2 `NO_ENDPOINT` (both correctly refused, no fabricated
  fetch); second run correctly reported `NO_CHANGE` for the one fully
  static source (`hostinger_mcp_repository`, the raw GitHub README).
- **Phase 10** — `register-candidates.ts`, run twice: first run
  `REGISTERED` all 8 pointers as real `resource-*` rows in the
  Persistent Software Registry (`software/registry-database/data/
  canonical/*.jsonl`); second run correctly returned `DUPLICATE` for all
  8 via the real Duplicate Gate (`control/registration-pipeline/
  duplicate-resolution.ts`) — proving idempotency, not a re-insert.

## Known limitation (found during Phase 9, reported honestly)

Hostinger's `hostinger.com/support/*` pages appear to embed per-request
dynamic content (fingerprint changed between two back-to-back fetches
despite an unchanged byte count) — likely a CSRF token, nonce, or
session-scoped fragment in the page markup. This means naive whole-page
SHA-256 fingerprinting on those specific pages will report
`CONTENT_CHANGED` on essentially every poll, which is **noise, not a
real content change**. Only `hostinger_mcp_repository` (raw GitHub
README — static, deterministic) was confirmed to fingerprint stably
across repeated fetches. A future round would need to extract just the
article body (not the full page shell) before fingerprinting the
`support/*` sources to make their `POLLABLE` freshness meaningful; this
round intentionally did not build that extraction to avoid guessing at
Hostinger's page structure beyond what was actually observed.

## Running it yourself

```bash
npx tsx providers/hostinger/register-candidates.ts   # Phase 10 — idempotent
npx tsx providers/hostinger/run-verification.ts       # Phase 9 — live network calls
```
