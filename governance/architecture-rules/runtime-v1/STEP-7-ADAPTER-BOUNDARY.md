# Step 7 — adapter boundary audit and reversible cut plan

**role:** PLAN only. Not executable law. Not an implementation.

**audited:** 2026-09-11  
**constraint:** no adapter move/delete; no runtime behavior change; no sibling-repo edits; no route/port/secret/envelope/permission-order/repository-id changes.

Desired shape (unchanged from CURRENT-MAP):

```
CORE / canonical runtime
        ↓
provider-neutral contracts  (resolveRuntimeEndpoint)
        ↓
optional provider adapters  (Railway / Vercel / future)
```

Railway remains `OPTIONAL_PROVIDER`. Step 7 removes provider identity from **canonical runtime decisions**, not provider support.

---

## 1. Repositories inspected (read-only)

| Repo | Identity | Checkout used | Role |
|---|---|---|---|
| DNA-OS-INFRASTRUCTURE | this working tree | `/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE` | producer of Core HTTP, adapters, IAC |
| Deadboard | `repository://t23598788-oss/---------------DNA-OS` | `/Users/tam/Desktop/dna-os-deadboard` (registry `repository_root` **exists**) | Owner UI → `/api/infra-command` |
| Control Workspace | `repository://t23598788-oss/dna-os-control-workspace` | Registry root `/Users/tam/Desktop/dna-os-control-workspace` **does not exist**. Live source inspected: `/Users/tam/Developer/DNA-OS/source/dna-os-control-workspace` | Product proxy `:5181` → Core `:8791` |
| Other Desktop `DNA-OS-INFRASTRUCTURE-*` / LAB clones | registry / recovery | reference-only | do not modify |

**Inventory fact (not a code fix):** Control Workspace’s registered `repository_root` is stale vs the live launchd/knowledge checkout. Step 7 must not “fix” that by changing repository identity.

Operational siblings that participate in **runtime/control HTTP** are Deadboard and Control Workspace. MCP (`connections/dna-os-mcp`) is **internal** to Infrastructure (port 8793).

---

## 2. Cross-repo consumer graph

| Consumer repo | Consumer file | Contract used | Infrastructure producer | Neutral vs provider | Migration risk |
|---|---|---|---|---|---|
| Deadboard | `app/api/infra-command/route.ts` (UI: `components/workspace/OwnerCommandSection.tsx`) | `POST {INFRA_OWNER_COMMAND_URL\|\|http://127.0.0.1:8791}/command` JSON `{commandText, workOrder?, ownerIdentity:{id,email}}` header `Authorization: Bearer ${INFRA_OWNER_COMMAND_SHARED_SECRET}` after Supabase `requireAuth(ADMIN_TIER)` | `transport/owner-command-http/server.ts` `POST /command`; secret env `OWNER_COMMAND_HTTP_SHARED_SECRET`; bind `evaluateBindPolicy` | **Provider-neutral loopback.** Repo-wide search found **no** `*.railway.app` and **no** `OWNER_COMMAND_HTTP_*` in Deadboard | **HIGH** if path/port/header/body renamed. Env **names** differ (`INFRA_*` vs `OWNER_COMMAND_HTTP_*`) |
| Deadboard | `app/api/infra-console/route.ts` | `GET {same base}/owner/console?limit=50` (ADMIN_TIER; no Bearer on this hop) | owner-command-http `/owner/console` | Neutral loopback | **KEEP_STABLE** |
| Deadboard | `app/api/infra-task/[taskId]/route.ts` | `GET {same base}/task/:taskId` | owner-command-http `/task/:id` | Neutral loopback | **KEEP_STABLE** |
| Deadboard | `app/api/admin/agent-operations/route.ts` | `GET {same base}/runtime/inventory`, `/handoffs`, `/task/:id` | same transport | Neutral loopback | **KEEP_STABLE** read hops; not the write Owner command |
| Control Workspace | `core-connection/core-client.mjs` | Browser → Product only (`/api/core/*`) | Product `server/server.mjs` `:5181` | Neutral | UI must not learn Core host |
| Control Workspace | `server/core-endpoints.mjs` | `DNA_OS_CORE_URL` default `http://127.0.0.1:8791`; `DNA_OS_JOINT_MONITOR_URL` default `http://127.0.0.1:5178`; maps `/api/core/command` → Core `/owner/command`; `/api/core/owner/submit-command` → `/owner/submit-command`; probes `/health`, `/graph/system`, `/runtime/inventory`, `/capability/route/…` | same transport + `control/capability-route` + joint-monitor | Neutral loopback defaults | **HIGH** if Core paths change. Product port **5181** is in `control/runtime-control` as MAC_LOCAL_AGENT |
| Control Workspace | `server/core-proxy.mjs` | `coreRequest` — **no Authorization header** | loopback bind may allow missing secret (`network-auth-gate`) | Neutral | KEEP loopback policy; do not require CW to send a secret unless bind host changes |
| Infra MCP | `connections/dna-os-mcp` | `DNA_OS_HTTP_BASE_URL` / 8791 + `OWNER_COMMAND_HTTP_SHARED_SECRET` | owner-command-http | Neutral | Internal |
| Joint reporters (Core processes) | `observability/joint-monitor/client.ts` | `JOINT_MONITOR_URL` default `http://127.0.0.1:5178`, `JOINT_MONITOR_SHARED_SECRET` | joint-monitor server | Default local; **IAC injects Railway public URL** | KEEP env names; literals in TS decision code must move |

**Canonical Owner path (KEEP_STABLE):**

```
Deadboard / Owner UI
  → authenticated POST /api/infra-command
  → Infrastructure POST /command on 127.0.0.1:8791
  → command router
  → capability
```

Control Workspace is a **second** Owner-adjacent path (`/owner/command`, `/owner/submit-command`). Do not collapse or rename either in Step 7.

**Ports (do not change):** 8791 Core HTTP; 8790 circuit local; 5178 joint-monitor default; 8793 MCP; 5181 Control Workspace.

---

## 3. Provider-specific code inventory (by callers, not filename)

| Location | Class | Callers / meaning |
|---|---|---|
| `connections/railway/` (`invokeRailwayConnector`, GraphQL `backboard.railway.com`, `RAILWAY_ENVIRONMENT_ID`) | **A OPTIONAL_PROVIDER_ADAPTER** | `connector-execution-boundary/registry.ts`, `production-checkpoint/remote-discovery.ts`, `railway-deploy.ts`, `mcp-provider.ts` |
| `.railway/railway.ts` | **B IAC / DEPLOYMENT CONFIG** | Hardcodes `JOINT_MONITOR_PUBLIC_URL`; injects into owner-command-http and dna-os-circuit |
| `control/production-checkpoint/remote-discovery.ts` `HISTORICAL_SERVICES` | **C RUNTIME_DECISION_COUPLING** | Literal `*.up.railway.app` as `runtime_url_ref` / health |
| `control/production-checkpoint/railway-deploy.ts` domain map + `/circuit.json` URL | **C** (URL selection) + **A** (invoker) | Split later: mutation stays in adapter |
| `local-runtime/dna-dev-app-host/config.ts` | **C** | `CANONICAL_TARGET.url` Railway; `runtime_kind: "RAILWAY_DEPLOYMENT"` as default placement |
| `software/capability-registrar/register-application-01.ts` | **C** | Stamps `runtime_health:https://joint-monitor-production.up.railway.app/health` + `RAILWAY_BUILD` |
| `observability/joint-monitor/client.ts` | Default **neutral**; production via **env/IAC** | Tests use loopback |
| owner-backbone / incident `notify.railway.app` | **D OBSERVABILITY / EVIDENCE** | Email filter, not command routing |
| `credentials/process-environment` `RAILWAY_CORE_CREDENTIAL_REF` / `RAILWAY_PROJECT_TOKEN` | **E CREDENTIAL MAPPING** | KEEP in adapter/mapping |
| `connections/vercel/` | **F** + NOT_YET_BUILT | README / plan |
| `control/infrastructure-billing` `collectVercel` | **A** read-only cost | KEEP; G-ARCH-001 forbids charges APIs |
| `execution/deploy` Vercel BLOCKED | **F** / gate | Not a live Vercel runtime URL |
| `connections/railway/RAILWAY_CONNECTION.md` | **F** | Identity facts; mutation section **stale** vs `railway-deploy.ts` |
| `control/self-resource/declarations.ts` `railway.app` must_contain | **D** / census | |
| `software/provider-project-registry` Railway environment UUID | **A** identity store | Not a listen-URL owner |

---

## 4. Adapter public interfaces

| Interface | Callers | Credential | Endpoint | Health | Evidence/status | Tests | Sibling consumers | Mark |
|---|---|---|---|---|---|---|---|---|
| `getConnectorInvoker("railway")` / `invokeRailwayConnector` | connector registry, remote-discovery, railway-deploy | Keychain / process-env `RAILWAY_PROJECT_TOKEN` | `https://backboard.railway.com/graphql/v2` | GraphQL reachability | `ConnectorBoundaryOutcome` | `control/production-checkpoint/tests/railway-deploy-mutation.test.ts`, `railway-provider-live.test.ts` | none | **KEEP_STABLE** |
| Allowed intents (`railway.environment_status`, list/get, deploy/redeploy) | same | same | same | same | artifacts | same | none | **KEEP_STABLE** |
| Deadboard `POST /command` + Bearer | `infra-command/route.ts` | `INFRA_OWNER_COMMAND_SHARED_SECRET` ↔ `OWNER_COMMAND_HTTP_SHARED_SECRET` | `127.0.0.1:8791/command` | Core `/health` | JSON `{ok,…}` | owner-command + network-auth tests | Deadboard | **KEEP_STABLE** |
| Control Workspace `/api/core/*` + `DNA_OS_CORE_URL` | `server.mjs`, `core-endpoints.mjs` | none on proxy (loopback) | `/owner/*`, `/health`, `/graph/system`, `/capability/route` | probes in ENDPOINTS | Core bytes unchanged | sibling tests not in this checkout | Control Workspace | **KEEP_STABLE** |
| `JOINT_MONITOR_URL` / `JOINT_MONITOR_SHARED_SECRET` | joint-monitor client; IAC | shared secret | default loopback; IAC may set public URL | `/health` `/joints` | joints | `observability/joint-monitor/tests/*` | CW `DNA_OS_JOINT_MONITOR_URL` | **KEEP_STABLE** (env contract; values via IAC) |
| `resolveLaunchTarget` / `CANONICAL_TARGET` | dna-dev-app-host build | n/a | hardcoded Railway URL | live GET cited in evidence strings | launcher stamp | `local-runtime/dna-dev-app-host/tests/dna-dev-app-host.test.ts` | none (desktop artifact) | **WRAP** then **MIGRATE_CALLER** |
| `collectVercel` | infrastructure-billing | Vercel CLI auth.json | Vercel REST read | n/a | BillingRecord | billing tests if present | none | **KEEP_STABLE** |
| Vercel deploy connector | none live | — | — | — | — | — | none | **RETIRE_LATER** not allowed — **UNKNOWN** until callers proven; treat as **KEEP** unused |

Nothing is **RETIRE_LATER**. Callers of Railway GraphQL and sibling HTTP are proven; unused Vercel runtime adapter is not proven empty of future IAC, so it stays.

---

## 5. KEEP_STABLE (Step 7 must not rename)

- `POST /command`, `POST /owner/command`, `POST /owner/submit-command`, `GET /health`, `GET /owner/console`, `GET /task/:id`, `GET /runtime/inventory`, `GET /handoffs`
- Ports 8791 / 8790 / 5178 / 8793 / 5181
- Headers `Authorization: Bearer …`
- Env names: `OWNER_COMMAND_HTTP_SHARED_SECRET`, `INFRA_OWNER_COMMAND_URL`, `INFRA_OWNER_COMMAND_SHARED_SECRET`, `DNA_OS_CORE_URL`, `DNA_OS_JOINT_MONITOR_URL`, `JOINT_MONITOR_URL`, `JOINT_MONITOR_SHARED_SECRET`
- Command envelope / `ownerIdentity` attribution shape
- `getConnectorInvoker("railway")` intent names
- Repository ids in `software/repository-registry`
- Permission evaluation **inside** the command router (do not reorder)

---

## 6. Provider-specific runtime-decision couplings (Step 7 migrate)

These are the only **C** items that make Core *decide* placement by provider domain/enum:

1. `local-runtime/dna-dev-app-host/config.ts` — `RAILWAY_DEPLOYMENT` as canonical placement + `*.up.railway.app`
2. `control/production-checkpoint/remote-discovery.ts` — `HISTORICAL_SERVICES` Railway URLs
3. `control/production-checkpoint/railway-deploy.ts` — hardcoded production domains after/alongside invoker
4. `software/capability-registrar/register-application-01.ts` — joint-monitor Railway health stamp + `RAILWAY_BUILD` as placement truth

IAC (`.railway/railway.ts`) and GraphQL adapter may keep Railway facts.

---

## 7. Existing endpoint-owner candidates

| Candidate | Can it own RuntimeEndpointRegistration? |
|---|---|
| `connections/connection-registry` | **No as-is.** Connection/source identity. Railway row is **GraphQL backboard**, not hosted-app HTTP. |
| `control/runtime-control` SERVICES | **No.** Local process catalog (ports/plist/spawn), not public URL placement. |
| `control/machine-observation` runtime-targets | **No.** `OBSERVE_ONLY` by type; not a control-plane resolver. |
| `control/production-checkpoint` discovery | **No as-is.** Railway-historical remote production binding. |
| `control/target-resolution` | **No.** `REGISTRY_ROW` / `GIT_SOURCE_LOCATION`. |
| `software/system-graph` | **No.** Projection; no Railway URL owner. |
| `local-runtime/dna-dev-app-host` | Launch-target for DNA DEV UI only; enum is provider-coupled. |
| `software/provider-project-registry` | Provider **project** identity, not listen URLs. |
| `control/capability-route` | **Join, not store.** Can *consume* endpoint rows; cannot be the write owner. Fail-closes on ambiguous local+remote without a selection rule. |

---

## 8. Is a new endpoint registry required?

**Do not create a second connection registry or second repository registry.**

**Preferred:** do **not** add `control/runtime-endpoint-registry/` as a fourth identity store if a thin **resolver** can sit on:

- **NODE_LOCAL** rows from `control/runtime-control` / machine-observation host+port (loopback listen)
- **REGISTERED_REMOTE** rows as a **new connection_type** (e.g. hosted HTTP of dna-os-circuit / joint-monitor), registered by the Railway adapter, **distinct** from `DEPLOYMENT_PLATFORM` GraphQL

`resolveRuntimeEndpoint(endpoint_id | capability)` = `control/capability-route` **plus** an explicit prefer-NODE_LOCAL policy so local+remote is not `RUNTIME_BINDING_AMBIGUOUS`.

**When a new folder *is* required:** if adding hosted-HTTP rows to connection-declarations would conflate GraphQL provider API with listen URLs, or if capability-route’s fail-closed join cannot carry `source: NODE_LOCAL | REGISTERED_REMOTE` without violating “no store.” Then add **one** small store under `control/runtime-endpoint-registry/` whose **only** job is listen-URL registration; Railway adapter **registers**; Core **resolves**. Placement DOCX already allowed that folder — use it only after the overload check fails.

**This audit’s recommendation:** start Step 7 implementation by **extending capability-route + connection-declaration type**, not by creating the folder first. Record `MISSING` until the first cut lands.

---

## 9. Compatibility risks

| Risk | Why | Mitigation in Step 7 |
|---|---|---|
| Deadboard `/command` vs CW `/owner/command` | Two proven hops | KEEP both |
| Secret env name split | Deadboard `INFRA_*` vs Core `OWNER_COMMAND_HTTP_*` | Do not unify names |
| CW proxy sends no Bearer | Loopback bind allows missing secret | Do not bind Core to non-loopback in this step |
| dna-dev-app-host tests **assert** Railway default | Tests encode coupling | Update tests **with** WRAP, same cut |
| IAC still injects Railway joint-monitor URL | Correct for OPTIONAL_PROVIDER deploy | KEEP IAC; Core reads env, not literals |
| Control Workspace Desktop vs Developer path | Registry stale | Inventory only |
| `RAILWAY_CONNECTION.md` mutation NOT_WIRED | Docs lag `railway-deploy.ts` | Do not retire adapter from the doc |

---

## 10. Exact reversible Step-7 cuts

Each cut is independently reversible (revert the commit / restore the previous resolver backing data).

**CUT 1** — Introduce provider-neutral `resolveRuntimeEndpoint` with **backing data copied from current Railway literals** (same URLs as today). No caller change. Behavior unchanged.

**CUT 2** — Migrate **one** caller: `local-runtime/dna-dev-app-host/config.ts` literal URL + `RAILWAY_DEPLOYMENT` enum → resolver (`REGISTERED_REMOTE` until Step 8). Keep `LOCAL_TARGET` as explicit opt-in `NODE_LOCAL` `http://127.0.0.1:8790`.

**CUT 3** — Run existing Railway adapter tests + dna-dev-app-host tests + owner-command + network-auth-gate. Confirm Deadboard/CW contracts **unchanged** (file evidence, not rename).

**CUT 4** — Migrate `remote-discovery.ts` `HISTORICAL_SERVICES` URL fields → resolver (keep Railway invoker for GraphQL discovery).

**CUT 5** — Migrate `railway-deploy.ts` domain map / circuit.json URL → resolver; invoker stays.

**CUT 6** — Migrate capability-registrar health stamp → resolver; `RAILWAY_BUILD` remains a **revision source** enum in revision reporting, not placement truth.

**FINAL CUT** — Grep canonical decision paths: no `*.railway.app` / `*.vercel.app` / Railway env/deployment ids / `RAILWAY_DEPLOYMENT` as placement. `connections/railway` tests still pass. Sibling routes/ports/secrets unchanged.

**Out of Step 7:** Postgres, release, DNA Git, deleting IAC, taking Railway off the critical path (Step 8), changing Owner path.

---

## 11. Validation matrix (run BEFORE implementation)

### Infrastructure (this checkout)

| Area | Evidence / test |
|---|---|
| Endpoint / discovery | `control/production-checkpoint/tests/` (incl. railway-provider-live, railway-deploy-mutation); capability-route `control/capability-route/tests/route.test.ts` |
| Production checkpoint | same folder |
| Railway adapter | `getConnectorInvoker("railway")` tests above; secret-resolver `credentials/secret-resolver/tests/core-node-secret-resolver.test.ts` (graphql import) |
| Network auth | `permissions/network-auth-gate/tests/policy.test.ts` |
| Owner command | `control/owner-command/tests/`; transport owner-command-http tests |
| Joint monitor | `observability/joint-monitor/tests/*` |
| Runtime-node | `contracts/architecture/runtime-node-and-optional-provider.test.ts` |
| Portable supervisor | `control/runtime-control/tests/portable-supervisor.test.ts` |
| Secret resolver | `credentials/secret-resolver/tests/core-node-secret-resolver.test.ts` |
| DNA DEV host | `local-runtime/dna-dev-app-host/tests/dna-dev-app-host.test.ts` |

`npx tsx` is currently broken in this environment (`fe.transformSync`); use the repo’s esbuild CJS test runner as already used for other proofs.

### Cross-repo (cannot execute sibling tests from this checkout)

| Consumer | Validate instead |
|---|---|
| Deadboard | File contract: `app/api/infra-command/route.ts` — URL default, `/command`, Bearer, body keys |
| Control Workspace | `server/core-endpoints.mjs` ENDPOINTS list + `DNA_OS_CORE_URL`; `server.mjs` path map; `core-proxy.mjs` no rewrite of Core JSON |

---

## 12. Gap-map updates

See `gap-map.yaml` key `provider_separation` (actions: KEEP / WRAP / MOVE_BEHIND_INTERFACE / MIGRATE_CALLER / RETIRE_CANDIDATE). Status vocabulary unchanged.

`DEST_RUNTIME_ENDPOINT_REGISTRY` remains `MISSING` until CUT 1 exists; next_action is extend capability-route + declarations first.

---

## 13. Confirmation

This task writes **only** Runtime V1 documentation under `governance/architecture-rules/runtime-v1/` (and the architecture-rules index pointer). No adapter, transport, sibling, OWNER_LOCKED, or runtime file is modified.
