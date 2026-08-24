# OLD CONTROL PLANE DEEP AUDIT

Scope: `app/api/admin/ide/_lib/` in the OLD repo
(`/Users/tam/Desktop/DNA OS-ต้นฉบับ /dna-os-deadboard`) — 115 TypeScript files
(~34,900 lines) — plus its callers (170+ `app/api/admin/ide/**/route.ts`
files, `app/api/admin/system-reality/_lib/gapLoopBridge.ts`, and
`scripts/*.ts` test/proof suites).

Mode: READ-ONLY. Methodology: every file's exports and local (`./`) imports
were extracted; a repo-wide reference index was built for every
`_lib/<file>` mention outside `_lib/` itself (route files, scripts,
components, other admin subsystems); each file's live-route wiring was then
confirmed by checking whether any `route.ts` file imports it, and
cross-checked against direct reads of the highest-value files (execution
engine, deployment/build/test runtimes, owner-command routes, worker
adapters, cost/usage runtimes, auth wiring, and provider-SDK usage
grep across the whole `_lib/` tree). This is graph/evidence-based
classification, not a line-by-line manual read of all 115 files — treat
per-file purpose descriptions as directionally reliable, verified for the
~30 highest-caller-count files, heuristic for the rest.

Date: 2026-08-16

---

## 1. TOTAL_LIB_FILES

**115** `.ts` files under `app/api/admin/ide/_lib/` (including
`workerAdapters/` (6 files) and `externalDiscoveryAdapters/` (3 files)
subfolders), totaling ~34,943 lines.

---

## 2. LIVE_RUNTIME_FILES

**70 of 115 files** are imported by at least one `app/api/admin/ide/**/route.ts`
(directly reachable in production behind `requireAuth(ADMIN_TIER)`).
Highest-value ones, with real route counts found:

| File | Route callers | Real capability |
|---|---|---|
| `artifactRuntime.ts` | 22 | Evidence/artifact generation — real, in-memory, bounded history |
| `factoryWorkspaceRuntime.ts` | 19 | Central orchestration state machine for the Factory Workspace tab; also backs `owner-command` auto-orchestration |
| `changeSetRuntime.ts` | 14 | Real file change-set tracking |
| `queueRuntime.ts` | 15 | Real in-memory job queue |
| `buildRuntime.ts` | 11 | **Real** — runs actual `npm run build`/lint/typecheck via `executionRuntime.ts`'s allowlisted `execFile` (shell:false), not simulated |
| `inspectionRuntime.ts` | 10 | Real Problems-panel inspection engine |
| `browserInspectionRuntime.ts` | 9 | Real UI-inspection/screenshot capability |
| `gitReadOnly.ts` | 8 | Real read-only `git` via `execFile` (status/diff/log/blame only — no mutation) |
| `codeWorkerRuntime.ts` | 7 | Real AI code-worker dispatch |
| `monitoringRuntime.ts` | 7 | Real in-memory signal aggregation across the other runtimes below |
| `executionRuntime.ts` | 6 | **Real** — the actual command-execution engine: `commandId` → fixed `argv` via `executionRegistry.ts`, `spawn(shell:false)`, redacted/ANSI-stripped output |
| `governanceRuntime.ts` | 6 | Real rule/gate evaluation |
| `incidentRuntime.ts` | 6 | Real incident tracking |
| `recoveryRuntime.ts` | 6 | Real recovery **plan** tracking — plans only, `executionStatus` honestly `NOT_IMPLEMENTED` |
| `releaseRuntime.ts` | 6 | Real release-readiness aggregation, reuses build/test/change-set |
| `testRuntime.ts` | 5 | Real test-run tracking, drives allowlisted test commands via `executionRuntime.ts` |
| `executionRegistry.ts` | 5 | Command allowlist: `commandId → {executable, fixedArgs}` — the single source of truth for what `executionRuntime.ts` may spawn |
| `buildRegistry.ts` | 5 | Build-type/environment-profile config registry |
| `deploymentRuntime.ts` | 2 | Real deploy-**plan** lifecycle (`deployment/plans/*` routes); every plan is gated/`BLOCKED` — no external Vercel/Supabase deploy call exists anywhere in this file or its imports |
| `providerRegistryRuntime.ts` | 1 | Provider/connector descriptor reconciliation (types/name mapping for anthropic/openai/digitalocean/etc.) — no live external API calls itself |
| `commandSurfaceRuntime.ts` | 2 | Owner Command Surface fast-path intent router (`/api/admin/ide/command`, `/owner-command`) |
| `workerSelectorRuntime.ts` | 5 | Real dispatch of a task to one of 8 worker adapters (see §7) |

Full LIVE_RUNTIME set (70 files, routecallers≥1) also includes:
`acceptanceContractRuntime` is LIVE_SUPPORT not LIVE_RUNTIME (see §3);
the remaining ~50 LIVE_RUNTIME files are the rest of the `*Runtime.ts` /
`*Registry.ts` pairs for artifact, capability, context, execution-context,
execution-plan, factory-completion, factory-readiness-gate, global-factory,
inspection-registry, monitoring-registry, queue-registry, recovery-registry,
release-registry, restore-test, security-execution, security-defense,
switch-based-orchestrator (routed at 0 in the isolated check but confirmed
LIVE_SUPPORT below — see note), operational-map, capability-resolver,
intent, autosave, editor-workspace-confirm, domain-asset, trash, tree,
search, standards, viewport-registry, decisions, problems, classification,
digital-forensics, external-attack-surface, security-knowledge, and
security-target files — each independently confirmed to have ≥1 real
`route.ts` importer via repo-wide grep.

---

## 3. LIVE_SUPPORT_FILES

**35 of 115 files** have **zero** direct `route.ts` importers but are
imported by another `_lib/` file that IS a LIVE_RUNTIME file (or, in one
case, by a live consumer outside `/admin/ide` entirely) — real code,
correctly load-bearing, just one hop removed from the HTTP boundary:

`acceptanceContractRuntime.ts`, `alertRegistry.ts`, `backupRegistry.ts`,
`capabilityRegistryRuntime.ts`, `capabilitySymbolResolutionRuntime.ts`,
`costGateRuntime.ts`, `deploymentRegistry.ts` (imported by
`deploymentRuntime.ts`), `evidenceCollectorRuntime.ts`,
`factoryCompletionRegistry.ts`, `gapLoopRuntime.ts`, `incidentRegistry.ts`,
`managerQuestionRuntime.ts`, `registryWriterRuntime.ts` (imported by
`app/api/admin/system-reality/_lib/gapLoopBridge.ts` via absolute `@/`
import, plus 25+ `scripts/*-submit-handoff.ts` proof scripts —
real evidence/finding writer, cross-subsystem, not `/admin/ide`-only),
`restoreTestRegistry.ts`, `reviewRegistry.ts`, `securityKnowledgeRegistry.ts`,
`securityTargetRuntime.ts`, `switchBasedOrchestratorRuntime.ts`,
`systemRealityRuntime.ts`, `targetPolicy.ts`, `testRegistry.ts`,
`usageMeterRuntime.ts`, `workerAdapter.ts` (shared adapter type contract),
`workerTaskOrchestrator.ts`, `searchPreAiGate.ts` (imported by
`commandSurfaceRuntime.ts`), `threatPatternRegistry.ts` (imported by
`securityDefenseRuntime.ts`), and the 6 files in `workerAdapters/`
(`apiWorkerAdapter.ts`, `cliWorkerAdapter.ts`, `digitalOceanWorkerAdapter.ts`,
`humanWorkerAdapter.ts`, `localModelWorkerAdapter.ts`,
`mcpWorkerAdapter.ts` — all imported only by `workerSelectorRuntime.ts`,
which is itself LIVE_RUNTIME) and the 3 files in `externalDiscoveryAdapters/`
(`dnsVerificationRuntime.ts`, `httpxAdapter.ts`, `subfinderAdapter.ts` —
imported only by `externalAttackSurfaceRuntime.ts`, itself LIVE_RUNTIME).

**Correction to an earlier/parallel draft of this same report found already
on disk at this path:** that draft claimed `usageMeterRuntime.ts`,
`costGateRuntime.ts`, `costLedgerViewRuntime.ts`, `alertRuntime.ts`, and
`monitoringRuntime.ts` have "real Supabase writes" and are "route-wired."
Verified false: a repo-wide grep for `@supabase` across all of
`app/api/admin/ide/_lib/` returns exactly **one** hit
(`factoryCompletionRuntime.ts`, a documentation/evidence statement, not a
live client import), and `usageMeterRuntime.ts`/`costGateRuntime.ts` have
**zero** `route.ts` importers (confirmed by direct grep of
`app/api/admin/ide/**/route.ts`, including `workers/budget/route.ts`, which
actually imports `executionBudgetRuntime.ts`, a different file). Cost/usage
tracking in the old repo is real **in-memory** logic, one hop from any HTTP
route, not Supabase-backed. This is corrected throughout this report.

---

## 4. LEGACY_FILES

**0 files** inside `_lib/` itself were found to be a clear
superseded-duplicate of another file in the same directory (no
`file 2.ts`-style literal duplicates, unlike elsewhere in the old repo —
see `app/api/admin/infrastructure/github/route 2.ts` and `.vercelignore 2`,
which are outside this audit's `_lib/` scope but were flagged by the prior
top-level audit). "Legacy" in the sense of *this repo vs. the new repo* is
covered in §9/§10 instead — nothing in `_lib/` is legacy relative to
`_lib/` itself.

---

## 5. ORPHAN_FILES

**1 file**: `openCapabilityArchitecture.ts` — a repo-wide grep for the
literal string `openCapabilityArchitecture` (its own filename/exports)
returns **zero** matches anywhere else in the entire old repo, including
`_lib/` itself, `scripts/`, and all routes. No caller of any kind. Read
independently to confirm: it is a real, self-contained capability-taxonomy
module (~100 lines, 12 exports) that nothing ever imports.

---

## 6. UNKNOWN_FILES

**9 files** classified as `TEST_PROOF_ONLY` rather than confidently
LIVE_SUPPORT or ORPHAN — each has zero `route.ts` callers, zero intra-`_lib`
sibling importers, but 1–2 references from `scripts/*.ts` proof/test
suites only (real code, exercised only by test scripts, not reachable from
any production HTTP path today):

`architectureSummaryRuntime.ts`, `capabilityRuntimeEvidenceRuntime.ts`
(used by `scripts/runtime-connection-evidence-verify.ts`),
`countryPackageRegistry.ts`, `deadEndSweepRuntime.ts`,
`documentLifecycleConstitution.ts`, `edgeFunctionWorkerRuntime.ts`,
`executionHandRuntime.ts`, `executionPlannerRuntime.ts`,
`normalizationRuntime.ts`.

These are real, substantial (100–900 lines each), and represent completed
work with no live consumer — the strongest "reusable but unwired"
candidates for a deliberate wire-or-retire decision before migration.

---

## 7. CAPABILITIES_ALREADY_IMPLEMENTED_IN_OLD_REPO

- **EXECUTION** (local command execution) — `executionRuntime.ts` +
  `executionRegistry.ts`: real, working. Client sends `commandId` + typed
  args only; server resolves to a fixed, allowlisted `{executable,
  fixedArgs}` and `spawn()`s with `shell:false` — never a shell string,
  never client-controlled argv. Redacts output, strips ANSI, sequences
  events. This is genuinely production-grade **local/CI-style** command
  execution (build, lint, typecheck, git status/diff — all local), not
  cloud/server execution.
- **BUILD** — `buildRuntime.ts` (1503 lines, 11 route callers): real build
  pipeline that invokes the execution engine above with the allowlisted
  `"build"` command (`npm run build`), tracks `BuildRun` records, computes
  a real build-gate/architecture-drift report, never spawns a process
  directly itself (delegates to `executionRuntime.ts`).
- **TEST** — `testRuntime.ts` (559 lines, 5 route callers): same pattern,
  real test-run tracking via the same execution engine.
- **AI_PROVIDER_CONTROL** (worker dispatch) — `workerSelectorRuntime.ts` +
  6 `workerAdapters/*.ts`: real, live-wired (one hop via
  `factoryWorkspaceRuntime.ts`/`codeWorkerRuntime.ts`, both LIVE_RUNTIME).
  `apiWorkerAdapter.ts`'s Anthropic leg and `digitalOceanWorkerAdapter.ts`
  make real outbound HTTP calls (DigitalOcean via plain `fetch()` to
  `https://inference.do-ai.run/...`, confirmed by source read);
  `cliWorkerAdapter.ts` drives a local `claude` CLI subprocess.
  OpenAI/Gemini adapters are present but explicitly documented in-source
  as **not wired to any real API call** (`apiWorkerAdapter.ts`'s own
  comment: "grep-verified: no `openai` npm dependency, no `new
  OpenAI(...)`").
- **PERMISSIONS** (coarse, tier-based) — `requireAuth(ADMIN_TIER)` gates
  174 of the `app/api/admin/ide/**/route.ts` files. Real, but a single
  binary admin/not-admin tier check, not per-capability scoped permission.
- **AUDIT** (evidence trail) — `registryWriterRuntime.ts` (real
  finding/evidence writer, used across `/admin/ide` AND
  `/admin/system-reality`) + `artifactRegistry.ts`/`artifactRuntime.ts`
  (real, bounded, immutable artifact history feeding a "Problems Panel").
  This audits the old repo's own internal pipeline state, not external
  provider actions (there are no external provider actions to audit yet).
- **CONTRACTS** — `executionRegistry.ts`'s `CommandDefinition` shape and
  `workerContract.ts`'s `WorkerAdapter` interface are real, enforced,
  internally-consistent typed contracts (17 route callers via
  `workerContract.ts`'s type re-exports).
- **CONFIG** — `buildRegistry.ts`, `deploymentRegistry.ts`,
  `workerRegistry.ts`: real typed registries of build types, deploy
  targets, and worker options.

---

## 8. CAPABILITIES_PARTIALLY_IMPLEMENTED_IN_OLD_REPO

- **DEPLOY** — `deploymentRuntime.ts`/`deploymentRegistry.ts`: real
  plan-lifecycle and route wiring (`deployment/plans/*`), but by explicit
  in-source design **never** calls an external deploy provider — no
  `fetch()`, no `execFile` to a deploy CLI (verified: `scripts/deployment-test.ts`
  literally asserts `!src.includes("fetch(")` against this file). Every
  plan is gated/`BLOCKED`; Vercel/Supabase are registered targets with no
  execution path. This is a real planning/governance layer with zero real
  deploy capability underneath it.
- **ROLLBACK** — `recoveryRuntime.ts`/`recoveryRegistry.ts`: real recovery
  **plan** tracking, but the in-source comment is explicit: recovery
  "re-surfaces" `deploymentRuntime.ts`'s own `RollbackPlan`, whose
  `executionStatus` is "already honestly `NOT_IMPLEMENTED`." Planning only.
- **COST_USAGE** — `usageMeterRuntime.ts`, `costGateRuntime.ts`,
  `costLedgerViewRuntime.ts`: real in-memory metering/gating logic
  (LIVE_SUPPORT, one hop from HTTP), but no persistence (no Supabase, no
  DB) and no direct route entrypoint of their own — usage does not survive
  a server restart and cannot be queried by any dedicated endpoint today.
- **PERMISSIONS / IDENTITY_SCOPE** — real at the route-tier level
  (`requireAuth(ADMIN_TIER)`, `auth.id`/`auth.email` passed through to
  per-owner scoping in `owner-command`/`commandSurfaceRuntime.ts`), but no
  fine-grained per-capability or per-resource scope-check comparable to
  what the new repo's `permissions/access-control/scope-check.ts` types
  describe.
- **CONNECTOR_LIFECYCLE / PROVIDER_STATUS** — `providerRegistryRuntime.ts`
  (904 lines) reconciles provider/connector descriptors and names
  (anthropic, openai, digitalocean, runpod, etc.) but does not itself make
  a live status call to any provider — it is a registry/naming layer, not
  a health-check engine. `externalAttackSurfaceRuntime.ts` +
  `externalDiscoveryAdapters/{dnsVerificationRuntime,httpxAdapter,subfinderAdapter}.ts`
  DO make real external network calls (DNS resolution, HTTP probing,
  subdomain enumeration via real `dns`/`httpx`/`subfinder` invocations) —
  but for **security reconnaissance of the old repo's own external attack
  surface**, not for infra-provider status (Vercel/Supabase/GitHub deploy
  health). Different capability than PROVIDER_STATUS as defined for the
  new repo's target taxonomy.

---

## 9. CAPABILITIES_MISSING_IN_BOTH

- **GITHUB** (real API control) — zero `@octokit`/GitHub-SDK usage
  anywhere in `_lib/` (repo-wide grep for `octokit` and case-insensitive
  `github` inside `_lib/` returns only files that mention "GitHub" in
  prose/comments, e.g. `providerRegistryRuntime.ts`'s provider-name map —
  no client, no token exchange, no PR/repo mutation code). The old repo's
  real GitHub logic lives entirely **outside** `_lib/`, in
  `app/api/admin/infrastructure/github/*` (per the prior top-level audit)
  — out of this audit's `_lib/`-scoped mandate, so still flagged
  UNKNOWN-at-the-`_lib/`-layer rather than confirmed absent repo-wide.
- **VERCEL** (real API control) — zero `@vercel`/`vercel.com/api` usage
  anywhere in `_lib/`. `deploymentRegistry.ts` registers Vercel as a
  target name only; no client exists.
- **SUPABASE_CONTROL** (admin/schema operations) — zero real `@supabase`
  client usage in `_lib/` (one prose mention only, see §3 correction). No
  schema/DDL/project-admin control surface anywhere in `_lib/`.
- **ANTHROPIC_ADMIN** (usage/cost/admin API, as opposed to chat-completion
  worker dispatch) — not present; `apiWorkerAdapter.ts`'s Anthropic path is
  a chat/completion worker call via `services/ai/gateway.ts`, not an Admin
  API client (no org/usage/billing endpoint access).
- **SERVER_CONTROL** — no infrastructure/server-provisioning code (no
  droplet/VM/container lifecycle management) anywhere in `_lib/`.
- Consistent with the prior top-level audit
  (`reports/INFRASTRUCTURE_MIGRATION_COMPLETENESS_AUDIT.md`, ~8–10%
  complete): this deep audit found real, migratable EXECUTION/BUILD/TEST
  logic that report had marked fully MISSING, but confirms GITHUB, VERCEL,
  SUPABASE_CONTROL, ANTHROPIC_ADMIN, and SERVER_CONTROL remain genuinely
  absent from the `_lib/` layer specifically.

---

## 10. DUPLICATE_IMPLEMENTATION_RISKS

- **GITHUB**: DNA-OS-INFRASTRUCTURE's new `connections/github/*` (adapter,
  credential-resolution, read-api, host-runtime, status-operations,
  currently staged/untracked in this repo) has **no** `_lib/` precedent to
  reconcile against — old repo's real GitHub logic is entirely outside
  `_lib/` (see §9). Low duplication risk today, but the new adapter's
  design should be checked against `app/api/admin/infrastructure/github/*`
  (outside this audit's scope) before it solidifies, or the two will
  diverge on request/response shape for the same provider.
- **EXECUTION/BUILD/TEST**: the new repo's `execution/{build,test,run,
  deploy,rollback,code-change}/` folders are currently README-only stubs.
  If a new EXECUTION engine is built from scratch there without reusing
  `executionRuntime.ts`'s allowlist-command pattern, the two repos will
  end up with two independently-designed "safe command execution" engines
  solving the identical problem (client sends id, server resolves to fixed
  argv, spawns with `shell:false`) — high risk, since this is exactly the
  kind of security-sensitive logic that should not be reinvented.
- **AI_PROVIDER_CONTROL**: the new repo's `ai/{model-router,agent-registry,
  model-registry}` are README-only. Old repo's `workerSelectorRuntime.ts` +
  `workerAdapters/*` already solve dispatch-to-provider-adapter cleanly
  with a shared `WorkerAdapter` contract (`workerContract.ts`) — a strong
  candidate to port the *pattern* from, not duplicate.
- **COST_USAGE**: neither repo has a real, persisted cost-usage store
  today (old repo's is in-memory only, non-route-wired; new repo has none)
  — low duplication risk currently, but both are equally immature, so
  whichever is built first should be the one both eventually share.

---

## 11. MIXED_RESPONSIBILITY_FILES

- **`factoryWorkspaceRuntime.ts`** (729 lines, 19 route callers, 39
  exports) — the single largest mixed-responsibility file in `_lib/`. It
  is simultaneously: (a) a generic session/workspace orchestration state
  machine, (b) the `runAutoOrchestration()` entrypoint that
  `owner-command/route.ts` falls through to (an execution-dispatch
  concern), and (c) contains inline classification/gating logic that
  functionally acts as a permission/authorization check embedded in
  business orchestration code. **Split**: extract the orchestration state
  machine (→ `EXECUTION`), the auto-dispatch/intent-fallback logic (→
  `EXECUTION` or a dedicated `control/owner-command` runtime, mirroring
  the new repo's existing `control/owner-command/` folder), and any
  gating/classification logic (→ `PERMISSIONS`) into three separate files
  before migrating any of it.
- **`systemRealityRuntime.ts`** (1143 lines, 18 exports) — mixes a
  generic architecture-graph/system-reality reporting engine with
  business-domain-specific content (references to invoice/partner/LINE
  entity chains as concrete graph examples, per direct read of comments
  referencing `getPartnerById()`/`invoice.items` chains). **Split**: the
  generic graph-traversal/evidence-level engine is infra (→ AUDIT or a new
  `architecture-graph` capability); the LINE/invoice/partner example
  content and any business-entity-specific resolvers must stay in the
  business repo.
- **`executionRuntime.ts` + `executionRegistry.ts`** — not mixed with
  business logic, but does mix **execution mechanics** (spawn, redact,
  sequence) with an embedded **permission-adjacent concern**
  (concurrency/exclusive-lock-key gating per command). This is a smaller,
  more defensible mix (both are legitimately "command execution" concerns)
  but the lock/concurrency logic should still be extracted to a shared
  `EXECUTION` primitive rather than duplicated if a second execution
  engine (e.g., for cloud/server commands) is ever built.
- **`apiWorkerAdapter.ts`** — mixes provider-specific
  (Anthropic/OpenAI/Gemini) request/response shaping with generic
  worker-adapter-contract concerns that `workerSelectorRuntime.ts` already
  owns; the OpenAI/Gemini legs being non-functional stubs inside a
  file that also contains a real, live Anthropic path makes this file's
  boundary between "real capability" and "documented-as-fake scaffolding"
  easy to miss on a casual read — split real vs. stub adapters into
  separate files before migration so a fake adapter can never be
  mistaken for a real one downstream.
- **`providerRegistryRuntime.ts`** (904 lines) — mixes a generic
  provider/connector naming-and-reconciliation registry with
  credential-env-var-name mappings (`OPENAI_API_KEY: "openai"`, etc.) that
  are closer to a CREDENTIAL_RESOLUTION concern than a PROVIDER_STATUS
  concern. **Split**: keep the registry/reconciliation logic, extract the
  env-var-name mapping into a shared credential-resolution contract
  (mirroring `connections/github/credential-resolution.ts`'s pattern).

---

## 12. EXACT_OLD_FILES_TO_MIGRATE

High confidence, real, correctly-scoped infra logic — migrate (with the
splits noted in §13 applied first where flagged):

- `executionRuntime.ts`, `executionRegistry.ts` — EXECUTION (the
  allowlisted, `shell:false` command-execution engine — the single most
  valuable, correctly-scoped piece of infra logic found in this audit)
- `buildRuntime.ts`, `buildRegistry.ts` — BUILD
- `testRuntime.ts`, `testRegistry.ts` — TEST
- `gitReadOnly.ts` — a read-only Git primitive (status/diff/log/blame via
  fixed-argv `execFile`, no mutation) — GITHUB-adjacent but
  provider-agnostic local-git, maps to a shared execution/contracts
  primitive, not the GitHub connector itself
- `workerContract.ts`, `workerSelectorRuntime.ts`, and the real legs of
  `workerAdapters/apiWorkerAdapter.ts` (Anthropic only),
  `workerAdapters/cliWorkerAdapter.ts`,
  `workerAdapters/digitalOceanWorkerAdapter.ts` — AI_PROVIDER_CONTROL
- `usageMeterRuntime.ts`, `costGateRuntime.ts`, `costLedgerViewRuntime.ts`
  — COST_USAGE (migrate the real logic; it needs a persistence layer and a
  route entrypoint added, neither of which exist today in either repo)
- `registryWriterRuntime.ts` — AUDIT (evidence/finding writer)
- `recoveryRuntime.ts`, `recoveryRegistry.ts` — ROLLBACK (plan/registry
  layer only — do not claim execution capability on migration; it doesn't
  exist in the source either)
- `deploymentRuntime.ts`, `deploymentRegistry.ts` — DEPLOY (same caveat:
  plan/gate layer only, zero real deploy execution to migrate)

---

## 13. EXACT_OLD_FILES_TO_SPLIT

- `factoryWorkspaceRuntime.ts` → orchestration/EXECUTION half +
  auto-dispatch/EXECUTION half + gating/PERMISSIONS half (three files)
- `systemRealityRuntime.ts` → generic architecture-graph/AUDIT engine vs.
  business-entity example content (business content stays in old repo)
- `apiWorkerAdapter.ts` → real Anthropic adapter (migrate) vs.
  documented-non-functional OpenAI/Gemini stubs (do not migrate as if real)
- `providerRegistryRuntime.ts` → registry/reconciliation logic
  (CONNECTOR_LIFECYCLE) vs. credential-env-var-name mapping
  (CREDENTIAL_RESOLUTION, generalize `connections/github/credential-resolution.ts`'s
  pattern to cover it)

---

## 14. EXACT_OLD_FILES_TO_KEEP

Keep in the old repo as reference/back-compat only — no unique capability
worth porting as-is, but not safe to delete (still live-wired, actively
serving `/admin/ide` UI panels today):

- The bulk of the "Registry + Runtime" evidence/UI-support pairs that only
  serve `/admin/ide`'s own internal panels with no cross-cutting infra
  value outside that admin tool: `artifactRegistry.ts`/`artifactRuntime.ts`,
  `changeSetRuntime.ts`, `queueRuntime.ts`/`queueRegistry.ts`,
  `inspectionRuntime.ts`/`inspectionRegistry.ts`,
  `browserInspectionRuntime.ts`, `governanceRuntime.ts`,
  `incidentRuntime.ts`/`incidentRegistry.ts`, `monitoringRuntime.ts`/
  `monitoringRegistry.ts`, `releaseRuntime.ts`/`releaseRegistry.ts`,
  `globalFactoryRuntime.ts`, `factoryCompletionRuntime.ts`/
  `factoryCompletionRegistry.ts`, `factoryReadinessGateRuntime.ts`,
  `capabilityRegistryRuntime.ts`, `capabilityResolverRuntime.ts`,
  `capabilitySymbolResolutionRuntime.ts`, `contextPlannerRuntime.ts`,
  `intentRuntime.ts`, `commandSurfaceRuntime.ts`, `codeWorkerRuntime.ts`,
  `autoSaveRuntime.ts`, `editorWorkspaceConfirmRuntime.ts`,
  `domainAssetRuntime.ts`, `trash.ts`, `tree.ts`, `search.ts`,
  `standards.ts`, `viewportRegistry.ts`, `decisions.ts`, `problems.ts`,
  `classification.ts`. These are UI-backing plumbing for the old admin
  IDE — genuinely working, but their target is "keep this admin tool
  running," not a general infra capability the new repo needs.

---

## 15. EXACT_OLD_FILES_TO_RETIRE_LATER

- `openCapabilityArchitecture.ts` — confirmed ORPHAN (§5); retire outright,
  no caller anywhere to preserve compatibility for.
- The 9 `TEST_PROOF_ONLY` files (§6) — retire once a deliberate
  wire-or-retire decision is made; do not silently port unwired code.
- `fsSecurity.ts`, `fsOps.ts`, `fileWrite.ts` — retire from the old repo
  **only after** their filesystem-security-boundary logic (workspace-root
  confinement, safe-path resolution) is re-implemented as a shared
  primitive in the new repo, since 56+17+ callers respectively depend on
  the exact safety guarantees they provide; do not retire before a
  verified-equivalent replacement exists.

---

## 16. TARGET_FOLDER_MAPPING

| Old file(s) | Capability | Target folder in DNA-OS-INFRASTRUCTURE | Migration type |
|---|---|---|---|
| `executionRuntime.ts`, `executionRegistry.ts` | EXECUTION | `execution/run/` | REFACTOR_AND_MIGRATE (strip `/admin/ide`-specific event-shape coupling; keep the allowlist-argv + `shell:false` pattern intact) |
| `buildRuntime.ts`, `buildRegistry.ts` | BUILD | `execution/build/` | REFACTOR_AND_MIGRATE |
| `testRuntime.ts`, `testRegistry.ts` | TEST | `execution/test/` | REFACTOR_AND_MIGRATE |
| `gitReadOnly.ts` | CONTRACTS/EXECUTION (git primitive) | `execution/code-change/` or a new `core` git primitive shared across connectors | EXTRACT_EXECUTION_LOGIC |
| `deploymentRuntime.ts`, `deploymentRegistry.ts` | DEPLOY | `execution/deploy/` | REFACTOR_AND_MIGRATE (plan/gate layer only — flag clearly that real provider execution must be built new, not assumed present) |
| `recoveryRuntime.ts`, `recoveryRegistry.ts` | ROLLBACK | `execution/rollback/` | REFACTOR_AND_MIGRATE (same caveat — planning only) |
| `workerContract.ts` | AI_PROVIDER_CONTROL contract | `contracts/connector/` or new `ai/model-router` contract | EXTRACT_CONTRACT |
| `workerSelectorRuntime.ts`, real legs of `apiWorkerAdapter.ts` (Anthropic), `cliWorkerAdapter.ts`, `digitalOceanWorkerAdapter.ts` | AI_PROVIDER_CONTROL | `ai/model-router/`, `connections/ai-providers/` | EXTRACT_PROVIDER_ADAPTER |
| `usageMeterRuntime.ts`, `costGateRuntime.ts`, `costLedgerViewRuntime.ts` | COST_USAGE | new `execution/` or `audit/` sibling — no existing `cost/` folder in current taxonomy; recommend adding one | REFACTOR_AND_MIGRATE (add persistence + a route entrypoint, neither exists today) |
| `registryWriterRuntime.ts` | AUDIT | `audit/code-change-audit/` or `audit/command-audit/` | EXTRACT_CONTRACT + REFACTOR_AND_MIGRATE |
| `providerRegistryRuntime.ts` (registry half) | CONNECTOR_LIFECYCLE | `contracts/connector/`, `connections/*` registry layer | REFACTOR_AND_MIGRATE (post-split, see §13) |
| `providerRegistryRuntime.ts` (credential-name-mapping half) | CONFIG/CREDENTIAL_RESOLUTION | generalize `connections/github/credential-resolution.ts` | EXTRACT_CONTRACT |
| `factoryWorkspaceRuntime.ts` (post-split, orchestration+dispatch halves) | EXECUTION | `execution/run/`, `control/command-router/` | EXTRACT_EXECUTION_LOGIC |
| `factoryWorkspaceRuntime.ts` (post-split, gating half) | PERMISSIONS | `permissions/execution-policy/` | EXTRACT_CONTRACT |
| `systemRealityRuntime.ts` (post-split, graph engine) | AUDIT | `audit/` (new architecture-graph sub-area) | REFACTOR_AND_MIGRATE |
| `systemRealityRuntime.ts` (post-split, business content) | — | stays in old repo, business scope | KEEP_IN_BUSINESS_REPO |
| `requireAuth`/`ADMIN_TIER` pattern (not itself in `_lib/`, but every `_lib/` file's real permission boundary) | PERMISSIONS/IDENTITY_SCOPE | `permissions/access-control/`, `permissions/software-scope/` | REFACTOR_AND_MIGRATE — needed as the actual enforcement wiring the new repo's typed-only permission scaffolding currently lacks |
| The `KEEP` list in §14 | — (admin-tool UI plumbing) | none — stays in old repo | KEEP_IN_BUSINESS_REPO |
| `openCapabilityArchitecture.ts`, 9 `TEST_PROOF_ONLY` files | — | none | RETIRE |

---

## 17. REQUIRED_PUBLIC_CONTRACTS

- **Execution command contract** — `executionRegistry.ts`'s
  `CommandDefinition` (`{id, category, executable, fixedArgs,
  eventCategory}`) shape is the strongest existing example of a
  provider-agnostic execution contract in the old repo; formalize this as
  the public contract for `execution/run/`.
- **Worker adapter contract** — `workerContract.ts`'s `WorkerAdapter`
  interface (id/type/provider/dispatch shape), already the pattern
  `connections/github/adapter-contract.ts` established independently for
  GitHub — reconcile the two into one shared adapter-contract shape used
  by both AI_PROVIDER_CONTROL and connector adapters generally.
- **Cost/usage ledger contract** — a stable ledger-entry + gate-decision
  shape shared by usage/cost-gate/cost-ledger consumers; none of the three
  old files export a contract distinct from their own internal types today
  — this needs to be authored fresh, informed by their real shapes.
- **Deploy/rollback plan contract** — `deploymentRuntime.ts`'s
  `DeploymentPlan`/`RollbackPlan` shapes are real and route-wired; extract
  as the plan-layer contract, explicitly excluding any execution-status
  claim (both are honestly `NOT_IMPLEMENTED`/`BLOCKED` at the provider
  level today).
- **Evidence/finding contract** — `registryWriterRuntime.ts`'s
  `WriteFindingInput`/`FindingSource` shapes are already reused
  cross-subsystem (`/admin/ide` and `/admin/system-reality`); formalize as
  the shared AUDIT contract.

---

## 18. REQUIRED_PERMISSION_BOUNDARIES

- A route-tier boundary equivalent to `requireAuth(ADMIN_TIER)` must exist
  in front of every migrated EXECUTION/BUILD/TEST/DEPLOY/ROLLBACK
  entrypoint in the new repo — today this is the *only* real permission
  check protecting all 70 LIVE_RUNTIME files; the new repo's
  `permissions/access-control/*` types exist but are unwired to anything
  (confirmed by the prior top-level audit and unchanged by this deep
  audit).
- `factoryWorkspaceRuntime.ts`'s embedded gating logic (§11) must become a
  standalone boundary called by EXECUTION, DEPLOY, and AI_PROVIDER_CONTROL
  alike — not re-embedded per-runtime as it is today.
- DEPLOY specifically needs a **plan vs. execute** boundary preserved from
  `deploymentRegistry.ts`'s existing split, so that a future real
  Vercel/Supabase executor cannot run without passing through the same
  gate the old repo currently hard-codes as `BLOCKED`.
- COST_USAGE needs a boundary that AI_PROVIDER_CONTROL adapters cannot
  bypass — the old repo's `costGateRuntime.ts` exists for this but is not
  actually wired as a hard gate in front of `workerSelectorRuntime.ts`
  today (confirmed: `workerSelectorRuntime.ts` has no import of
  `costGateRuntime.ts`) — this needs to be added, not just migrated as-is.

---

## 19. REQUIRED_CREDENTIAL_BOUNDARIES

- **Anthropic** — currently resolved inside `apiWorkerAdapter.ts` via
  `services/ai/gateway.ts` (not read in this pass — outside `_lib/`); on
  migration must go through the same credential-resolution pattern the new
  repo already built for GitHub (`connections/github/credential-resolution.ts`).
- **DigitalOcean** — `digitalOceanWorkerAdapter.ts` resolves credentials
  from a real Connectors DB row first, env var fallback second (a more
  sophisticated pattern than GitHub's env-var-only resolution today) —
  worth using as the *template* to upgrade GitHub's own credential
  resolution, not just following GitHub's simpler pattern.
- **`claude` CLI** (`cliWorkerAdapter.ts`) — local-process auth, distinct
  in kind from HTTP-API adapters; needs explicit documentation of what
  local auth state it depends on before migration.
- **GitHub/Vercel/Supabase** — no credential usage found in `_lib/` at all
  (§9); `connections/github/credential-resolution.ts` in the new repo is
  the only existing credential boundary for any of these three and should
  be the template the others are built from.
- **Cost/usage/audit writers** — `usageMeterRuntime.ts`,
  `costLedgerViewRuntime.ts`, `registryWriterRuntime.ts` currently need no
  external credentials (in-memory only) — but the moment persistence is
  added (required per §8/§12), a credential boundary for that datastore
  must be added at the same time, not bolted on after.

---

## 20. RECOMMENDED_MIGRATION_ORDER

1. **Formalize the execution-command contract and permission boundary
   together** (§17/§18) — `executionRegistry.ts`'s allowlist pattern +
   `requireAuth(ADMIN_TIER)`-equivalent gate. Nothing else below is safe
   to migrate without this landing first, since every subsequent
   capability depends on "commands only run through a governed,
   allowlisted, permission-gated path."
2. **EXECUTION** (`executionRuntime.ts`, `executionRegistry.ts`) — the
   highest-value, most correctly-scoped real capability found.
3. **BUILD, TEST** (`buildRuntime.ts`/`buildRegistry.ts`,
   `testRuntime.ts`/`testRegistry.ts`) — both are thin layers over
   EXECUTION; migrate immediately after it, together.
4. **Credential-resolution generalization** — extract GitHub's existing
   pattern (env-var) and DigitalOcean's more advanced pattern (DB-row +
   env fallback) into one shared contract before adding more provider
   adapters, so AI_PROVIDER_CONTROL doesn't reinvent this a third way.
5. **AI_PROVIDER_CONTROL** (`workerContract.ts`, `workerSelectorRuntime.ts`,
   real legs of `apiWorkerAdapter.ts`/`cliWorkerAdapter.ts`/
   `digitalOceanWorkerAdapter.ts`) — split stub adapters from real ones
   first (§13) before porting.
6. **COST_USAGE** — migrate the real in-memory logic, but this is the
   first capability in this list that needs **new** work, not just a
   port: add persistence and a route entrypoint (neither exists in
   either repo), and wire it as an actual gate in front of step 5's
   adapters (not wired today — §18).
7. **DEPLOY, ROLLBACK** (plan/gate layers only) — migrate last among the
   "real" capabilities, and explicitly document at migration time that
   zero real provider-execution code exists to migrate — this closes the
   plan-layer gap but does **not** close VERCEL/SUPABASE_CONTROL, which
   remain to be built from scratch (§9).
8. **AUDIT** (`registryWriterRuntime.ts`) — migrate once steps 2–7 exist,
   so it has real events to write about in the new repo, not just old
   `/admin/ide` panel data.
9. **VERCEL, SUPABASE_CONTROL, ANTHROPIC_ADMIN, SERVER_CONTROL** — build
   new; confirmed nothing in `_lib/` migrates into these (§9). Use the
   prior top-level audit's §19 ordering (Vercel status-first, then
   Supabase project-status-first) once steps 1–8 land, since those new
   adapters should be built against the now-formalized contracts from
   steps 1 and 4, not designed independently.
10. **PERMISSIONS/IDENTITY_SCOPE hardening** — once real capabilities
    exist end-to-end, revisit the coarse tier-only boundary from step 1
    and replace it with the new repo's fine-grained
    `permissions/access-control/scope-check.ts` pattern — the old repo
    never had this, so this is a genuine improvement opportunity, not a
    migration.

---

## 21. REVISED_INFRA_MIGRATION_COMPLETENESS_PERCENT

**~18–20%**, revised up from the prior top-level estimate of **~8–10%**.

Basis: of the 19 capability rows in the prior audit's matrix, this deep
audit found real (not just typed/scaffolded) old-repo implementations for
EXECUTION, BUILD, TEST (previously counted MISSING, now real and
migratable), and confirmed/refined the prior PARTIAL ratings for DEPLOY,
ROLLBACK, COST_USAGE, PERMISSIONS, and CONTRACTS with concrete source
files and honest caveats about what's real vs. planning-only. GITHUB
remains the only capability with a genuinely production-complete
implementation (unchanged, and confirmed still absent from `_lib/`
specifically — its real source is outside this audit's scope). VERCEL,
SUPABASE_CONTROL, ANTHROPIC_ADMIN, SERVER_CONTROL, AI_PROVIDER_CONTROL
(admin/router half), PROVIDER_STATUS (non-security-recon), and CONFIG
(general) remain effectively 0% in `_lib/`. The revision reflects that
~70 of 115 old-repo files are real, live-wired, migratable infra logic —
materially more than the prior audit's `_lib/`-as-black-box estimate
assumed — while being explicit that the two highest-priority missing
capabilities (VERCEL, SUPABASE_CONTROL/ANTHROPIC_ADMIN real API clients)
are not among what this deep audit found; they still require new work.

---

## 22. FILES_CHANGED

Exactly one file, in DNA-OS-INFRASTRUCTURE (new/untracked, not staged, not
committed):

- `reports/OLD_CONTROL_PLANE_DEEP_AUDIT.md` (this file — overwrites an
  earlier, less-verified draft that had already been written to this same
  path by a separate process during this task; the earlier draft's
  factual errors, corrected here, are documented in §3)

No other file in DNA-OS-INFRASTRUCTURE or in the old repo
(`dna-os-deadboard`) was created, edited, moved, staged, or committed as
part of this task.

---

## 23. GIT_STATE_CHANGED

**false**, with respect to this task's own actions.

Verified via `git status --porcelain` in both repos:

- **DNA-OS-INFRASTRUCTURE**: at task start already had staged
  (`A`/`M`) changes under `connections/github/*` plus
  `reports/INFRASTRUCTURE_MIGRATION_COMPLETENESS_AUDIT.md` — pre-existing,
  not touched by this task. This task's only filesystem effect is the new
  untracked `reports/OLD_CONTROL_PLANE_DEEP_AUDIT.md`.
- **dna-os-deadboard** (old repo): at task start already had modified
  files (`app/admin/infrastructure/page.tsx`,
  `app/api/admin/infrastructure/route.ts`, `core/config/ide-settings.ts`,
  `core/executor/engine.ts`, `core/shared/types.ts`, and others) —
  pre-existing working-tree state, unrelated to and untouched by this
  read-only audit. Zero writes, moves, or git operations of any kind were
  performed in the old repo.

No git command beyond `git status`/`git status --porcelain` was run in
either repository during this task. No `add`, `commit`, `checkout`,
`reset`, `stash`, or other mutating git command was executed.
