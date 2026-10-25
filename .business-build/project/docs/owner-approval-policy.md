# Owner Approval Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. No registry file was changed to produce this document.

## Objective

Formalize what "explicit owner approval" actually means as a recognized signal, since nearly every other document in this set (`deployment-gate-policy.md`, `release-policy.md`, `production-freeze-policy.md`, `domain-migration-policy.md`) defers to it without defining it. This document is that definition.

## Current state (verified, not assumed)

This repo already has a real, working approval ladder — `registry/CONSTITUTION.json`'s recommendation/approval levels, rendered in `CLAUDE.md`:

| Level | Meaning | Who approves |
|---|---|---|
| 1 | Informational | Runtime logs, proceeds |
| 2 | Recommended (safe refactor) | Runtime auto-approves |
| 3 | High impact (e.g. API change) | Runtime does impact analysis, plan awaits review |
| 4 | Approval required (high risk) | Owner/CEO via dashboard |
| 5 | Forbidden | Runtime refuses outright |

Two real, already-observed precedents in this session show the ladder's Level 4 boundary being exercised correctly:

- **Rejection, not inference**: when this session proposed clarifying questions (via a structured question tool) about the Domain Infrastructure mission's scope, the owner rejected that tool call outright rather than answering it — and this session correctly stopped and waited rather than proceeding on a guess. The owner then supplied approval through a separate, explicit `EXECUTION_MODE=OWNER_OVERRIDE` directive naming the exact exception (`PLAN_LOCK=EXEMPT`), the exact authorized operations, and an explicit `FORBIDDEN_OPERATIONS` list.
- **A rejected write is not retried**: later in the same mission, a specific file write (`app/api/admin/domains/nameservers/route.ts`) was rejected by the owner. This session stopped immediately rather than reattempting the same action, and the owner redirected to a different, read-only task instead.

Both precedents demonstrate the same underlying rule this document formalizes: approval must be explicit and direct, and its absence (including a rejected tool call) is itself a signal to stop, not a gap to be filled by inference.

## Proposed rules

**RULE — Approval must name the thing it approves.** A general "sounds good, keep going" does not approve a specific Level 4 action. The `EXECUTION_MODE=OWNER_OVERRIDE` precedent is the model: it named the mission, the exact exempted rule (`PLAN_LOCK`), the authorized operation list, and the forbidden operation list explicitly — not implied by context.

**RULE — A rejected action is a stop signal, not a retry prompt.** If the owner declines a proposed tool call or write, the correct response is to halt and wait, per this session's own two demonstrated instances above — never to rephrase and resubmit the same action hoping for a different outcome.

**RULE — Silence is not approval.** The absence of an objection to a plan described in passing does not constitute Level 4 sign-off. This matters specifically because this project runs multiple concurrent AI sessions (`registry/AI_SESSIONS.json`) — one session's unchallenged assumption is not evidence the owner reviewed and approved it.

**RULE — Approval is recorded, not just remembered.** Per [`release-policy.md`](./release-policy.md) and [`production-freeze-policy.md`](./production-freeze-policy.md), a Level 4 approval that authorized a real action should leave a trace in `registry/CHANGELOG.json` or `CURRENT_STATE.json` — conversational-only approval disappears the moment a session's context is compacted or a new session starts cold.

**RULE — Real-money and irreversible actions get the same explicit-confirmation treatment regardless of ladder level.** Rule 72 (preview → token → execute) already implements this for financial/document writes; `domain-migration-policy.md` and `domain-governance.md` extend the same pattern to domain registration/DNS changes. This document doesn't introduce a new mechanism — it names Rule 72's pattern as the concrete implementation of "Level 4 approval" for this specific class of action.

## Validation Checklist

- [ ] Every Level 4 action taken has a corresponding explicit approval that names it directly (mission, scope, exact operations) — not inferred from a broader conversation
- [ ] Every rejected tool call/write in a session's history has no immediate retry of the same action
- [ ] Every Level 4 approval that resulted in a real action has a corresponding entry in `registry/CHANGELOG.json` or `CURRENT_STATE.json`

## Failure Conditions

- An AI session proceeds with a Level 4 action based on an ambiguous or general instruction, later found not to have actually authorized that specific action
- A rejected tool call is retried in slightly different form instead of triggering a stop-and-wait
- A real Level 4 approval was given conversationally but left no registry trace, so a later session cannot verify it happened

## Recovery Procedure

1. If a Level 4 action was taken without properly-scoped approval: halt further action in that scope immediately, and surface the gap to the owner directly rather than retroactively justifying it.
2. Backfill a `registry/CHANGELOG.json` entry describing what approval actually was given and when, so the gap doesn't recur for the next session reading the registry.
3. If a rejected action was mistakenly retried: stop, and treat the repeated rejection (if it recurs) as a stronger signal to ask what specifically is wrong, rather than continuing to vary the approach.
