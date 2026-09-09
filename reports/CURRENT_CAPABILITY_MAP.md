# CURRENT CAPABILITY MAP — STALE READ-ONLY AUDIT

> This inventory is historical evidence, not current runtime truth. It predates
> the live loopback Owner Command transport and must not be used to claim that
> Owner input is unwired. Current runtime truth is `/runtime/inventory` plus
> `/state/current`, both carrying source revision evidence.

Scope: a factual, verified inventory of every capability reachable (or
claimed) from `control/owner-command/` → `control/command-router/` in
DNA-OS-INFRASTRUCTURE, as of 2026-08-16. Pure observation — no code
written, moved, wired, renamed, or deleted. The only writes made are this
file and `control/command-router/current-capability-map.json`.

Method: every folder under `ai/`, `audit/`, `config/`, `connections/`,
`contracts/`, `control/`, `execution/`, `governance/`, `permissions/`,
`software/` was listed and its actual file contents (not just folder
name) read. `control/command-router/capability-registry.ts` and
`control/command-router/router.ts` were read in full to determine actual
wiring. `reports/OWNER_COMMAND_ROUTER_REPORT.md` and
`reports/RESEARCH_ENGINE_CONNECTION_REPORT.md` were used as prior
evidence and cross-checked against current file contents (the registry
has moved since the first report — research-engine went from
NOT_CONNECTED to CONNECTED between the two rounds). `http://localhost:8787/api/research/health`
was curled live during this audit and returned `{"status": "ok"}`.

---

## PER-CAPABILITY RECORDS

The full set of records (capability_id, display_name, repo, folder,
responsibility, input_contract, output_contract, connection_type,
endpoint_or_adapter, permission_requirement, data_owner, runtime_owner,
status) for all 39 inventoried entries is in
[`control/command-router/current-capability-map.json`](../control/command-router/current-capability-map.json)
— that file is the machine-readable source of truth; this section
summarizes the same facts narratively, grouped by status.

### CONNECTED (3)

**`permission-reasoner`** — `permissions/execution-policy/`.
`evaluateExecutionPermission()` (via `permissions/execution-policy/contract.ts`)
is a real, tested (22/22) decision function returning ALLOW/DENY/OWNER_REVIEW.
This is the repo's OWN local execution-scope reasoner — explicitly NOT the
external `DNA-LAB-PERMISSION-REASONER` repo, which is not present here
(see `control/command-router/capability-registry.ts` inline comment and
`control/command-router/ARCHITECTURE_DECISIONS.md` §PERMISSION_REASONER).
Called from `control/command-router/router.ts`'s `runPermissionReasonerStep`
and `runExecutionStep`.

**`execution` (execution/run)** — `execution/run/`. `startExecution()`
(via `execution/run/contract.ts`) spawns a real allow-listed OS process,
tested (18/18). Structurally unreachable without a prior ALLOW decision
from permission-reasoner — `router.ts`'s `runExecutionStep` calls
`evaluateExecutionPermission` first, every time, no bypass path exists.

**`github`** — `connections/github/`. `handleGithubCommand()` (via
`connections/github/adapter-contract.ts` → `github-adapter.ts`) is a
real, read-only HTTP adapter for GitHub account status/access checks
(scoped to source-control metadata only — never file content or business
data, per `adapter-contract.ts` header). Wired via
`control/command-router/router.ts`'s `runGithubStep`.

**`research-engine`** — `connections/research-engine/`.
`fetchResearchEngineLatestResult()` does a live health check against
`http://localhost:8787/api/research/health` before ever calling
`/api/research/latest`, and always resolves (never throws) to a
`ResearchEngineStepOutcome`. Verified live during this audit: the health
endpoint responded `{"status": "ok"}`. Wired via
`control/command-router/router.ts`'s `runResearchEngineStep`. Note: the
registry's `health_status: "CONNECTED"` is a static "adapter exists and
is wired" fact, not a live-uptime guarantee — `router.ts` re-checks
liveness on every request and reports `BLOCKED` +
`RESEARCH_ENGINE_OFFLINE` if the real service goes down, independent of
this static field.

*(4 entries above; the JSON labels the underlying execution-run module
`execution-run` — 4 CONNECTED records total in the JSON file, matching
the registry's 4 CONNECTED entries: `permission-reasoner`, `execution`,
`github`, `research-engine`.)*

### CALLABLE_NOT_CONNECTED (0)

None found. Every capability that has a real callable contract/adapter in
this repo (`execution/run`, `permissions/execution-policy`,
`connections/github`, `connections/research-engine`) is already both
registered in `capability-registry.ts` AND has a dispatch branch in
`router.ts`'s `runStep()`. There is no case in this repo of "a real
contract exists but the router doesn't call it" — the router's own code
comment confirms this discipline: "CONNECTED but this router build has no
router wiring implemented" is a defensive branch, not an observed state
today.

### SOURCE_ONLY (34)

The overwhelming majority of the tree. Two sub-categories:

1. **Real logic/types but no external invocation surface**:
   `permissions/access-control/` (a real `isWithinOwnScope()` function
   plus Identity/Membership/BreakGlass type definitions — not imported by
   `control/command-router/` today), `permissions/software-scope/`
   (Account/Tenant/BusinessDomain/ResourceGrant types, explicitly
   "source-code-level model only, no database wired"),
   `software/software-registry/` and `software/workspace-registry/`
   (pure type definitions, no functions), `contracts/*` (pure wire-shape
   type definitions — real consumers exist for `command-envelope.ts`,
   `capability-result.ts`, `routing-result.ts`, and
   `envelope-identity.ts`; the rest — `connector/connection.ts`,
   `event/event-envelope.ts`, `operational-bridge/bridge.ts`,
   `software/`, still NOT_YET_BUILT), `control/owner-command/` and
   `control/command-router/` themselves (real, tested modules, but no
   runtime transport — CLI/HTTP/etc — wires actual Owner input into
   `submitOwnerCommand` yet, per `reports/OWNER_COMMAND_ROUTER_REPORT.md`
   NEXT_BLOCKERS #2), `control/command-status/` (a real lifecycle
   state-machine type, in-memory only).
2. **Folder contains only a README.md, literally no source file**:
   `ai/agent-registry/`, `ai/model-registry/`, `ai/model-router/`,
   `audit/ai-execution-audit/`, `audit/code-change-audit/`,
   `audit/command-audit/`, `audit/deployment-audit/`,
   `config/connection-settings/`, `config/environment/`,
   `config/feature-status/`, `connections/ai-providers/`,
   `connections/external-software/`, `connections/servers/`,
   `connections/supabase/`, `connections/vercel/` (has a README +
   `CHECKS_API_LIVE_TEST_PLAN.md` but still no adapter source file),
   `connections/vercel-drains/`, `connections/vercel-webhooks/`,
   `contracts/software/`, `execution/build/`, `execution/code-change/`,
   `execution/deploy/`, `execution/rollback/`, `execution/test/`,
   `governance/*` (five folders — documentation/rules only, explicitly
   "no mechanical check — enforced by author discipline only today"),
   `software/module-registry/`, `software/repository-registry/`.
   Every one of these READMEs literally states "ไม่มีไฟล์ source ในโฟลเดอร์นี้"
   (no source file in this folder) or an equivalent NOT_YET_BUILT marker.

### TEST_ONLY (0)

None found. Every module with tests (`execution/run/tests/`,
`permissions/execution-policy/tests/`, `connections/github/adapter.test.ts`,
`connections/research-engine/tests/`, `control/command-router/tests/`,
`control/owner-command/tests/`) has a real, non-test implementation file
backing it — tests exist alongside working modules here, not as the only
artifact.

### BLOCKED (0 as a static classification)

No capability is *currently* wired but non-functional. `research-engine`
*can* go BLOCKED at request time if `localhost:8787` goes down (verified
live and healthy during this audit, so not BLOCKED right now), and
`file-intelligence` returns a router-level BLOCKED result *if called*
(because it's NOT_CONNECTED) — but as a standing classification for this
inventory, "NOT_CONNECTED because the external repo doesn't exist" is
recorded as UNKNOWN, not BLOCKED, per the task's own status definitions
(BLOCKED = known to exist but non-functional; these are not confirmed to
exist at all).

### UNKNOWN (3)

- **`file-intelligence` (DNA-LAB-FILE-INTELLIGENCE)** — registered in
  `capability-registry.ts` with `contract: "not_yet_built"` and
  `endpoint: { kind: "not_yet_built" }`. No contract file, no adapter, no
  checked-out copy of the external repo found anywhere in this
  filesystem. Router returns `BLOCKED` if invoked (tested), but its
  underlying existence/reachability is UNKNOWN, not merely disconnected.
- **`DNA-LAB-PERMISSION-REASONER` (external repo)** — not registered
  under any `capability_id` at all (distinct from the in-repo
  `permission-reasoner` entry, which is this repo's own local module).
  No evidence of a checked-out copy anywhere.
- **Security Lab** — no folder, file, README, or registry entry anywhere
  in this repo references a "Security Lab" by that or a similar name.
  Zero evidence found either way.

`reports/REPO_AUDIT_7_REPOS.md` (a prior audit of 7 separate GitHub repos
under account t23598788-oss) confirms none of those 7 repos
(Downloads, nextjs, express-js-on-vercel,
mcp-with-next-js-and-descope, LINEOA, --index.jsx, camo) is
DNA-LAB-FILE-INTELLIGENCE, DNA-LAB-PERMISSION-REASONER, or a Research/Security
lab — consistent with treating those three as UNKNOWN rather than
confirmed-absent-forever.

---

## ROUTING MAP

Concrete trace for each CONNECTED capability, citing actual files/functions:

```
OWNER COMMAND → ROUTER → CAPABILITY → PERMISSION → DATA/RUNTIME DESTINATION → VERIFICATION → RESULT
```

### permission-reasoner
```
control/owner-command/owner-command.ts:submitOwnerCommand
  → control/command-router/router.ts:routeOwnerCommand
    → classifyCommand() matches capability_id "permission-reasoner"
    → runStep() dispatches to runPermissionReasonerStep()
      → permissions/execution-policy/contract.ts:evaluateExecutionPermission()
        [PERMISSION: this call IS the permission decision — no separate gate]
        → DESTINATION: pure in-process decision logic, no external I/O
        → VERIFICATION: permissions/execution-policy/tests/ (22/22 passing, per report)
        → RESULT: CapabilityResult{status: COMPLETED|OWNER_REVIEW|BLOCKED}
```
Front-door-to-transport gap: no CLI/HTTP wires real Owner text into
`submitOwnerCommand` yet, so this chain is real end-to-end in code but
not yet reachable from an actual human typing a command (UNKNOWN /
missing segment, honestly noted).

### execution (execution/run)
```
control/owner-command/owner-command.ts:submitOwnerCommand
  → control/command-router/router.ts:routeOwnerCommand
    → runStep() dispatches to runExecutionStep()
      → PERMISSION: permissions/execution-policy/contract.ts:evaluateExecutionPermission()
        [must return ALLOW or step returns BLOCKED/OWNER_REVIEW immediately — no bypass]
      → on ALLOW: execution/run/contract.ts:startExecution()
        → DESTINATION: a real spawned OS process, allow-listed command only
        → VERIFICATION: execution/run/tests/ (18/18 passing, per report)
        → RESULT: CapabilityResult{status mapped from ExecutionResult.status}
```
Same front-door gap as above (no transport into `submitOwnerCommand` yet).

### github
```
control/owner-command/owner-command.ts:submitOwnerCommand
  → control/command-router/router.ts:routeOwnerCommand
    → runStep() dispatches to runGithubStep()
      → PERMISSION: permission_requirement: "none" in registry; github-adapter.ts
        enforces its own internal account-scope check (not execution-policy)
      → connections/github/github-adapter.ts:handleGithubCommand()
        → DESTINATION: real github.com API, account t23598788-oss, read-only
        → VERIFICATION: connections/github/adapter.test.ts; OWNER_COMMAND_ROUTER_REPORT.md
          notes the router-level verification in this environment used a
          deterministic credential-rejection path, not a live network call
        → RESULT: CapabilityResult{status: COMPLETED|FAILED} via EventEnvelope/rejection
```

### research-engine
```
control/owner-command/owner-command.ts:submitOwnerCommand
  → control/command-router/router.ts:routeOwnerCommand
    → runStep() dispatches to runResearchEngineStep()
      → PERMISSION: permission_requirement: "none"; GET-only by construction
        (host-runtime.ts hostFetch has no method/body parameter — no write
        call is even expressible)
      → connections/research-engine/research-engine-adapter.ts:fetchResearchEngineLatestResult()
        → live health check: GET http://localhost:8787/api/research/health
          [VERIFIED LIVE during this audit: HTTP 200, {"status":"ok"}]
        → GET http://localhost:8787/api/research/latest
        → DESTINATION: external research-engine service process (not in this repo)
        → VERIFICATION: connections/research-engine/tests/adapter.test.ts (7/7 fake-fetch
          scenarios + 1 optional live smoke check, per report); re-verified live in this audit
        → RESULT: CapabilityResult{status: COMPLETED|BLOCKED (RESEARCH_ENGINE_OFFLINE)|FAILED}
```

### file-intelligence (UNKNOWN/not connected)
```
control/owner-command/owner-command.ts:submitOwnerCommand
  → control/command-router/router.ts:routeOwnerCommand
    → runStep() sees capability.health_status === "NOT_CONNECTED"
      → returns BLOCKED immediately, no call attempted
      → [UNKNOWN SEGMENT: no PERMISSION, DATA/RUNTIME DESTINATION, or
        VERIFICATION exists past this point — honestly marked UNKNOWN,
        not filled in]
```

---

## SUMMARY

### FRONT_DOOR
`control/owner-command/owner-command.ts:submitOwnerCommand()` is the one
Owner-facing entry point, calling
`control/command-router/router.ts:routeOwnerCommand()` — the only
capability boundary it is allowed to cross. No CLI, HTTP, or other
runtime transport currently calls `submitOwnerCommand` with real Owner
input; both modules are exercised only by their own hand-written test
suites (`control/owner-command/tests/`, `control/command-router/tests/`)
today.

### CURRENT_CAPABILITIES
39 capability records inventoried (see the JSON file for the full list):
1 container repo record, 2 control-surface records (owner-command,
command-router), 5 registry-defined router targets
(file-intelligence, permission-reasoner, execution, github,
research-engine — note: `execution` and `permission-reasoner` map to
real in-repo folders `execution/run/` and `permissions/execution-policy/`),
1 external-repo stub (DNA-LAB-PERMISSION-REASONER, unregistered),
1 Security Lab stub (no evidence found), plus 29 other real folders
walked across `ai/`, `audit/`, `config/`, `connections/`, `contracts/`,
`control/`, `execution/`, `governance/`, `permissions/`, `software/`.

### CONNECTED_CAPABILITIES
`permission-reasoner` (permissions/execution-policy/), `execution`
(execution/run/), `github` (connections/github/), `research-engine`
(connections/research-engine/, live-verified during this audit). All 4
have real tested contracts AND live router dispatch wiring in
`control/command-router/router.ts`.

### DISCONNECTED_CAPABILITIES
`file-intelligence` (registry entry exists, `endpoint.kind: "not_yet_built"`,
router returns BLOCKED without attempting a call) is the only capability
that is *registered but explicitly not connected*. Everything else that
is disconnected simply has no registry entry at all (the 34 SOURCE_ONLY
folders) or isn't present in this checkout (`DNA-LAB-PERMISSION-REASONER`,
Security Lab — both UNKNOWN).

### DUPLICATED_RESPONSIBILITIES
- **`execution/run/` vs `execution/test/` vs `execution/build/`** — all
  three ultimately "run a command against a piece of software," differing
  only in intent (generic allow-listed run vs. run-the-test-suite vs.
  run-a-build). `execution/run/` is real and generic; `execution/test/`
  and `execution/build/` are unbuilt stubs whose eventual responsibility
  could plausibly be implemented as thin wrappers over `execution/run/`
  rather than separate capabilities — flagged, not resolved.
- **`permissions/access-control/` vs `permissions/software-scope/` vs
  `permissions/execution-policy/`** — three separate "who can do what"
  systems exist in `permissions/`. `execution-policy/` is the only one
  actually wired to the router. `access-control/` (Identity/Membership/
  scope-check) and `software-scope/` (Account/Tenant/BusinessDomain)
  define overlapping concepts (both have a notion of "which
  account/scope can this identity act as") but neither is invoked by
  `control/command-router/` today — flagged as a potential overlap for a
  future round to reconcile, not resolved here.
- **`audit/command-audit/` vs `control/command-status/lifecycle.ts`** —
  both are concerned with "what happened to a Command and when." Only
  `lifecycle.ts` currently has real code (in-memory state machine);
  `audit/command-audit/` is a README-only stub whose stated purpose
  ("durable evidence written before responding") heavily overlaps with
  what `lifecycle.ts`'s `evidenced` stage already gestures at without a
  durable sink.
- **`software/repository-registry/` vs `software/software-registry/`
  vs `software/module-registry/`** — three nested granularities of "what
  is registered" (repo / software / module) with near-identical README
  language and no source in any of them; genuinely may not overlap once
  built, but worth a design pass before three registries are built in
  parallel.

### UNKNOWN_OWNERSHIP
`connections/supabase/` (README only, no adapter — data owner would be
whatever external Supabase project it eventually points at, no such
project registered anywhere), `permissions/software-scope/` (Account/
Tenant/BusinessDomain types with explicitly "no real database wired"),
`software/software-registry/` (no database wired), `file-intelligence`,
`DNA-LAB-PERMISSION-REASONER`, and Security Lab (all three fully external
and unverifiable from this checkout).

### MISSING_CONTRACTS
`file-intelligence` has no contract file at all (`capability-registry.ts`
literally sets `contract: "not_yet_built"`). `connections/supabase/`'s
README describes an intended CommandEnvelope-in/EventEnvelope-out
contract but no file implements it. `contracts/software/`,
`contracts/operational-bridge/bridge.ts`'s real transport, and every
`execution/{build,code-change,deploy,rollback,test}/` folder have no
contract file defining their input/output shape.

### MISSING_CONNECTIONS
`file-intelligence` (registered but not connected — the one explicit gap
in the registry itself). `DNA-LAB-PERMISSION-REASONER` and Security Lab
are not even registered, so there is no missing-connection *entry* for
them to point at, only a missing capability_id. `permissions/access-control/`
and `permissions/software-scope/` have real logic/types but no router
wiring — they are candidates for CALLABLE_NOT_CONNECTED once a real
contract/entry-point function is added and exposed, but today they don't
even have a single public contract file mirroring the
`execution/run/contract.ts` pattern, so they remain SOURCE_ONLY rather
than CALLABLE_NOT_CONNECTED.

### CURRENT_ROUTING_GRAPH
```
                         OWNER (human)
                              │
                              ▼
        control/owner-command/owner-command.ts
              submitOwnerCommand()
                [NO REAL TRANSPORT WIRES INTO HERE YET]
                              │
                              ▼
        control/command-router/router.ts
              routeOwnerCommand() → classifyCommand()
                              │
        ┌──────────┬──────────┬──────────┬──────────┬───────────────┐
        ▼          ▼          ▼          ▼          ▼               ▼
 permission-   execution   github   research-   file-intelligence  (unregistered:
  reasoner    (execution/ (connect-  engine     (NOT_CONNECTED,   DNA-LAB-PERMISSION-
 (permissions/   run/)     ions/     (connect-   endpoint.kind=    REASONER, Security
 execution-                github/)  ions/       "not_yet_built",  Lab — no path exists)
  policy/)                            research-   returns BLOCKED
                                       engine/)    without calling)
        │          │          │          │
   [in-process] [ALLOW-gated [github.com [http://localhost:8787
    decision     real OS      read-only   — VERIFIED LIVE during
    logic]       process]     API]        this audit]
```

### RECOMMENDED_CONNECTION_ORDER
(Recommendation only — not implemented, per task constraints.)

1. **Build a real transport into `control/owner-command/submitOwnerCommand`**
   (CLI first, matches this repo's "no framework deps" convention) — every
   other CONNECTED capability is inert until Owner text can actually
   reach the front door.
2. **Reconcile `permissions/access-control/` and
   `permissions/software-scope/` with `permissions/execution-policy/`**
   before building more registered capabilities — right now
   `execution-policy` is the only permission system the router actually
   calls; the other two overlap conceptually and should either be merged
   into it or given a clearly distinct, wired responsibility.
3. **Decide file-intelligence's real shape** (own repo vs. an
   in-repo module analogous to how `permission-reasoner` and
   `research-engine` were each resolved) before registering it as
   anything other than `NOT_CONNECTED` — follow the same
   "read the real contract, register honestly" discipline used for the
   prior two rounds.
4. **Only after (1)-(3):** consider `connections/supabase/`,
   `connections/vercel/`, `execution/{test,build,deploy,rollback,code-change}/`
   — each needs its own contract file and adapter before it can move past
   SOURCE_ONLY, and `execution/code-change/` in particular is flagged by
   its own README as the highest-risk capability in the system and should
   be last, with `governance/` rules given real mechanical enforcement
   (currently "discipline only") before it is connected.
5. **Add a durable audit sink** (`audit/command-audit/`,
   `execution/run/audit.ts`'s own stated gap) before any of the above go
   live for real Owner traffic — today `control/command-status/lifecycle.ts`
   is in-memory only, so no CONNECTED capability's outcome currently
   survives a process restart.
