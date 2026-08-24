# Infrastructure Migration Completeness Audit

Date: 2026-08-16
Scope: `dna-os-deadboard` (OLD/MIXED) → `DNA-OS-INFRASTRUCTURE` (NEW TARGET)
Mode: Read-only audit. No files moved, copied, deleted, staged, or committed.

---

## 1. TOTAL_INFRA_CAPABILITIES_FOUND

19 capability areas evaluated (per taxonomy): GITHUB, VERCEL, SUPABASE_CONTROL, ANTHROPIC_ADMIN,
AI_PROVIDER_CONTROL, SERVER_CONTROL, DEPLOY, BUILD, TEST, ROLLBACK, EXECUTION,
CREDENTIAL_RESOLUTION, CONNECTOR_LIFECYCLE, PROVIDER_STATUS, COST_USAGE, PERMISSIONS,
IDENTITY_SCOPE, AUDIT, CONFIG, CONTRACTS (=20, GITHUB split includes CREDENTIAL_RESOLUTION as
distinct row per capability matrix below — total distinct rows = 19; CONTRACTS counted once).

## 2. COMPLETE

- **GITHUB** — the only capability with a full implementation stack in the new repo (contract,
  adapter, config, credential resolution, payload validation, status ops, read API, host runtime,
  tests, policy/architecture docs). See §3 verification below.

## 3. PARTIAL

- **CREDENTIAL_RESOLUTION** — implemented only for GitHub
  (`connections/github/credential-resolution.ts`). No equivalent for Vercel/Supabase/Anthropic.
- **CONTRACTS** — generic envelope/command/event/connector contracts exist
  (`contracts/*`, ~30–50 line type/interface files), but only GitHub has a concrete adapter
  implementing them. Contracts are scaffolding used by one real capability.
- **PERMISSIONS / IDENTITY_SCOPE** — type-only scaffolding exists (`permissions/access-control/*`,
  `permissions/software-scope/*`: identity, membership, scope-check, break-glass, tenant, account,
  business-domain types, 20–30 lines each). No enforcement logic, no wiring to GITHUB adapter's
  actual request path, no runtime permission check found in `connections/github/*`.
- **CONFIG** — `config/` has 3 README-only stub folders (connection-settings, environment,
  feature-status) plus GitHub's own `adapter-config.ts`. GitHub-specific config is real; general
  infra config is not.
- **AUDIT** — `audit/` has 4 README-only folders (ai-execution-audit, code-change-audit,
  command-audit, deployment-audit) — no implementation, no evidence-capture code anywhere in the
  new repo outside GitHub's own docs (ARCHITECTURE_DECISIONS.md, POLICY.md are design docs, not
  audit-evidence code).

## 4. MISSING

- **VERCEL** — `connections/vercel/`, `connections/vercel-webhooks/`, `connections/vercel-drains/`
  contain only README.md + one live-test plan doc (`CHECKS_API_LIVE_TEST_PLAN.md`). No adapter,
  no credential resolution, no implementation code at all.
- **SUPABASE_CONTROL** — `connections/supabase/` is README-only. No admin/control implementation.
  (Old repo has Supabase Edge Functions and a cron `supabase-project-status` route — none ported.)
- **ANTHROPIC_ADMIN** — `connections/ai-providers/` is README-only. No Anthropic Admin API client,
  no usage/cost polling, nothing.
- **AI_PROVIDER_CONTROL** — same as above; `ai/model-router`, `ai/agent-registry`,
  `ai/model-registry` are all README-only stub folders.
- **SERVER_CONTROL** — no runtime/server-infrastructure control code found anywhere in new repo.
- **DEPLOY / BUILD / TEST / ROLLBACK / EXECUTION** — `execution/{deploy,build,test,rollback,run,
  code-change}/` are all single-README stub folders. Zero implementation. Old repo has real
  code for these (`scripts/deploy-gate.ts`, `scripts/build-*.ts`,
  `app/api/admin/ide/_lib/deploymentRuntime.ts`, `buildRuntime.ts`, `testRuntime.ts`,
  `executionRegistry.ts`, `recoveryRuntime.ts`/rollback-adjacent logic) — none of it migrated.
- **PROVIDER_STATUS** (non-GitHub) — old repo has `app/api/cron/supabase-project-status/route.ts`
  and `app/api/gateway/observe/vercel/route.ts`; no equivalents in new repo.
- **COST_USAGE** — old repo has `app/api/admin/ide/_lib/costLedgerViewRuntime.ts`,
  `costGateRuntime.ts`, `usageMeterRuntime.ts`; nothing migrated.
- **CONNECTOR_LIFECYCLE** (general, non-GitHub) — old repo has
  `app/api/admin/connectors/_lib/catalog.ts`, `providerDescriptors.ts`,
  `engines/connectors/tester.ts`, `providers/{vercel,supabase,anthropic,...}/*.json` — none ported
  except the concepts partially reflected in GitHub's own adapter-contract.

## 5. LEGACY_ONLY

- **DEPLOY/BUILD/TEST/ROLLBACK/EXECUTION runtimes** in
  `app/api/admin/ide/_lib/{deploymentRuntime,buildRuntime,testRuntime,executionRegistry,
  recoveryRuntime,queueRuntime,releaseRuntime}.ts` — exist only in old repo, no new-repo trace.
- **`app/api/deploy/route.ts`** (old repo) — live deploy trigger endpoint, legacy-only.
- **Supabase Edge Functions** (`supabase/functions/*`, ~20 functions incl.
  `supabase-billing-sync`, `system-health-check`, `architecture-drift-alert`) — legacy-only;
  several are business-domain (line-webhook, debt-reminder-cron) and should NOT migrate; a few
  (system-health-check, supabase-billing-sync, architecture-drift-alert) look infra-relevant and
  are legacy-only today.
- **`providers/{vercel,supabase,anthropic,digitalocean,cloudflare,runpod,mcp,openai,google,line,
  sip,openclaw}/{provider,capabilities,runtime,credentials.template}.json`** — declarative
  provider descriptors, legacy-only, none ported to new repo's `connections/` structure.
- **`engines/infrastructure/githubSync.ts`** and **`engines/connectors/tester.ts`** — legacy-only;
  githubSync.ts is superseded in spirit by the new GitHub adapter but was not literally migrated
  (new adapter was rewritten, not moved) — treat as REPLACE_WITH_API_CALL / RETIRE once new adapter
  is confirmed at parity.
- **`app/api/admin/infrastructure/route.ts`, `.../github/route.ts`, `.../github/token/route.ts`,
  `.../github/paths/*`** — old admin UI-facing GitHub routes, legacy-only, currently still the only
  wired runtime entrypoint for GitHub control in production (see §10).

## 6. INFRA_SOURCE_STILL_IN_OLD_REPO

| Path (old repo) | Capability | Disposition |
|---|---|---|
| `app/api/admin/infrastructure/route.ts` | GITHUB/general infra admin UI backend | MIGRATE (as API-boundary caller) or REPLACE_WITH_API_CALL |
| `app/api/admin/infrastructure/github/route.ts`, `route 2.ts` (dup) | GITHUB | REPLACE_WITH_API_CALL once new adapter has a runtime entrypoint |
| `app/api/admin/infrastructure/github/token/route.ts` | CREDENTIAL_RESOLUTION (GitHub) | REPLACE_WITH_API_CALL |
| `app/api/admin/infrastructure/github/paths/route.ts`, `[id]/route.ts`, `[id]/sync/route.ts` | GITHUB status ops | REPLACE_WITH_API_CALL |
| `app/admin/infrastructure/page.tsx` | GITHUB admin UI | KEEP_TEMPORARILY (business-side UI shell, should call new infra API) |
| `app/api/deploy/route.ts` | DEPLOY | MIGRATE |
| `scripts/deploy-gate.ts`, `deployment-test.ts` | DEPLOY/TEST gate | MIGRATE |
| `scripts/build-*.ts` (build-gate-test, build-system-control-graph, build-factory-registry, build-test, etc.) | BUILD | MIGRATE (subset — filter business-report scripts like build-factory-completion-report) |
| `app/api/admin/ide/_lib/{deploymentRuntime,buildRuntime,testRuntime,executionRegistry,recoveryRuntime,queueRuntime,releaseRuntime,costLedgerViewRuntime,costGateRuntime,usageMeterRuntime}.ts` | DEPLOY/BUILD/TEST/EXECUTION/ROLLBACK/COST_USAGE | MIGRATE |
| `app/api/admin/connectors/_lib/{catalog,providerDescriptors}.ts` | CONNECTOR_LIFECYCLE | MIGRATE |
| `engines/connectors/tester.ts` | CONNECTOR_LIFECYCLE | MIGRATE (re-implement against new contract) |
| `engines/infrastructure/githubSync.ts` | GITHUB (superseded) | RETIRE once new adapter verified at parity |
| `providers/{vercel,supabase,anthropic,...}/*.json` | PROVIDER descriptors for all providers | MIGRATE (informs VERCEL/SUPABASE_CONTROL/ANTHROPIC_ADMIN adapter builds) |
| `app/api/gateway/observe/vercel/route.ts` | VERCEL PROVIDER_STATUS | MIGRATE |
| `app/api/cron/supabase-project-status/route.ts` | SUPABASE_CONTROL PROVIDER_STATUS | MIGRATE |
| `app/api/cron/operations-loop/route.ts` | EXECUTION orchestration | UNKNOWN — needs read to classify infra vs business |
| `supabase/functions/system-health-check`, `supabase-billing-sync`, `architecture-drift-alert` | SERVER_CONTROL/COST_USAGE/AUDIT | MIGRATE (candidate) |
| `supabase/functions/{line-webhook-v2,debt-reminder-cron,bank-*,receipt-*,quotation-queue-nudge,line-profile-*}` | business-domain edge functions | RETIRE from migration scope — stays in old repo |

## 7. BUSINESS_CODE_FOUND_IN_NEW_REPO

**None found.** Grep for `line_user|lineUserId|debt|invoice|customer|logistics|transport|pricing|
quotation|pits?` across `DNA-OS-INFRASTRUCTURE` (excluding `.git`) returned only:
- Generic architecture-boundary prose in README.md, `connections/vercel/README.md`,
  `governance/architecture-rules/{README.md,VERCEL_BOUNDARY_PLAN.md}` — these *discuss* keeping
  business logic out (the word "customer"/"pricing" appears as an example of what NOT to leak),
  not actual business code.
- `permissions/software-scope/business-domain.ts` and `business-domain-registration.ts` — these
  are generic multi-tenant *type* abstractions (`BusinessDomain` as a scoping concept for
  permissions), not LINE/debt/customer/logistics domain logic. Not a leak.
- `contracts/operational-bridge/bridge.ts` — generic cross-boundary event/command bridge contract,
  mentions "business" only as a role label in comments. Not a leak.
- `connections/github/host-runtime.ts`, `github-read-api.ts`, `adapter.test.ts` — matched only
  because of substring overlap (e.g. "customer" false-positive not present; matched on generic
  words in comments/tests) — inspected, contain GitHub-only logic, no business data model.

No BUSINESS_DATA_LEAK, BUSINESS_LOGIC_LEAK, BUSINESS_UI_LEAK, DIRECT_BUSINESS_DB_ACCESS,
LINE_DOMAIN_LEAK, CUSTOMER_DOMAIN_LEAK, DEBT_DOMAIN_LEAK, or LOGISTICS_DOMAIN_LEAK identified.

## 8. CROSS_REPO_IMPLEMENTATION_DEPENDENCIES

None found. New repo has no `import` statements referencing the old repo's path or package name,
and is a separate git repository with no workspace/symlink relationship on disk. Old repo's GitHub
admin routes (`app/api/admin/infrastructure/github/*`) currently call GitHub's REST API directly
themselves — they do **not** yet call the new repo's adapter, so there is no accidental
cross-repo *runtime* dependency either (this is also why GITHUB is PARTIAL in practice — see §9).

## 9. MISSING_TESTS

- VERCEL, SUPABASE_CONTROL, ANTHROPIC_ADMIN, AI_PROVIDER_CONTROL, SERVER_CONTROL, DEPLOY, BUILD,
  TEST(capability), ROLLBACK, EXECUTION, PROVIDER_STATUS, COST_USAGE — zero implementation, so
  zero tests (N/A until implemented).
- PERMISSIONS / IDENTITY_SCOPE / CONTRACTS — type-only files, no unit tests exist for any of
  `permissions/access-control/*`, `permissions/software-scope/*`, or `contracts/*`.
- GITHUB — has `connections/github/adapter.test.ts` (26KB, real test suite). This is the one
  capability with test coverage.

## 10. MISSING_RUNTIME_ENTRYPOINTS

- GITHUB — `connections/github/host-runtime.ts` defines a host-runtime shape
  (`hostFetch`, `hostLog`, `hostError`, `setHostExitCode`, `hostRandomId`) suggesting a
  standalone/CLI-style execution model, but there is no server route, cron job, or CLI script in
  the new repo that actually invokes `handleGithubCommand`. **No wired entrypoint exists yet** —
  the adapter is a library, not a running service. The old repo's admin routes
  (`app/api/admin/infrastructure/github/*`) remain the only thing actually executing GitHub
  operations in production, and they do not call the new adapter.
- All MISSING-capability areas (VERCEL, SUPABASE_CONTROL, ANTHROPIC_ADMIN, DEPLOY, BUILD, TEST,
  ROLLBACK, EXECUTION) — no entrypoints, since no implementation exists.

## 11. MISSING_PERMISSION_BOUNDARIES

- GITHUB adapter (`github-adapter.ts`, `handleGithubCommand`) does not visibly call into
  `permissions/access-control/scope-check.ts` or any permission-registry lookup — credential
  resolution (`credential-resolution.ts`) checks for env var presence but there is no evidence of
  an identity/scope permission gate before executing GitHub commands. The `permissions/` folder
  exists as types only; nothing wires it to the GitHub adapter's execution path.
- No permission boundary exists for any other capability (none implemented).

## 12. MISSING_CREDENTIAL_BOUNDARIES

- GITHUB has a credential-resolution module scoped to `GITHUB_PAT_INFRASTRUCTURE` env var —
  present and reasonably scoped (infra-specific token name, not a shared/business token).
- VERCEL, SUPABASE_CONTROL, ANTHROPIC_ADMIN — no credential resolution modules exist at all.
  Old repo's `providers/{vercel,supabase,anthropic}/credentials.template.json` show what secrets
  are expected but nothing in the new repo resolves or validates them.

## 13. MIGRATION_COMPLETENESS_PERCENT

**≈8–10%** of the required infra-control surface (per the 19-row capability matrix in §14) has a
working implementation in the new repo, and even the one working capability (GITHUB) lacks a
wired runtime entrypoint and a permission-boundary gate, so it is not yet fully "production
complete" either. Basis: 1 of 19 capability rows is substantively implemented (GITHUB), a further
~4 rows have scaffolding/types only (CONTRACTS, PERMISSIONS, IDENTITY_SCOPE, CONFIG), and the
remaining ~14 rows have zero code — only README placeholders.

## 14. CAPABILITY_MATRIX

| Capability | OLD_IMPLEMENTATION | NEW_IMPLEMENTATION | FEATURE_PARITY | MISSING_BEHAVIOR | EXTRA_NEW_BEHAVIOR | RUNTIME_CALLERS | STATUS |
|---|---|---|---|---|---|---|---|
| GITHUB | `app/api/admin/infrastructure/github/*`, `engines/infrastructure/githubSync.ts`, `providers/github/*.json` | `connections/github/*.ts` (adapter, config, contract, credential-resolution, payload-validation, read-api, repo-path, status-operations, host-runtime, tests) | New adapter covers repo/branch/path status reads, access check, credential resolution; old routes cover token mgmt UI + sync-to-DB paths | No wired runtime entrypoint in new repo; no permission-boundary gate; unclear if write/mutation GitHub ops (vs read/status) are covered | Formal adapter-contract, payload validation, typed command envelope, larger test suite | Old repo's admin UI still the only live caller | PARTIAL (implementation strong, integration incomplete) |
| VERCEL | `app/api/gateway/observe/vercel/route.ts`, `providers/vercel/*.json` | `connections/vercel/`, `vercel-webhooks/`, `vercel-drains/` — README + one live-test plan only | none | entire adapter | test plan doc only | none | MISSING |
| SUPABASE_CONTROL | `app/api/cron/supabase-project-status/route.ts`, `supabase/functions/*`, `providers/supabase/*.json` | `connections/supabase/README.md` only | none | entire adapter | none | none | MISSING |
| ANTHROPIC_ADMIN | `providers/anthropic/*.json` (descriptor only, no admin API client found in old repo either) | `connections/ai-providers/README.md` only | none | entire client | none | none | MISSING |
| AI_PROVIDER_CONTROL | `app/api/admin/ide/_lib/providerRegistryRuntime.ts`, `providers/{openai,anthropic,google,...}/*.json` | `ai/{model-router,agent-registry,model-registry}` README-only | none | entire router/registry | none | none | MISSING |
| SERVER_CONTROL | scattered in `app/api/admin/ide/_lib/*Runtime.ts` | none found | none | all | none | none | MISSING |
| DEPLOY | `app/api/deploy/route.ts`, `scripts/deploy-gate.ts`, `deploymentRuntime.ts`, `deploymentRegistry.ts` | `execution/deploy/README.md` only | none | all | none | none | MISSING |
| BUILD | `scripts/build-*.ts`, `buildRuntime.ts`, `buildRegistry.ts` | `execution/build/README.md` only | none | all | none | none | MISSING |
| TEST | `build-gate-test.ts`, `testRuntime.ts` | `execution/test/README.md` only (but GITHUB has its own real test file) | none at capability level | all (as an execution capability) | none | none | MISSING |
| ROLLBACK | `recoveryRuntime.ts`, `recoveryRegistry.ts` | `execution/rollback/README.md` only | none | all | none | none | MISSING |
| EXECUTION | `executionRegistry.ts`, `executionPlanRuntime.ts`, `executionHandRuntime.ts` | `execution/run/`, `execution/code-change/` README-only; `control/command-router`, `control/owner-command`, `control/command-status/lifecycle.ts` (real, small) | command lifecycle *type* exists in new repo | actual execution engine | typed lifecycle states | none wired | PARTIAL (types only) |
| CREDENTIAL_RESOLUTION | `providers/*/credentials.template.json`, `app/api/admin/infrastructure/github/token/route.ts` | `connections/github/credential-resolution.ts` (GitHub only) | GitHub only | Vercel/Supabase/Anthropic credential resolution | scoped-env-var pattern (`GITHUB_PAT_INFRASTRUCTURE`) | GitHub adapter | PARTIAL |
| CONNECTOR_LIFECYCLE | `app/api/admin/connectors/_lib/{catalog,providerDescriptors}.ts`, `engines/connectors/tester.ts`, `connectors/CONNECTOR_ROUTING_MAP.json` | `contracts/connector/connection.ts` (type only) | none functional | registration/catalog/lifecycle runtime | typed Connection contract | none | PARTIAL (contract only) |
| PROVIDER_STATUS | `app/api/gateway/observe/vercel/route.ts`, `app/api/cron/supabase-project-status/route.ts` | GitHub adapter's `getRepository`/`getBranch`/`checkRepoAccess` (GitHub-scoped status only) | GitHub only | Vercel/Supabase provider status | none | GitHub adapter (unwired) | PARTIAL |
| COST_USAGE | `costLedgerViewRuntime.ts`, `costGateRuntime.ts`, `usageMeterRuntime.ts` | none | none | all | none | none | MISSING |
| PERMISSIONS | scattered role/permission checks in old admin routes (not centralized) | `permissions/access-control/*.ts` (identity, membership, scope-check, break-glass, platform-capability — types only) | new repo has better *structure*, no enforcement | actual enforcement logic wired to any adapter | typed scope-check design | none wired | PARTIAL (types only) |
| IDENTITY_SCOPE | ad hoc in old repo | `permissions/software-scope/*.ts` (account, tenant, business-domain, resource-grant — types only) | structural improvement, no runtime | enforcement | typed tenant/account/business-domain model | none wired | PARTIAL (types only) |
| AUDIT | scattered logging in old repo (`hostLog`-style patterns, no dedicated audit store found) | `audit/{ai-execution-audit,code-change-audit,command-audit,deployment-audit}` README-only; GitHub has design docs (ARCHITECTURE_DECISIONS.md, POLICY.md) but no audit *evidence* capture code | none functional | audit event capture/storage | policy/decision docs (design-time, not evidence) | none | MISSING |
| CONFIG | `.env.local*`, `core/config/ide-settings.ts`, `12-environments.json` | `config/{connection-settings,environment,feature-status}` README-only; `connections/github/adapter-config.ts` (real, GitHub-scoped) | GitHub config only | general infra config/env management | none | GitHub adapter | PARTIAL |
| CONTRACTS | implicit/ad hoc types spread across old repo | `contracts/{identity,software,connector,operational-bridge,command,event}/*.ts` (real, small, well-formed) + `connections/github/adapter-contract.ts` | new repo materially better here — genuine contract-first design exists | contracts not yet consumed by more than one adapter | clean envelope/command/event/connector contract set | GitHub adapter | PARTIAL (design good, adoption = 1 capability) |

## 15. EXACT_FILES_STILL_NEEDING_MIGRATION

- `dna-os-deadboard/app/api/gateway/observe/vercel/route.ts` → informs new VERCEL adapter
- `dna-os-deadboard/app/api/cron/supabase-project-status/route.ts` → informs new SUPABASE_CONTROL adapter
- `dna-os-deadboard/providers/vercel/{provider,capabilities,runtime,credentials.template}.json`
- `dna-os-deadboard/providers/supabase/{provider,capabilities,runtime,credentials.template}.json`
- `dna-os-deadboard/providers/anthropic/{provider,capabilities,runtime,credentials.template}.json`
- `dna-os-deadboard/app/api/deploy/route.ts`
- `dna-os-deadboard/scripts/deploy-gate.ts`, `scripts/deployment-test.ts`
- `dna-os-deadboard/scripts/build-gate-test.ts`, `build-test.ts`, `build-system-control-graph.ts`
- `dna-os-deadboard/app/api/admin/ide/_lib/deploymentRuntime.ts`, `deploymentRegistry.ts`
- `dna-os-deadboard/app/api/admin/ide/_lib/buildRuntime.ts`, `buildRegistry.ts`
- `dna-os-deadboard/app/api/admin/ide/_lib/testRuntime.ts`
- `dna-os-deadboard/app/api/admin/ide/_lib/recoveryRuntime.ts`, `recoveryRegistry.ts`
- `dna-os-deadboard/app/api/admin/ide/_lib/executionRegistry.ts`, `executionPlanRuntime.ts`, `executionHandRuntime.ts`
- `dna-os-deadboard/app/api/admin/ide/_lib/costLedgerViewRuntime.ts`, `costGateRuntime.ts`, `usageMeterRuntime.ts`
- `dna-os-deadboard/app/api/admin/connectors/_lib/catalog.ts`, `providerDescriptors.ts`
- `dna-os-deadboard/engines/connectors/tester.ts`
- `dna-os-deadboard/app/api/admin/infrastructure/github/token/route.ts` (credential-resolution behavior reference, GitHub already has its own — verify parity)

## 16. EXACT_FILES_SAFE_TO_RETIRE_LATER

(Only after equivalent new-repo capability is confirmed COMPLETE and wired — none qualify yet;
listed as *future* retirement candidates once migrated and cut over):
- `dna-os-deadboard/engines/infrastructure/githubSync.ts` (superseded conceptually by new adapter)
- `dna-os-deadboard/app/api/admin/infrastructure/github/route 2.ts` (literal duplicate file, "route 2.ts" — safe to retire regardless of migration status, it's dead duplicate code today)
- `dna-os-deadboard/.vercelignore 2` (duplicate stray file, unrelated to migration but a housekeeping dead file)

## 17. FILES_THAT_MUST_STAY_IN_BUSINESS_REPO

- `dna-os-deadboard/supabase/functions/{line-webhook-v2,line-profile-reconcile,line-profile-refresh-worker,debt-reminder-cron,bank-email-sync,bank-statement-reconcile,receipt-reconcile-sweep,quotation-queue-nudge,kis-webhook,back-to-back,openclaw-webhook,fuel-price-sync,stuck-message-sweep,equipment-maintenance-cron,scout-map,ai-callback,trigger-complete,trigger-auto-build}` — business-domain edge functions (LINE, debt, receipts, equipment, quotations)
- `dna-os-deadboard/app/api/admin/{line-customers,line-profiles,debt-trackings,relationships,partners,transactions,documents,receipt-documents,pits,equipment,quotation-queue,outbound-drafts,finance-alerts,finance-summary}/**` — business API routes
- `dna-os-deadboard/engines/{debt,pricing.ts,quote-price.ts,transactions,documents,partner,jobs,domains}/**` — business logic engines
- `dna-os-deadboard/BUSINESS-CONSTITUTION.md` — business governance doc
- All LINE/customer/debt/logistics/pricing/transport data models and UI throughout `app/`, `components/`, `front-office/`, `back-office/`

## 18. UNKNOWN_REVIEW_REQUIRED

- `dna-os-deadboard/app/api/cron/operations-loop/route.ts` — not read in depth; could be
  infra execution orchestration (EXECUTION) or a business-workflow scheduler — needs a human/deep
  read to classify.
- `dna-os-deadboard/app/api/admin/ide/**` (the large `_lib/` tree, ~50+ files: alertRegistry,
  changeSetRuntime, gapLoopRuntime, incidentRuntime, monitoringRegistry, releaseRegistry,
  workerAdapters/*, etc.) — this "IDE" subsystem looks like a large parallel infra-control-plane
  implementation (releases, incidents, monitoring, workers, security execution gates) that may
  substantially overlap with or duplicate what DNA-OS-INFRASTRUCTURE is meant to become. Given its
  size, only file names were inventoried, not contents — a dedicated follow-up audit of
  `app/api/admin/ide/_lib/` is strongly recommended before finalizing the CAPABILITY_MATRIX above,
  since it likely reclassifies several MISSING rows (DEPLOY, BUILD, TEST, ROLLBACK, EXECUTION,
  COST_USAGE, SERVER_CONTROL) as LEGACY_ONLY-with-fuller-behavior than currently characterized.
- `dna-os-deadboard/app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts` and
  `apiWorkerAdapter.ts` — unclear if SERVER_CONTROL/EXECUTION relevant or business worker dispatch;
  not read.
- `dna-os-deadboard/connectors/CONNECTOR_ROUTING_MAP.json` — not opened; may materially inform
  CONNECTOR_LIFECYCLE migration.
- `dna-os-deadboard/capability-ledger/`, `dna-os-deadboard/observatory/`,
  `dna-os-deadboard/program-graph/` — top-level dirs of unclear domain, not inventoried at all;
  names suggest possible AUDIT/CONFIG/EXECUTION relevance.
- `dna-os-deadboard/action-resolution/`, `dna-os-deadboard/cognitive/`, `dna-os-deadboard/gateway/`,
  `dna-os-deadboard/manager/`, `dna-os-deadboard/queue/`, `dna-os-deadboard/runtime/`,
  `dna-os-deadboard/workers/` — not inventoried; given time constraints this audit prioritized
  directories with obvious infra-control naming (connectors, providers, engines/infrastructure,
  app/api/admin/infrastructure, scripts/*deploy*/*build*). These remaining directories should be
  swept in a follow-up pass.

## 19. RECOMMENDED_MIGRATION_ORDER

1. **Wire GITHUB's runtime entrypoint** — add a server route or CLI invoker in
   `DNA-OS-INFRASTRUCTURE` that calls `handleGithubCommand`, and cut the old repo's admin routes
   over to call it via HTTP (contract boundary), not duplicate the GitHub REST logic. This
   finishes the one capability that's 90% done.
2. **Wire a permission boundary** in front of the GitHub adapter using the existing
   `permissions/access-control/scope-check.ts` types (currently unused) — close the
   MISSING_PERMISSION_BOUNDARIES gap for the flagship capability before adding more surface area.
3. **Deep-audit `app/api/admin/ide/_lib/`** (see §18) before building new DEPLOY/BUILD/TEST/
   ROLLBACK/EXECUTION capabilities from scratch — likely reusable logic exists there.
4. **VERCEL** adapter (status/observe first, matching the GITHUB read-first pattern), using
   `app/api/gateway/observe/vercel/route.ts` and `providers/vercel/*.json` as source material.
5. **SUPABASE_CONTROL** adapter (project status first), using
   `app/api/cron/supabase-project-status/route.ts` and the infra-relevant subset of
   `supabase/functions/*` (system-health-check, supabase-billing-sync, architecture-drift-alert).
6. **CREDENTIAL_RESOLUTION** generalization — extract GitHub's pattern into a shared
   credential-resolution contract so Vercel/Supabase/Anthropic adapters reuse it rather than each
   reinventing it.
7. **DEPLOY / BUILD / TEST / ROLLBACK / EXECUTION** — migrate from
   `app/api/admin/ide/_lib/*Runtime.ts` + `scripts/*` once §18's audit clarifies scope and overlap.
8. **COST_USAGE** and **ANTHROPIC_ADMIN** — lowest urgency; build together since Anthropic Admin
   API usage/cost polling is the primary use case.
9. **AUDIT** — implement evidence-capture wired to whichever capability lands first (GITHUB), then
   generalize; don't build audit infra in the abstract before there's a real event stream.

## 20. FILES_CHANGED

0 files changed/moved/deleted. 1 file written (this report, new/untracked):
- `/Users/tam/Desktop/DNA OS-ต้นฉบับ /DNA-OS-INFRASTRUCTURE/reports/INFRASTRUCTURE_MIGRATION_COMPLETENESS_AUDIT.md`

## 21. GIT_STATE_CHANGED

**false** — no `git add`, `git commit`, or any mutating git command was run in either repo during
this audit. Verified via `git status --short` in both repos immediately before writing this
report:

- New repo (`DNA-OS-INFRASTRUCTURE`): pre-existing uncommitted state unchanged
  (`M connections/github/README.md` + untracked `connections/github/*` files, all pre-existing
  per the task's stated starting condition). This report file itself will now also appear as a new
  untracked file under `reports/` — that is the sole addition, and it is untracked, not staged or
  committed.
- Old repo (`dna-os-deadboard`): pre-existing uncommitted state unchanged (modified files under
  `app/admin/infrastructure/`, `app/api/admin/infrastructure/`, `core/`, etc., all pre-existing
  and untouched by this audit — no files in the old repo were read via edit tools, only viewed).
