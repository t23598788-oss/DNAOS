# EXECUTION-SCOPE PERMISSION LAYER — BUILD REPORT

Scope: `permissions/execution-policy/` in DNA-OS-INFRASTRUCTURE.
Built per Owner instruction 2026-08-16, ahead of migrating the EXECUTION
runtime, per the block condition raised in
`reports/EXECUTION_MIGRATION_PLAN.md` STEP 9 (wiring a runtime entrypoint
before this layer exists would recreate the old repo's own gap: no
execution-scope permission decision distinct from the coarse ADMIN_TIER
check).

No runtime wiring was done. No executor was imported. No `spawn()` was
called. BUILD/TEST code was not touched. Nothing was staged, committed,
pushed, or deployed.

---

## 1. CONTRACT

Defined in `permissions/execution-policy/types.ts`, re-exported (only)
through `permissions/execution-policy/contract.ts`.

**`ExecutionPermissionRequest`**
```
identity_id: string
account_id: string
workspace_id: string
capability: string
command_id: string
action: string
cwd_scope: string
requested_args: readonly string[]   // structured tokens only — never a joined shell string
correlation_id: string
```

**`ExecutionPermissionDecision`**
```
decision: "ALLOW" | "DENY" | "OWNER_REVIEW"
reason_codes: readonly ExecutionReasonCode[]
matched_rules: readonly string[]
denied_rules: readonly string[]
scope: { account_id, workspace_id, capability, command_id }
expires_at?: string        // present only on ALLOW, taken from the matching grant
evidence: readonly RuleEvidence[]
decision_id: string
correlation_id: string
decided_at: string
```

**`RuleEvidence`** (one per rule evaluated — never a bare boolean):
```
rule_id: string
input_field: string
expected: string
actual: string
result: "pass" | "fail" | "skipped"
```

Two supporting inputs the caller must resolve and supply — this module
resolves neither itself:
- **`CommandPolicyDescriptor`** — `command_id`, `required_capability`,
  `allowed_actions`, `allowed_cwd_scope_prefixes`. The only command
  metadata this layer may read; it is not the executor or the allowlist
  registry itself.
- **`ExecutionGrant`** — `grant_id`, `identity_id`, `account_id`,
  `workspace_id`, `capability`, `command_id`, `action`,
  `cwd_scope_prefix`, `effect: "allow"|"deny"`, `granted_at`,
  `revoked_at?`, `expires_at?`. The only source of ALLOW — absence of a
  grant is DENY, never a default-allow.

---

## 2. POLICY_RULES

Nine rules, evaluated in this fixed order (`policy.ts`), each returning
`continue` or a terminal outcome:

1. **well_formed_request** — every required string field non-empty,
   `requested_args` is an array of strings.
2. **identity_known** — `context.identity` resolved and its
   `identity_id` matches the request.
3. **account_membership_valid** — an active (non-revoked) `account`-scope
   Membership exists for `request.account_id`.
4. **workspace_membership_valid** — same, for `workspace`-scope and
   `request.workspace_id`. A valid account membership never implies a
   valid workspace membership.
5. **command_known** — `context.command.command_id` matches
   `request.command_id`.
6. **capability_scope** — `request.capability` equals
   `command.required_capability` exactly.
7. **action_scope** — `request.action` is in `command.allowed_actions`.
8. **cwd_scope** — `request.cwd_scope` falls under one of
   `command.allowed_cwd_scope_prefixes`.
9. **resolve_grant** (terminal, the only rule that may ALLOW) — finds
   every `ExecutionGrant` matching identity/account/workspace/capability/
   command/action/cwd-prefix, then applies in order: malformed
   `effect` → `OWNER_REVIEW`; any matching unexpired `deny` grant →
   `DENY` (explicit deny overrides allow); no matching `allow` grant →
   `DENY`; all matching allow grants revoked → `DENY`; all matching
   allow grants expired → `DENY`; otherwise the earliest-granted valid
   allow grant → `ALLOW` (with its `expires_at`, if any, carried onto the
   decision).

---

## 3. FAIL_CLOSED_RULES

Every one of these is a `DENY` (or, for the two ambiguous-state cases,
`OWNER_REVIEW` — never `ALLOW`), enforced structurally: rules 1–8 return
a type (`GateOutcome`) that excludes `ALLOW` at compile time, so only
`resolveGrant`'s `TerminalOutcome` can ever produce it.

| Condition | Outcome |
|---|---|
| missing identity | DENY (`UNKNOWN_IDENTITY`) |
| missing account membership | DENY (`MISSING_ACCOUNT_MEMBERSHIP`) |
| missing workspace membership | DENY (`MISSING_WORKSPACE_MEMBERSHIP`) |
| revoked membership | DENY (`REVOKED_MEMBERSHIP`) |
| unknown command | DENY (`UNKNOWN_COMMAND`) |
| cross-capability | DENY (`CROSS_CAPABILITY`) |
| action not allowed | DENY (`ACTION_NOT_ALLOWED`) |
| cwd scope violation | DENY (`CWD_SCOPE_VIOLATION`) |
| explicit deny grant | DENY (`EXPLICIT_DENY`) — overrides any allow |
| revoked grant | DENY (`REVOKED_GRANT`) |
| expired grant | DENY (`EXPIRED_GRANT`) |
| no matching grant | DENY (`NO_MATCHING_GRANT`) |
| malformed grant.effect (unknown critical state) | `OWNER_REVIEW` (`AMBIGUOUS_GRANT_STATE`) — never DENY-and-forget, never ALLOW |
| malformed request | DENY (`MALFORMED_REQUEST`) |
| internal exception during evaluation | DENY (`POLICY_EVALUATION_ERROR`) — caught in `policy.ts`, never thrown to the caller |

`Membership` (see `permissions/access-control/membership.ts`) has no
expiry field, only `revoked_at` — there is no separate "expired
membership" state to detect, so no `EXPIRED_MEMBERSHIP` reason code was
invented. This is a real gap in the underlying Membership model, not a
gap in this policy layer; flagged here rather than fabricated.

No `MISSING_IN_OLD_IMPLEMENTATION` items apply to this round — the task
was to build a layer that did not exist in the old repo at all (the old
repo's execution engine sits behind a coarse `requireAuth(ADMIN_TIER)`
check only, per `reports/EXECUTION_MIGRATION_PLAN.md` §11 — there is no
old execution-scope permission implementation to compare against).

---

## 4. EVIDENCE_FORMAT

Every decision carries `evidence: RuleEvidence[]` — the full list of
rules actually evaluated, in order, up to and including the one that
decided the outcome. Each entry is constructed only via
`evidence.ts`'s `pass()` / `fail()` / `skipped()`, so `rule_id`,
`input_field`, `expected`, and `actual` are always populated strings —
there is no code path that produces an evidence entry with a missing
field, and no decision is ever returned with zero evidence entries.

---

## 5. TEST_RESULTS

`permissions/execution-policy/tests/policy.test.ts` — a plain program
(no test framework or `package.json` exists in this repo yet, matching
`connections/github/adapter.test.ts`'s precedent), fully offline, no
clock reads (every call passes an explicit `nowIso`), imports only
`contract.ts` (proving the public surface alone is sufficient for a real
caller).

Run: `npx tsx permissions/execution-policy/tests/policy.test.ts`

```
PASS  valid allowed command -> ALLOW
PASS  explicit deny overrides an existing allow grant -> DENY
PASS  revoked allow grant -> DENY
PASS  expired allow grant -> DENY
PASS  unexpired allow grant (future expiry) -> ALLOW, decision carries expires_at
PASS  cross-account (no membership for the requested account) -> DENY
PASS  cross-workspace (no membership for the requested workspace) -> DENY
PASS  cross-capability (request capability does not match command's required_capability) -> DENY
PASS  unknown command -> DENY
PASS  missing account membership -> DENY
PASS  missing workspace membership -> DENY
PASS  revoked account membership -> DENY
PASS  action not in command's allowed_actions -> DENY
PASS  cwd_scope outside command's allowed prefixes -> DENY
PASS  no matching grant at all -> DENY
PASS  unknown critical field (malformed grant.effect) -> non-ALLOW (OWNER_REVIEW)
PASS  malformed request (missing identity_id) -> non-ALLOW (DENY)
PASS  malformed request (requested_args not an array of strings) -> non-ALLOW (DENY)
PASS  missing identity in context -> DENY
PASS  policy evaluation exception -> fail closed (DENY, never throws)
PASS  same identity has different execution rights in different accounts
PASS  same identity has different execution rights in different workspaces

22 passed, 0 failed
```

Also verified: `npx tsc --noEmit -p tsconfig.json` — clean, zero errors,
under this repo's existing `strict: true` config. No new dependency or
config file was added; the type-check and test run both used ephemeral
`npx` invocations only.

---

## 6. FILES_CHANGED

Created (all new, all inside `permissions/execution-policy/`):
- `types.ts`
- `evidence.ts`
- `rules.ts`
- `policy.ts`
- `contract.ts`
- `tests/policy.test.ts`

Modified:
- `README.md` (updated from `NOT_YET_BUILT` placeholder to reflect the
  built policy layer and its explicit remaining scope boundary)

No file outside `permissions/execution-policy/` was created, edited, or
deleted. No file in `dna-os-deadboard` was touched. Nothing was staged
(`git add`) or committed by this work — `git status --porcelain` in
DNA-OS-INFRASTRUCTURE shows these 7 files as untracked/unstaged modified,
alongside the pre-existing staged `connections/github/**` work from an
earlier, unrelated task, which this round did not touch.

---

## 7. RUNTIME_WIRING = NOT_STARTED

Confirmed by construction, not just by report: `contract.ts` and its
transitive imports (`policy.ts`, `rules.ts`, `evidence.ts`, `types.ts`)
import nothing from `execution/`, `control/command-router/`,
`control/owner-command/`, or any route/entrypoint file. `grep -rn
"spawn(" permissions/` returns no matches. No file under `execution/` or
`control/` was created, read for editing, or modified.

---

## 8. EXECUTION_MIGRATION_READY = false

Blockers, per `reports/EXECUTION_MIGRATION_PLAN.md`'s own migration
sequence (this round completed only its step 2, "policy/validation"):

1. **`execution/run/` core (contract/registry/executor/result/audit)
   still `NOT_YET_BUILT`** — this round deliberately did not create it
   (explicit instruction: do not migrate the executor yet, do not call
   `spawn()`).
2. **`control/command-router/` and `control/owner-command/` still
   `NOT_YET_BUILT`** — there is no real caller yet that resolves
   Identity/Membership context and calls `evaluateExecutionPermission()`.
3. **No real `CommandPolicyDescriptor` source exists yet** — this policy
   layer can validate against one, but nothing in the repo currently
   produces one from a real command allowlist (that allowlist itself is
   part of the still-unmigrated `execution/run/registry.ts` equivalent).
4. **No real `ExecutionGrant` storage/issuance exists yet** — the grant
   model is designed and tested against synthetic fixtures only; there is
   no owner-facing flow yet to actually grant, revoke, or expire one.

None of these are defects in this round's deliverable — they are the
expected next steps in the migration sequence this round was scoped to
precede, not perform.

---

**FILES_CHANGED:** 7 (6 created, 1 modified) — all inside
`permissions/execution-policy/`, all uncommitted, unstaged for commit by
this task.
**GIT_STATE_CHANGED:** false (no `git add`, no `git commit`, no `git
push` was run).
