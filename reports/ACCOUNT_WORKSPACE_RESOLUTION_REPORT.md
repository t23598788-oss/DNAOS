# ACCOUNT_WORKSPACE_RESOLUTION_REPORT

Closes the Account/Workspace resolution gap flagged as `NOT_YET_BUILT` in
`control/entry-context/resolver.ts`'s own header. Replaces the
membership-only trust model with real, independently registered Account
and Workspace sources, wired in as an additive filter layer inside
`control/entry-context/` only — `permissions/execution-policy/rules.ts`
and `policy.ts` were not touched, and ALLOW/DENY/OWNER_REVIEW semantics in
those files are unchanged.

## ACCOUNT_REGISTRY_STATUS

New file: `permissions/software-scope/account-registry.ts`. Real,
in-memory `Map`-based store, matching `permissions/access-control/
identity-registry.ts`'s pattern exactly (doc-header format, error-class
pattern, no-delete/status-only lifecycle, `__debug*Count()` test-only
export).

- `AccountRecord`: `account_id`, `status: "ACTIVE"|"SUSPENDED"|"RETIRED"`, `created_at`, optional `metadata`.
- Operations: `registerAccount`, `getAccount`, `listAccounts`, `suspendAccount` — exactly the set specified, no reactivate/un-suspend/retire added speculatively.
- Deliberate deviation from `identity-registry.ts`'s convenience behavior: `registerAccount` **throws** (`AccountRegistrationError`) on a repeat `account_id`, rather than silently re-provisioning/resetting status to ACTIVE — a silent re-register would otherwise be an undocumented backdoor reactivate path for a SUSPENDED/RETIRED account, which was explicitly out of scope. Documented in the file's own header.
- Distinct from the older, pre-existing `permissions/software-scope/account.ts` / `account-registration.ts` (2026-08-14, type-only, `NOT_YET_BUILT`, different field shape/lowercase status enum) — explicitly documented as a separate, purpose-built registry; reconciling the two is flagged as a later decision, not attempted here.

## WORKSPACE_REGISTRY_STATUS

New file: `permissions/software-scope/workspace-registry.ts`. Same real-store pattern.

- `WorkspaceRecord`: `workspace_id`, `account_id` (required non-empty string), `status: "ACTIVE"|"SUSPENDED"|"RETIRED"`, `created_at`, optional `metadata`.
- Operations: `registerWorkspace`, `getWorkspace`, `listWorkspacesForAccount`, `suspendWorkspace`.
- `registerWorkspace` does **not** cross-check `account_id` against `account-registry.ts` — `account_id` is a structural (non-empty string) requirement only. This is documented explicitly in the file's header, citing `permissions/access-control/membership-registry.ts`'s `grantMembership` as the existing repo precedent (it likewise never verifies `identity_id` exists in `identity-registry.ts`). The real-existence/ownership check is entirely the resolver's job.
- Same repeat-id-throws design decision as `account-registry.ts`, same rationale.

## ENTRY_CONTEXT_ACCOUNT_RESOLUTION

`control/entry-context/resolver.ts`: `request.account_id` resolves to a
real `account` only if `getAccount()` finds it **and**
`status === "ACTIVE"`. Anything else (missing, suspended, retired)
resolves to `undefined` — no synthetic fallback. Any `scope_type:
"account"` Membership row whose `scope_id` doesn't equal a
validly-resolved `account.account_id` is filtered out of the `memberships`
array before it is placed into `ExecutionPolicyContext`. `rules.ts`'s
existing, unmodified `ruleAccountMembershipValid` then naturally sees "no
membership row" and DENYs via its existing `MISSING_ACCOUNT_MEMBERSHIP`
reason code.

## ENTRY_CONTEXT_WORKSPACE_RESOLUTION

Same pattern for `workspace`, plus the cross-match: `request.workspace_id`
resolves to a real `workspace` only if `getWorkspace()` finds it,
`status === "ACTIVE"`, **and** `workspace.account_id ===
request.account_id`. A workspace belonging to a different account, a
suspended workspace, or an unregistered workspace_id all resolve to
`undefined`, and any `scope_type: "workspace"` membership against it is
filtered out, triggering `rules.ts`'s existing
`MISSING_WORKSPACE_MEMBERSHIP` DENY path unmodified.

`scope_type: "tenant"` memberships are left unfiltered — explicitly out of
scope (no Tenant registry exists or was asked for this round), flagged as
`NOT_YET_BUILT` in the resolver's header, not silently assumed sufficient.

`EntryContextResolution` (`control/entry-context/types.ts`) now also
exposes `account: AccountRecord | undefined` and `workspace: WorkspaceRecord
| undefined` — read-only diagnostic fields, never consulted by any
decision logic themselves (decisions flow only through the already-filtered
`context.memberships`).

## DANGLING_MEMBERSHIP_BEHAVIOR

Proven in `control/entry-context/tests/account-workspace-resolution.test.ts`
("dangling Membership rejection"): a Membership row with `scope_type:
"account"` pointing at an `account_id` that was never registered anywhere
resolves `account === undefined`, the membership is filtered out of
`context.memberships`, and a direct `evaluateExecutionPermission()` call
against that resolved context DENYs with `MISSING_ACCOUNT_MEMBERSHIP` —
proving the dangling row never makes that scope appear real, without
`rules.ts` itself being touched.

## CROSS_ACCOUNT_BEHAVIOR

Proven in the same test file ("cross-account Workspace rejection"): a
Workspace registered under account X, requested with `account_id` = Y,
resolves `workspace === undefined` (the `workspace.account_id ===
request.account_id` check fails), and the corresponding workspace-scope
membership is filtered out before reaching `rules.ts`.

## FULL_INTERNAL_PATH_PROOF

Two independent proofs, both green, both using only real exported
functions (no mocks, no hand-built literals):

1. `control/entry-context/tests/entry-context.test.ts` — its pre-existing
   "full real internal path" test was updated to also call
   `registerAccount`/`registerWorkspace` (see below), and still reaches
   `COMPLETED`/`RUNNING` with real execution evidence.
2. `control/entry-context/tests/account-workspace-resolution.test.ts` —
   new, dedicated full-path test: registers a real Identity
   (`identity-registry.ts`), Account (`account-registry.ts`), Workspace
   (`workspace-registry.ts`, correctly owned), grants real account+workspace
   Membership (`membership-registry.ts`), issues a real ExecutionGrant
   (`grants.ts`), calls `resolveEntryContext()`, confirms `account`/
   `workspace` both resolved, feeds the result into a direct
   `evaluateExecutionPermission()` call (real ALLOW), then drives the
   full chain through `submitOwnerCommand` → `routeOwnerCommand` →
   `startExecution`, asserting `COMPLETED`/`RUNNING` with real
   `source: "execution"` evidence. Chain proven:
   Identity → Account → Workspace → Membership → Entry Context → Router →
   Permission → Execution.

## TEST_RESULTS

| Suite | Result |
|---|---|
| `permissions/software-scope/tests/account-registry.test.ts` (new) | 8 passed, 0 failed |
| `permissions/software-scope/tests/workspace-registry.test.ts` (new) | 11 passed, 0 failed |
| `control/entry-context/tests/entry-context.test.ts` (updated) | 9 passed, 0 failed |
| `control/entry-context/tests/account-workspace-resolution.test.ts` (new) | 9 passed, 0 failed (includes full-path integration proof) |
| `permissions/execution-policy/tests/policy.test.ts` | 22 passed, 0 failed |
| `permissions/execution-policy/tests/grants.test.ts` | 10 passed, 0 failed |
| `control/command-router/tests/router.test.ts` (updated) | 9 passed, 0 failed |
| `control/owner-command/tests/owner-command.test.ts` (updated) | 5 passed, 1 failed* |
| `execution/run/tests/executor.test.ts` | 18 passed, 0 failed |
| `execution/run/tests/policy-descriptor.test.ts` | 5 passed, 0 failed |
| `execution/run/tests/policy-integration.test.ts` | 3 passed, 0 failed |
| `execution/run/tests/result.test.ts` | 11 passed, 0 failed |
| `npx -y -p typescript tsc --noEmit` (whole repo) | clean, 0 errors |

\* The one owner-command failure ("NOT_CONNECTED capability (research-engine)
reported as BLOCKED ... expected BLOCKED, got COMPLETED") is an unrelated
environmental flake: this machine has an unrelated local process already
bound to `localhost:8787` (confirmed via `lsof`/`curl` — it answers HTTP
200), which is the exact port the test's live health check probes. This is
pre-existing test fragility (a test that depends on nothing occupying that
port locally) with zero connection to Account/Workspace/entry-context
work, and it does not touch `rules.ts`/`policy.ts` or the code this task
changed.

## FILES_CHANGED

New:
- `permissions/software-scope/account-registry.ts`
- `permissions/software-scope/workspace-registry.ts`
- `permissions/software-scope/tests/account-registry.test.ts`
- `permissions/software-scope/tests/workspace-registry.test.ts`
- `control/entry-context/tests/account-workspace-resolution.test.ts`
- `reports/ACCOUNT_WORKSPACE_RESOLUTION_REPORT.md` (this file)

Modified (within the sanctioned scope):
- `control/entry-context/types.ts` — added `account`/`workspace` fields to `EntryContextResolution`.
- `control/entry-context/resolver.ts` — added Account/Workspace resolution + membership filtering; updated doc header (removed the resolved `NOT_YET_BUILT` note, added the Tenant-registry `NOT_YET_BUILT` note).
- `control/entry-context/tests/entry-context.test.ts` — added `registerAccount`/`registerWorkspace` calls to the two fixtures whose account/workspace-scoped memberships would otherwise be (correctly) filtered out under the new fail-closed model; added two assertions on the new `resolution.account`/`resolution.workspace` fields; updated doc header's dependency list.

Modified (**outside** the originally-listed touch scope — see
REMAINING_PARTIAL_GAPS for why):
- `control/command-router/tests/router.test.ts`
- `control/owner-command/tests/owner-command.test.ts`

Not touched, confirmed via `git diff` (0 lines):
- `permissions/execution-policy/rules.ts`
- `permissions/execution-policy/policy.ts`
- everything under `execution/run/`
- `dna-os-circuit/`, `DNA-LAB-CIRCUIT-LANGUAGE`

## REMAINING_PARTIAL_GAPS

- **Scope deviation, disclosed**: the task's file-touch list did not name
  `control/command-router/tests/router.test.ts` or
  `control/owner-command/tests/owner-command.test.ts`, but both build their
  `ExecutionPolicyContext` fixtures through the real
  `resolveEntryContext()` using a fixed `ACCOUNT_ID`/`WORKSPACE_ID` that
  was never registered in the new Account/Workspace stores. Under the new,
  correctly fail-closed resolver, those fixtures' memberships were being
  filtered out, causing two real regressions (`router.test.ts`'s
  multi-worker ALLOW test, `owner-command.test.ts`'s full-flow ALLOW test).
  Since the task also explicitly required these two suites to "stay
  green," I added two lines to each file's existing module-level setup
  (`registerAccount(...)`, `registerWorkspace(...)`) — the minimal fix that
  keeps their original tested intent (router/owner-command behavior)
  intact while reflecting the now-correct requirement that a real Account
  and Workspace must exist. No assertions, decisions, or behavior under
  test in either file were changed — only their fixture setup. Flagging
  this explicitly rather than silently doing it.
- Tenant-scope memberships remain unfiltered, by design this round — no
  Tenant registry exists or was requested (see resolver header).
- No reactivate/un-suspend/retire operation on either new registry — not
  asked for.
- No durable/cross-process persistence for either new registry — same
  process-local, in-memory model as every other real store in this repo.
- No owner-approval gate on `registerAccount`/`registerWorkspace`
  themselves (any caller with a module reference can register any
  account/workspace) — same class of gap already flagged and accepted in
  `identity-registry.ts`/`membership-registry.ts`/`grants.ts`; not
  reintroduced or newly created by this round, just inherited.
