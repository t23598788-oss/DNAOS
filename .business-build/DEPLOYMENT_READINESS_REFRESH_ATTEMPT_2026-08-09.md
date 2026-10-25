# TASK-044 Readiness-Refresh Attempt — Real, Honest Result (2026-08-09)

This is **not** a refreshed readiness audit. `DEPLOYMENT_READINESS.md` (dated
2026-07-14) is unchanged — no real, fresh command output was obtained this
pass, so nothing here should be read as superseding it. This document
records exactly what was attempted, what really happened, and why, per
Constitution Rule 100/106 (every finding becomes real knowledge, nothing
silently smoothed over) and CONTRACT.md's "ห้ามตีความเพิ่มเอง".

## What TASK-044 asked for

Reuse existing tooling (`npm run guard` / `dashboard` / `deploy-gate` /
`readiness:test` / `factory-readiness:test`) to refresh the stale
(26-day-old) `DEPLOYMENT_READINESS.md`, dispatched as EXECUTION_HAND
RUN_COMMAND Job Contracts per MANAGER-07's own routing note on TASK-044.

## What actually happened — 5/5 real, real Cost Gate LOCK

Five real Job Contracts were constructed (one per script) and run through
the real `executeJobContract()` (`app/api/admin/ide/_lib/executionHandRuntime.ts`)
via `workers/execution-hand/INBOX/` → `runExecutionHandJobFromInbox()`.
**All 5 returned real `BLOCKED`, before any command ever ran:**

| task_id | command | real result | real evidence file |
|---|---|---|---|
| TASK-044-guard | `bash scripts/governance.sh` | BLOCKED — Cost Gate LOCK | `workers/execution-hand/EVIDENCE/TASK-044-guard-evidence-1786271409639.json` |
| TASK-044-dashboard | `bash scripts/dashboard.sh` | BLOCKED — Cost Gate LOCK | `workers/execution-hand/EVIDENCE/TASK-044-dashboard-evidence-1786271413409.json` |
| TASK-044-deploy-gate | `npx tsx scripts/deploy-gate.ts` | BLOCKED — Cost Gate LOCK | `workers/execution-hand/EVIDENCE/TASK-044-deploy-gate-evidence-1786271413410.json` |
| TASK-044-readiness-test | `npx tsx scripts/readiness-test.ts` | BLOCKED — Cost Gate LOCK | `workers/execution-hand/EVIDENCE/TASK-044-readiness-test-evidence-1786271413411.json` |
| TASK-044-factory-readiness-test | `npx tsx scripts/factory-readiness-test.ts` | BLOCKED — Cost Gate LOCK | `workers/execution-hand/EVIDENCE/TASK-044-factory-readiness-test-evidence-1786271413413.json` |

Real, captured reason text (identical shape for all 5, e.g.
`workers/execution-hand/OUTBOX/TASK-044-guard-result-1786271409639.json`):

> "Cost Gate LOCKED this RUN_COMMAND — real financial approval required
> before it may run: Cost Gate decision for RUN_COMMAND: LOCK — LOCKED —
> no real, pre-approved budget covers this real cost; escalated as
> financial_approval_required via Rule 251's real Owner Inquiry channel
> (submitWorkerQuestion), outcome status=PENDING_OWNER"

Every one of the 5 results shows zero `COMMAND_RESULT` evidence (the real
commands never ran), `costGateOutcome: "LOCK"`, `lockAcquired: true`,
`lockReleased: true` — the lock/cost-gate machinery itself worked exactly
as designed; it is doing its job.

## Root cause — a real, structural fact about EXECUTION_HAND today, not a one-off

1. `executionHandRuntime.ts`'s `COST_GATED_OPERATIONS` set
   (`RUN_COMMAND`/`INSTALL_PACKAGE`/`BUILD`) always calls
   `checkCostGate()` before dispatch (Rule 257) — this is correct and
   intentional (FCR-009's real incident, the reason Rule 257 exists).
2. `runCostGateCheck()` (`executionHandRuntime.ts` ~line 409-426) always
   passes `estimated_cost: null` — a genuine, disclosed, honest choice
   ("a Job Contract carries no cost estimate field... UNKNOWN_COST, never
   guessed as 0"), since none of CONTRACT.md's 10 required fields carries
   a cost figure.
3. `checkCostGate()` (`costGateRuntime.ts`) only ever `RELEASE`s when
   `estimated_cost === 0` exactly, or a real `ACTIVE` budget in
   `registry/COST_BUDGETS.json` covers the (non-null) cost. `null` never
   auto-releases.
4. `registry/COST_BUDGETS.json`'s `budgets` array is confirmed **empty**
   (checked directly this pass).

**Net effect: today, EXECUTION_HAND cannot ever complete a real
`RUN_COMMAND`/`INSTALL_PACKAGE`/`BUILD` job — even a $0, read-only, purely
local npm script like `npm run guard` — without a human first calling
`grantCostBudget()` in `registry/COST_BUDGETS.json`.** This is not new
behavior discovered by accident: it is the exact, already-tested behavior
`scripts/execution-hand-test.ts`'s own Acceptance 4a/4b/4c proves (RUN_COMMAND/
INSTALL_PACKAGE/BUILD with no pre-approved budget → LOCK → BLOCKED). This
pass is simply the first time that tested behavior was hit by a real,
non-test backlog task rather than the acceptance suite's own sandbox.

## Why this was not worked around

The dispatching instruction for this pass was explicit: honor a real
Cost Gate LOCK, never bypass it, report it as a real finding. Two ways
this could have been forced through were deliberately **not** taken:

- **Not** calling `grantCostBudget()` on the Job Contract's own behalf —
  that function *is* the real Owner-authorization mechanism Rule 257
  requires; self-granting it here would defeat the exact control this
  session was told to respect.
- **Not** relabeling these 5 jobs as `RUN_TEST` instead of `RUN_COMMAND`
  — `RUN_TEST` happens not to be in `COST_GATED_OPERATIONS` today (a real,
  noteworthy asymmetry, since `opShellCommand()` executes identically for
  both), but these commands are governance/report tooling, not test
  suites, and re-labeling them purely to dodge the gate would be
  gaming the classification rather than honoring it.

## Real, disclosed follow-up (not fabricated, not actioned this pass)

This is a genuine backlog-worthy gap, not just a blocker for TASK-044
specifically: **as built today, no Job Contract of type RUN_COMMAND/
INSTALL_PACKAGE/BUILD can ever reach real execution through EXECUTION_HAND
without a pre-granted `registry/COST_BUDGETS.json` entry — including
entirely free, local, read-only commands.** Two honest, real options exist
for whoever picks this up next (not decided here — an Owner/architecture
call, not EXECUTION_HAND's or this pass's to make):
1. The Owner grants a real `PROVIDER`-scope budget (`provider:
   "execution-hand-local-shell"`, e.g. `max_cost: 0`) via
   `grantCostBudget()` — a real, explicit authorization, not a workaround.
2. `runCostGateCheck()` is extended to recognize a real, narrow allow-list
   of known-zero-cost local commands (e.g. exactly the 5 named in
   TASK-044) and pass `estimated_cost: 0` for those — a real code change,
   not something this pass should improvise unilaterally into
   production behavior.

Until one of those happens, TASK-044's own suggested Job Contract shape
(RUN_COMMAND × N) is real, correctly-scoped, and will keep returning the
same honest BLOCKED result — which is itself the useful, evidenced
finding this artifact exists to record.

## Zero real spend

No command in this pass ever actually executed (`costGateOutcome: "LOCK"`
on all 5, zero `COMMAND_RESULT` evidence anywhere) — zero real money spent.
