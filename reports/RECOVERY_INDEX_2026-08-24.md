# Recovery Index — 2026-08-24 GitHub/Railway migration

Real, machine-derived facts only — every field below is re-derivable
without this session's memory, via `npm run census:json`, `git log`,
`railway status --json`, and the commands named per capability. This
covers the capabilities this migration round directly built, hardened, or
deployed — not all 118 capability folders in the repo (see
"Registration completeness gap" below for the rest).

## How to regenerate this data yourself

```
npm run census:json          # per-capability: source, contracts, deps, registration, lineage
git log --oneline -1          # current local HEAD
git ls-remote origin main     # current real remote HEAD (must match)
railway status --json         # real Railway service ids/repo/startCommand
```

## Capability records

### transport/owner-command-http

| Field | Value |
|---|---|
| WHAT | Real HTTP transport for the Owner Command pipeline (`POST /command`, `/handoff`, `/registry/*`, `GET /health`, `/runtime/inventory`, `/task/:id`) |
| WHERE (canonical source) | `transport/owner-command-http/server.ts` |
| GitHub commit | `a4aa971790591ea4c13ed9f49bee85962123c7ca` (verified: local HEAD = remote HEAD) |
| Capability ID (registry) | `capability-712d0f8a-1d3a-455b-8056-bfa024d6f763` |
| Registration state | `REGISTERED_STALE` (registered; not yet re-confirmed VERIFIED by the registry itself) |
| Contract | in: `commandText`, optional `WorkOrder`, `ownerIdentity`, `Authorization: Bearer <secret>`; out: `SubmitOwnerCommandOutcome`, `OwnerCommandLifecycle` |
| Dependencies | `control/owner-command/contract.ts`, `control/agent-gateway/contract.ts`, `permissions/network-auth-gate/contract.ts`, `software/registry-database/adapters/persistent-file-store.ts` |
| Depended on by | Dead Board (`dna-os-deadboard`, separate repo, Mac-local, out of migration scope) |
| WHERE it executes | Real launchd process on the Mac today (`com.dnaos.owner-command-http`, port 8791); **Railway deployment `3247c5ac-cf51-424c-9131-4e5f834c8ddd`, status SUCCESS, instance RUNNING, commit `ca3e3249db96c264d56a03810d6b4cc9fc54f953`** — real startup log: `owner-command-http listening on http://0.0.0.0:8080`. No public domain by design (see permissions/network-auth-gate — public exposure of this specific service was deliberately deferred pending Dead Board's own reachability); Railway's own `/health` healthcheck gate held the deploy at non-success until it passed |
| HOW to restore | `git clone` → `npm install` → `npx tsx transport/owner-command-http/tests/wiring.test.ts` and `.../tests/auth-gate.test.ts` — both proven clean from a fresh clone this session |
| Superseded | n/a (no prior version) |

### dna-os-circuit/runtime

| Field | Value |
|---|---|
| WHAT | Real HTTP+SSE server for the Circuit Board UI and its findings/evaluation/decision engines |
| WHERE (canonical source) | `dna-os-circuit/runtime/server.ts` (entrypoint: `dna-os-circuit/runtime/start.ts` — `server.ts` alone never self-starts, see its own header) |
| GitHub commit | `a4aa971790591ea4c13ed9f49bee85962123c7ca` |
| Capability ID (registry) | `capability-3a7a4db0-f4eb-46d1-85db-3212e3a665ab` |
| Registration state | `REGISTERED_STALE` |
| Contract | in: `CircuitState`, HTTP requests; out: circuit UI, SSE stream, findings/evaluation/decision JSON, agent-gateway dispatch results |
| Dependencies | `control/agent-gateway/contract.ts`, `permissions/network-auth-gate/contract.ts`, `dna-os-circuit/definition/semantic-model.ts`, `execution/run/contract.ts` |
| WHERE it executes | **Railway deployment `40ffd5ab-3033-4c14-9fd6-23b153cb9fd5`, status SUCCESS, instance RUNNING, commit `ca3e3249db96c264d56a03810d6b4cc9fc54f953`. Real public URL: https://dna-os-circuit-production.up.railway.app** — `GET /circuit.json` returns real 200; unauthenticated `POST /evaluate` returns real 401 `{"error":"unauthorized"}` (auth gate live-verified in production, not just in tests) |
| HOW to restore | `git clone` → `npm install` → `npx tsx dna-os-circuit/runtime/tests/server.test.ts`, `dna-os-circuit/definition/tests/semantic-model.test.ts`, `.../sbgn-view-builder.test.ts` — all proven clean from a fresh clone this session |
| Superseded | n/a |

### observability/joint-monitor

| Field | Value |
|---|---|
| WHAT | Real HTTP+SSE evidence store for cross-capability joint/violation records |
| WHERE (canonical source) | `observability/joint-monitor/server.ts` (entrypoint: `observability/joint-monitor/start.ts`) |
| GitHub commit | `a4aa971790591ea4c13ed9f49bee85962123c7ca` |
| Capability ID (registry) | `capability-6099780b-29c7-4c52-9e74-6ad00efb4b45` |
| Registration state | `REGISTERED_STALE` (registered before this migration round; not touched here) |
| WHERE it executes | **Railway deployment `0a0ecaca-e4fe-4b90-976b-d6822a567763`, status SUCCESS, instance RUNNING, commit `ca3e3249db96c264d56a03810d6b4cc9fc54f953`. Real public URL: https://joint-monitor-production.up.railway.app** — `GET /joints` returns real 200 |
| HOW to restore | `git clone` → `npm install` → `npx tsx observability/joint-monitor/tests/joint-broadcast-proof.test.ts`, `.../router-wiring-proof.test.ts` — ~~**known pre-existing flake**~~ **CORRECTION (2026-08-26):** not a flake. Both tests pass deterministically under the repo's own pinned Node (`.nvmrc` = 24); the failures recorded here were run under Node 16, which has no global `fetch`, so `observability/joint-monitor/host-runtime.ts#hostPostJson` throws and `client.ts` swallows it by design — every POST silently does nothing while the SSE half still passes. Re-verified 2026-08-26 under Node 24: `joint-broadcast-proof`, `router-wiring-proof` and the new `authenticated-report-proof` all pass |
| Superseded | n/a |

### permissions/network-auth-gate

| Field | Value |
|---|---|
| WHAT | Shared-secret, fail-closed network auth gate for transport-layer HTTP servers built assuming loopback-only reachability |
| WHERE (canonical source) | `permissions/network-auth-gate/contract.ts` (+ `policy.ts`, `types.ts`) |
| GitHub commit | `a4aa971790591ea4c13ed9f49bee85962123c7ca` |
| Capability ID (registry) | `capability-9185a189-411a-4fc0-8c8b-5f7ebf89cc0f` |
| Registration state | `REGISTERED_STALE` |
| Contract | in: `Authorization` header value, expected secret, bind host; out: boolean verify result, `BindPolicyDecision` |
| Dependencies | `node:crypto` only |
| Depended on by | `transport/owner-command-http`, `dna-os-circuit/runtime`, `observability/joint-monitor` (all three real request-auth enforcement points) |
| WHERE it executes | In-process with each of the three services above — not independently deployed |
| HOW to restore | `git clone` → `npm install` → `npx tsx permissions/network-auth-gate/tests/policy.test.ts` — 11/11 pass |
| Superseded | n/a (new this round) |

### Postgres (Railway infrastructure, not a repo capability)

| Field | Value |
|---|---|
| WHAT | Real, live `software_registry` Postgres database — schema + role separation applied and verified |
| Railway service | `Postgres`, id `f871f760-8d2d-4200-ba6b-c24be36aeda9`, image `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Schema source | `software/registry-database/migrations/0001_create_software_registry_schema.sql` + `.../0001_create_software_registry_roles.sql` (both applied against the live instance, pre-flight checklist verified with real queries) |
| Application wiring | **Not done.** `RegistryStore` (sync) vs `AsyncRegistryStore`/postgres-store.ts (async) mismatch cascades into ~19 other real production files if resolved by making the shared interface async — deliberately parked as its own follow-up, not rushed into this migration |

## Registration completeness gap (real, not closed by this pass)

Census (`npm run census`, head `a4aa971`): 118 real capability folders.

| registration_state | count |
|---|---|
| REGISTERED_STALE | 55 |
| UNREGISTERED | 63 |

Of the 63 `UNREGISTERED`, 28 are `DECLARED_ONLY` (no real implementation yet
— nothing to register) and **35 are real, working capabilities that have
never been through the registration pipeline at all** (down from 38 before
this pass). This migration round registered only the 3 capabilities it
directly touched; the remaining 35 are a real, separate backlog.

## Local retirement readiness

Per the retirement gate this migration itself specifies (REGISTERED,
GITHUB_VERIFIED, RESTORE_VERIFIED, REMOTE_SHA_MATCH,
REGISTRY_POINTER_UPDATED, +RAILWAY_RUNTIME_VERIFIED for anything with a
Railway target):

- `GITHUB_VERIFIED`: true for the 4 capabilities above (remote SHA matches local HEAD).
- `RESTORE_VERIFIED`: true (clean-clone proof this session — install, typecheck, and the relevant test suites all pass from a fresh `git clone`, independent of this working directory).
- `RAILWAY_RUNTIME_VERIFIED`: **true for all three deploy targets as of this update** — GitHub App authorized, all three redeployed from commit `ca3e3249db96c264d56a03810d6b4cc9fc54f953`, all three `SUCCESS`/`RUNNING`, real HTTP health + auth-gate enforcement confirmed live in production for the two with public domains (dna-os-circuit, joint-monitor); owner-command-http verified via Railway's own healthcheck gate + startup log (no public domain, by design).
- Registration completeness: **still 35 real capabilities repo-wide remain unregistered** — unchanged by the deploy.

**LOCAL_SOURCE_RETIREMENT_READY = false.** No local source should be
removed. Railway runtime verification is now real and complete for the
three migrated services, but the registration-completeness gate is not:
35 real capabilities across the repo have never been through the
registration pipeline. Local source retirement requires
`REGISTRY_COMPLETE=true` repo-wide, not just for the capabilities this
migration round happened to touch.
