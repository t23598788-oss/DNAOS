# Runtime V1 — current working-tree map

**role:** CURRENT-MAP (non-authoritative mapping). Executable contracts and tests remain CURRENT law. DOCX prose is not executable truth.

## Provenance

| Field | Value |
|---|---|
| Destination source | `source/destination-self-hosted.docx` — DNA OS Runtime V1 — แบบสถาปัตยกรรม Self-Hosted ที่ให้ผู้ให้บริการเหลือแค่เครื่องรัน |
| Placement/audit source | `source/placement-audit.docx` — DNA OS Runtime V1 — Audit จากรีโปจริงและแบบสถาปัตยกรรมปลายทาง |
| Branch inspected | `control/google-owner-remote-binding-policy-v1` |
| HEAD | `bf1658a3e52af223ecc0e832ffe62e6211c7b156` |
| origin/main | `f2dddba17dad66a2ae31511c42d1332ed3c12f54` |
| Working tree | Steps 1–8 source committed on this branch; runtime JSONL may still be dirty |
| Audited | 2026-09-11 |
| Status vocabulary | `VERIFIED` `PARTIAL` `MISSING` `CONFLICT` `RETIRE_CANDIDATE` `DEFERRED` |

Machine-readable twin: [`gap-map.yaml`](./gap-map.yaml). Step 7 adapter/boundary plan (no code move): [`STEP-7-ADAPTER-BOUNDARY.md`](./STEP-7-ADAPTER-BOUNDARY.md).

---

## CURRENT vs DESTINATION vs PLACEMENT

| Layer | Wins for | Location |
|---|---|---|
| CURRENT | What this checkout may execute today | TypeScript contracts, registries, tests, evidence |
| PLACEMENT | How to migrate without rewriting the authority graph | this folder + `PLACEMENT.md` |
| DESTINATION | End-state mechanisms (Postgres, jobs, release, DNA Git, HA) | `DESTINATION.md` |

The Placement audit was generated against **GitHub origin/main** and is stale for Step 1–6 symbols. This map audits **this working tree**.

---

## Origin/main vs this working tree vs destination

| Item | ORIGIN_MAIN_AT_AUDIT_TIME | CURRENT_WORKING_TREE | DESTINATION |
|---|---|---|---|
| `CORE_NODE` / `MAC_LOCAL_AGENT` | Not present as exact symbols | Present in `contracts/architecture/runtime-node-and-optional-provider.ts` (untracked vs origin/main) | Two node kinds; workers are process classes, not a third node |
| `OPTIONAL_PROVIDER` / `providerIsExecutionAuthority` | Semantics in `execution-authority.ts`; exact symbols missing | Exact symbols present; always `false` for providers | Provider supplies machines only |
| `PortableProcessSupervisor` | Missing; launchd declared sole supervisor | Present; darwin still launchd, non-darwin spawn | `dna-node` + cgroup/sandbox (not this file) |
| `checkout-resolution.ts` | Missing; `rebindRepositoryCheckout` exists | Present + write-gate/source-workspace/supervisor consume it | Checkout ≠ release; node-local path is not identity |
| Portable secret resolver | Missing | `credentials/secret-resolver/` + `credentials/process-environment/` | Scoped secrets; not Keychain-only Core |
| Step-3 Mac fail-closed | Missing | `transport/owner-command-http/mac-local-agent-gate.ts` + router uses `macLocalAgentExecutionDecision` | Mac agent not executed from Linux Core |
| `*.railway.app` in runtime decisions | Present | Canonical TS decisions use `resolveRuntimeEndpoint`; `*.railway.app` remains adapter JSONL / IAC / email evidence | Forbidden except optional adapter |
| PostgreSQL operational authority | Adapter exists; live Core path not proven | Same: `postgres-store.ts` exists; `owner-command-http/server.ts` has no `pg.Pool` | Postgres = current operational authority |
| Go `cmd/dna-core` | Absent (correct) | Absent (correct) | Illustrative only — do not recreate |

---

## Authority graph (KEEP)

Verified against current code (not rearranged to match destination prose).

```
Ingress (transport/owner-command-http, tests, other callers)
  → control/owner-command submitOwnerCommand
  → CommandEnvelope
  → control/command-router routeOwnerCommand
       → evaluateExecutionPermission (inside the router call)
       → capability
  → CapabilityResult / CommandLifecycleState
  → evidence / Owner surface
```

Evidence:

- `control/owner-command/owner-command.ts` header and `routeOwnerCommand` at the submit path
- `control/command-router/contract.ts` — only public import for owner-command
- `control/command-router/router.ts` — `evaluateExecutionPermission` before execution
- `control/command-router/ARCHITECTURE_DECISIONS.md` — Command → Router → permission
- `control/machine-model/execution-authority.ts` — Owner is root of authority
- Tests: `control/owner-command/tests/owner-command.test.ts`, `control/command-router` tests

**Do not** put execution-policy in front of the router as a second authority path. Destination diagrams that show Permission Engine above the router are DESTINATION illustrations, not CURRENT flow.

**Do not** add a second router, permission engine, command envelope, or execution-authority module.

Status: **VERIFIED** (flow). Destination `/v1/commands` surface: **MISSING** (legacy HTTP remains adapter — KEEP during migration).

---

## Architecture law matrix

### AUTHORITY LAW

- **Destination:** Owner → DNA OS → capability/agent/worker/provider. No provider, AI, or platform is execution authority.
- **Current:** `control/machine-model/execution-authority.ts`; `providerIsExecutionAuthority` always false.
- **Status:** **VERIFIED** (semantics). Exact Runtime V1 protocol string: **MISSING**.
- **Tests:** `control/machine-model/tests/machine-model.test.ts`; `contracts/architecture/runtime-node-and-optional-provider.test.ts`
- **Next:** keep; do not add a second authority module.

### COMMAND LAW

- **Destination:** All executable intent becomes a canonical command. Ingress → Identity → Envelope → Router → Permission → Target → Execution → Evidence.
- **Current:** Envelope + `submitOwnerCommand` + `routeOwnerCommand`. Target-resolution exists as `control/target-resolution/` (artifact/target kinds, not Runtime V1 executor registry).
- **Status:** **PARTIAL** (canonical Owner path exists; public `/v1/commands` and `RuntimeCommandV1` type do not).
- **Tests:** `control/owner-command/tests/owner-command.test.ts`
- **Next:** transport adapter later; do not replace envelope.

### PROCESS LAW

- **Destination:** Core coordinates; heavy work is durable job → worker → bound execution → terminate.
- **Current:** Agent Gateway supervisor recovered JSONL tasks (voice sweep removed after Core stall). `PortableProcessSupervisor` supervises **fixed catalog services**, not job workers. `control/scheduler` is a processing-fabric loop over provider pools, not Postgres job scheduler.
- **Status:** **PARTIAL**
- **Evidence:** `control/agent-gateway/supervisor.ts` comment (tasks.jsonl 14.5MB stall); `control/runtime-control/portable-supervisor.ts`; `control/scheduler/contract.ts`
- **Next:** `execution/workload-runtime` later; do not silently enlarge `runtime-control`.

### STATE LAW

- **Destination:** PostgreSQL = current operational authority; JSONL = evidence/export.
- **Current:** JSONL registries are live (repository-registry, connection-registry, agent-gateway tasks/evidence). `software/registry-database` has `RegistryStore` + `postgres-store.ts` + `connection-provider.ts` (Keychain-coupled Pool construction). `postgres-store.ts` header claims live invoke via `owner-command-http/server.ts`; that server file has **no** `pg.Pool` reference — **CONFLICT** between comment and code. Do not treat Postgres as Core operational authority today.
- **Status:** **PARTIAL** (port exists) / comment **CONFLICT**
- **Tests:** `software/registry-database/tests/postgres-schema-contract.test.ts`
- **Next:** after Step 7–8; shadow-write then cutover. Extend existing store port. Do not add a second database capability.

### SOURCE LAW

- **Destination:** git commit → build → artifact → signed immutable release → activation. Checkout ≠ production execution.
- **Current:** GitHub `SOURCE_AUTHORITY`. Execution from source checkout / `npx tsx`. Step 6 resolves node-local checkout, not releases.
- **Status:** **PARTIAL** (source identity + rebind + checkout resolution). Release model **MISSING**.
- **Tests:** `software/repository-registry/tests/checkout-portability.test.ts`, `connections/connection-registry/tests/connection-registry.test.ts`
- **Next:** release split after own-machine Core + state authority. GitHub remains SOURCE_AUTHORITY until explicit later event.

### NODE LAW

- **Destination:** Repository identity ≠ node identity ≠ release identity ≠ job identity. Two node kinds only.
- **Current:** `RepositoryRegistration` has no `node_id` (OWNER_LOCKED `types.ts`). `rebindRepositoryCheckout` + `resolveRepositoryCheckout`. No `control/node-registry/`.
- **Status:** **VERIFIED** (identity split for repository). Node/heartbeat registry **MISSING**.
- **Tests:** checkout-portability; repository-registry tests
- **Next:** add node registry later; never merge into repository-registry.

### PROVIDER LAW

- **Destination:** Provider may supply CPU/RAM/disk/network/VM lifecycle only.
- **Current:** Railway/Vercel `OPTIONAL_PROVIDER`. `connections/railway/` adapter. `.railway/` deploy config. Listen URLs owned by `control/runtime-endpoint-registry`.
- **Status:** **PARTIAL** (adapters remain; Core is no longer required to boot on Railway)
- **Tests:** `contracts/architecture/runtime-node-and-optional-provider.test.ts`; `contracts/architecture/own-machine-core-acceptance.test.ts`
- **Next:** KEEP adapters optional. Do not start Postgres authority (Step 9+).

### PORTABILITY LAW

- **Destination:** Runtime decisions must not depend on `*.railway.app`, `*.vercel.app`, or provider deployment IDs except inside an optional adapter.
- **Current:** Provider/node contract exists. Mac/Core split exists. Canonical listen-URL decisions call `resolveRuntimeEndpoint`. `RAILWAY_DEPLOYMENT` is not a dna-dev runtime_kind. Remaining `*.railway.app` is adapter JSONL, IAC, or email evidence.
- **Status:** **VERIFIED** (Step 7 listen-URL portability)
- **Next:** KEEP guard; do not copy hostnames back into Core TS.

---

## KEEP inventory

Verified present and canonical for their current job. Do not duplicate.

| Path | Why KEEP |
|---|---|
| `control/owner-command` | Canonical Owner ingress → envelope |
| `control/command-router` | Sole capability router; invokes permission |
| `control/command-status` | Lifecycle of the command |
| `control/machine-model` | Authority classification |
| `control/target-resolution` | Existing target resolver (not a second router) |
| `permissions/execution-policy` | Deterministic execution gate |
| `permissions/write-gate` | Deterministic mutation gate (CONTROL_PLANE checkout) |
| `permissions/network-auth-gate` | Network/auth bind policy |
| `software/repository-registry` | Durable repository identity + rebind + checkout resolution |
| `contracts/architecture/runtime-node-and-optional-provider.ts` | CURRENT node/provider vocabulary |
| `credentials/secret-resolver` | Portable Core secrets |
| `credentials/process-environment` | Explicit env map for Core |
| `control/runtime-control` | Fixed local service catalog (launchd + portable spawn) — not job workers |
| `software/registry-database` | Registry writer/lookup + store port |
| `connections/github` + connection-registry | SOURCE_AUTHORITY implementation |
| `transport/owner-command-http` | Current Core HTTP; migrate via adapter, do not delete first |
| `control/work-coordination` | Existing work claim/queue owner |
| `control/agent-gateway` | Task/work runtime for agents (not host process supervisor) |

---

## MIGRATE inventory

| Path / fact | Toward | Notes |
|---|---|---|
| `local-runtime/dna-dev-app-host/config.ts` Railway canonical URL | Runtime endpoint registration | **Step 7 DONE** — `resolveRuntimeEndpoint` |
| `control/production-checkpoint/remote-discovery.ts` `up.railway.app` | Same | **Step 7 DONE** |
| `control/production-checkpoint/railway-deploy.ts` hardcoded domains | Same | **Step 7 DONE** for listen URLs; GraphQL `ENVIRONMENT_ID` remains adapter |
| `software/capability-registrar/register-application-01.ts` Railway health URL | Endpoint resolution | **Step 7 DONE** |
| JSONL as live queue/state (`agent-gateway/data/tasks.jsonl`, many `data/*.jsonl`) | Postgres authority + JSONL evidence | After Step 8; extend store ports |
| Source-checkout execution (`npx tsx`, cwd = git root) | Signed release under `/opt/dna` or equivalent | After state authority |
| `credentials/secret-resolver` Railway mapping `RAILWAY_CORE_CREDENTIAL_REF` | Optional-adapter-only provider secrets | Do not remove mapping until Step 8 |
| `software/registry-database/connection-provider.ts` Keychain default | Portable Core DB credentials | Uses Mac Keychain constructor today |

---

## ADD inventory

Only after duplicate check. None of these exist as named Runtime V1 folders. **Extend** listed owners first.

| Destination concept | Existing owner (do not duplicate) | ADD later as |
|---|---|---|
| Runtime endpoint registry | production-checkpoint remote-discovery, dna-dev-app-host config, joint-monitor URLs | `control/runtime-endpoint-registry` **exists (Step 7 KEEP)** |
| Node registry / heartbeat | `control/machine-observation` (Mac), no Core node row | `control/node-registry` later |
| Durable runtime jobs | `control/work-coordination` claim API; agent-gateway tasks JSONL | Postgres implementation of **existing** claim port |
| Scheduler (due jobs, advisory lock) | `control/scheduler` is provider processing fabric — **different job** | New schedule tables later; do not overload `control/scheduler` without audit |
| Release / deploy | `control/deployable-artifact-readiness`, `execution/deploy` (plan only), `control/artifact-destination` | `control/release-control` later |
| Artifact / blob store | artifact-destination + deployable-artifact-readiness (project build artifacts, not content-addressed blobd) | `storage/artifact-store` later |
| Workload cgroup runtime | `PortableProcessSupervisor` (fixed services only) | `execution/workload-runtime` later |
| Runtime V1 HTTP `/v1/commands` | owner-command-http | `transport/runtime-v1-http` as adapter later |
| Infrastructure Driver | `connections/railway/` lifecycle-ish deploy | `drivers/` later; Railway stays optional adapter |
| DNA Git | GitHub SOURCE_AUTHORITY | After V1 stable; explicit migration event |

---

## RETIRE_CANDIDATE inventory

Nothing is `SAFE_TO_REMOVE`. Replacement not tested; consumers remain.

| Path | Conflict with V1 | Consumers | Replacement | Preconditions |
|---|---|---|---|---|
| Hardcoded `*.up.railway.app` in Core decision paths | Portability law | none remaining in canonical TS | `resolveRuntimeEndpoint` | **retired from Core TS**; adapter JSONL KEEP |
| `CANONICAL_TARGET.runtime_kind = RAILWAY_DEPLOYMENT` as default | Provider must not define runtime location | none | NODE_LOCAL / REGISTERED_REMOTE | **retired** |
| Comment in `postgres-store.ts` claiming live Pool in `server.ts` | False CURRENT claim | readers of the header | Correct comment later (not this task) | n/a — documentation drift |
| Destination Go `cmd/dna-*` tree | Would duplicate TS authority graph | none in this repo | not applicable | never adopt as CURRENT |
| `OTHER_AGENT` node kind | Placement forbids third kind until physical boundary exists | destination diagram only | process class | none |

---

## Duplicate-subsystem findings

| Destination name | Already exists as | Action |
|---|---|---|
| Job queue / SKIP LOCKED | `control/work-coordination` (`claimWork`, JSONL store) | MIGRATE store, do not ADD `execution/job-queue` until audit says this owner cannot extend |
| Agent supervisor | `control/agent-gateway/supervisor.ts` | KEEP; not host process supervisor |
| Host process supervisor | `control/runtime-control` (launchd + portable) | KEEP catalog; ADD workload-runtime separately |
| Scheduler | `control/scheduler` (AI/provider processing fabric) | Name collision — do not assume it is Runtime V1 due-job scheduler |
| Target resolution | `control/target-resolution` | KEEP; not node capability registry |
| Artifact | `control/deployable-artifact-readiness`, `control/artifact-destination` | KEEP; not blobd |
| Deploy plan | `execution/deploy` | KEEP plan resolver; not signed release activation |
| Registry database | `software/registry-database` | KEEP; activate Postgres implementation later |
| Provider identity | `software/provider-project-registry` | KEEP; not Runtime V1 node registry |
| Execution evidence | agent-gateway evidence JSONL, runtime-control operations.jsonl, write-gate evidence | KEEP streams; do not merge into one new evidence product |
| Source authority | GitHub connection type `SOURCE_AUTHORITY` | KEEP until explicit DNA Git event |

---

## Verified migration order

Derived from DESTINATION dependency, PLACEMENT, and this tree. Not implemented here.

1. **Architecture freeze (this folder)** — current vs destination labeled.
2. **Step 7 — runtime endpoint portability** — no `*.railway.app` in runtime *decisions* (adapter may still know Railway).
3. **Step 8 — Railway off critical path** — own-machine Core, same TS contracts.
4. **Runtime state authority** — Postgres shadow then cutover via existing store ports.
5. **Durable jobs** — claim/recovery on Postgres; existing work-coordination owner.
6. **Release split** — immutable artifact + activation; stop executing git checkout in production.
7. **Worker isolation** — cgroup/lease/timeout; heavy work off Core.
8. **Source independence** — DNA Git primary; GitHub mirror (explicit event).
9. **HA** — Core B boots same release + same Postgres.
10. **Region** — same protocol, more nodes.

Ordering check: endpoint portability does not need Postgres. HA needs state + release. Worker isolation should consume artifact refs, so it follows release. DNA Git must not silently replace GitHub SOURCE_AUTHORITY. **Do not start Postgres before Step 7** (Placement).

### Step 7 — REMOVE_RAILWAY_APP_RUNTIME_ASSUMPTIONS — **VERIFIED / COMPLETE**

Canonical listen-URL owner: `control/runtime-endpoint-registry/` (`resolveRuntimeEndpoint`). Owns **address resolution only**. Reuses `ServiceId` from `control/runtime-control` SERVICES. Does not own service/capability/repository/node/provider identity, credentials, permission, execution, deployment, supervision, or health authority.

Locals projected from SERVICES. REGISTERED_REMOTE rows live in `connections/railway/data/runtime-endpoints.jsonl` (OPTIONAL_PROVIDER_ADAPTER data).

**Caller inventory (source inspection, not tests alone):**

| Caller | Status |
|---|---|
| `local-runtime/dna-dev-app-host/config.ts` | MIGRATED |
| `control/production-checkpoint/remote-discovery.ts` | MIGRATED |
| `control/production-checkpoint/railway-deploy.ts` listen/health | MIGRATED (`ENVIRONMENT_ID` remains OPTIONAL_PROVIDER_ADAPTER) |
| `control/alert-correlation/resolve.ts` | MIGRATED |
| `software/capability-registrar/register-application-01.ts` | MIGRATED |
| `observability/joint-monitor/client.ts` | MIGRATED (`JOINT_MONITOR_URL` env first, else local resolver) |
| `dna-os-circuit/` | MIGRATED (no `*.railway.app`; not a listen-URL decision owner) |
| `software/system-graph/projection.ts` | MIGRATED (no provider listen domain) |
| `control/capability-route/` | MIGRATED (join over JSONL stores; no provider hostname) |

**Retirement evidence:** `RAILWAY_DEPLOYMENT` runtime_kind removed from dna-dev config; no canonical TS listen-URL constant of `*.railway.app`. Retired path has zero Core decision callers.

**Validation provenance (authoritative):** aborted full-repository domain-scan is **not** evidence. From that aborted job **only** `runtime-endpoint-registry` **14/14 PASS** may be cited. Narrowed Core/runtime-tree guard: **1,054 files, PASS**. All other Step-7 figures are independent later completed runs (see evidence table). Do not merge aborted-job totals.

Independent Step-7 suites (working-tree esbuild/CJS, cwd = repo root):

| Suite | Result | Provenance |
|---|---|---|
| runtime-endpoint-registry | 14/14 PASS | independent run; also the only aborted-job figure allowed |
| portability-domain-guard | PASS, 1056 files | independent 2026-09-11 (1054 before Step-8 files; 1056 after adding own-machine-core) |
| caller-migration | 15/15 PASS | independent |
| cross-repo HTTP freeze | 15/15 PASS | independent |
| runtime-node | 22/22 PASS | independent |
| portable-supervisor | 13/13 PASS | independent |
| secret-resolver | 16/16 PASS | independent |
| checkout-portability | 6/6 PASS | independent |
| network-auth-gate | 11/11 PASS | independent |
| dna-dev-app-host | 10 PASS / 4 FAIL | independent; C0–D3 require built `DNA DEV.app` launcher, not remaining coupling |
| core-node-macos-routes / owner-command | BUILD_FAIL | esbuild EPERM on write-gate `schg` — not unlocked |
| `tsc --noEmit` | 5× TS6053 | known protected write-gate files |

Railway adapter mutation/live tests are optional-provider; not merged into the Step-7 total. Deadboard / Control Workspace HTTP contracts unchanged (read-only sibling freeze).

### Step 8 — RAILWAY_OFF_CRITICAL_PATH / Own-Machine Core — **PROVEN** (not CANONICAL)

Live generic-Linux process of current `transport/owner-command-http/server.ts` (not a replacement HTTP server).

| Field | Evidence |
|---|---|
| Image | `node:22-bookworm` (Debian 12) |
| Kernel | Linux 6.12.76-linuxkit aarch64 |
| Node | v22.23.2 |
| Commit | `bf1658a3e52af223ecc0e832ffe62e6211c7b156` |
| Command | `npx tsx transport/owner-command-http/server.ts` |
| CWD | `/work` (repository checkout) |
| Env supplied | `OWNER_COMMAND_HTTP_SHARED_SECRET`, `HOST=127.0.0.1`, `PORT=8791` |
| Env absent | `RAILWAY_PROJECT_TOKEN`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_DEPLOYMENT_ID`, `VERCEL_TOKEN` |
| Harness | `contracts/architecture/own-machine-core-linux-live.sh` (ephemeral Docker; not DNA OS architecture) |

Write-gate `schg` files were not unlocked. The container mounts git-object overlay at `permissions/write-gate` only inside Linux.

`CHALLENGE_FILE` is no longer evaluated at `human-verification.ts` import time (Linux Core could not boot: `OWNER_AUTHORIZATION_STORE_UNRESOLVED:UNSUPPORTED_PLATFORM`). Mac Owner-auth still fail-closes when invoked.

Authenticated `POST /command` `"ตรวจ permission"` entered `submitOwnerCommand` → `routeOwnerCommand` → `runPermissionReasonerStep` → `evaluateExecutionPermission`. Result: `capability_id=permission-reasoner`, `decision=DENY`, `reason_codes=UNKNOWN_COMMAND`, `execution` not started (`status=BLOCKED`). Decision id `c43aa64d-945b-4625-8f1e-75ffffc04b5b`.

HTTP Core now passes existing `resolveEntryContext` into `RouteOptions` (same entry-context module, not a second permission engine). Unique `permission-reasoner` keyword matches may forward through the existing conversation MCP gate so POST `/command` reaches that path.

Mac-only: `POST /computer-use/owner/authenticate` and `POST /local/operation` → HTTP 503 `MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE`, `execution_attempted: false`.

SIGTERM on the Core process: **SIGTERM_OK** (~1s); listen port released; no leftover children. Conversation-runtime child is stopped from the existing SIGTERM handler.

This-session Linux independent suites (do not merge aborted full-repo scan):

| Suite | Result |
|---|---|
| runtime-endpoint-registry | 14/14 PASS |
| caller-migration | 15/15 PASS |
| portability-domain-guard | PASS, 1057 files |
| runtime-node | 22/22 PASS |
| portable-supervisor | 13/13 PASS |
| secret-resolver | 16/16 PASS |
| checkout-portability | 6/6 PASS |
| network-auth-gate | 11/11 PASS |
| own-machine-core-acceptance | 10/10 PASS |
| own-machine-core-linux-live.test.ts | evidence assertions (host) |

**Not CANONICAL.** Later destination work remains deferred.

**Acceptance:** composition harness remains. Live proof: `own-machine-core-linux-live.sh` + `own-machine-core-linux-live.test.ts`.

---

## Unresolved contradictions (recorded, not fixed)

1. `software/registry-database/adapters/postgres-store.ts` claims `server.ts` builds a live `pg.Pool`; `transport/owner-command-http/server.ts` has no such reference.
2. `control/runtime-control/resolver.ts` file header still describes launchd-only orchestration while the file imports `portableSupervisorActive`.
3. Placement audit vs this working tree: audit forbids calling Linux supervisor Done on **main**; this tree has portable spawn but **not** on origin/main and **not** cgroup/`dna-node`.
4. Destination diagram places Permission Engine above Router; CURRENT code has the router invoke permission.
5. `control/scheduler` name vs DESTINATION scheduler (due jobs / advisory lock).

---

## Confirmation

This document set records Step 7 COMPLETE and Step 8 PROVEN (not CANONICAL). It does not start Postgres authority, durable jobs, immutable releases, DNA Git, cgroup workers, HA, or region. Public Core HTTP paths (`POST /command`, `GET /owner/console`, `GET /task/:id`, `/runtime/inventory`, `/handoffs`) remain. GitHub stays SOURCE_AUTHORITY. Supabase stays DATA_SERVICE. Write-gate OWNER_LOCKED files were not unlocked.
