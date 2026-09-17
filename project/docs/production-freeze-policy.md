# Production Freeze Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. No registry file or code was changed to produce this document.

## Objective

Generalize the freeze mechanism this repo already uses in practice — `registry/CURRENT_STATE.json`'s `architecture_freeze` key — into a reusable pattern for any future freeze, instead of a one-off structure invented fresh each time.

## Current state (verified, not assumed)

This repo has two live, real freeze/gate mechanisms today, already distinct from each other:

- **`plan_lock`** (declared 2026-07-08, still active) — a standing, broad gate: no new Module/Page/Feature until TASK-001 (SSO)/TASK-002 (real data)/TASK-003 (clean+deploy) are all `DONE`. Its own `note_2026_07_13` field records that a specific migration proceeded anyway "under a direct, explicit owner instruction in real-time conversation" — explicitly logged as an exception, not a suspension of the rule itself ("Not a general suspension of Plan Lock; TASK-001/002/003 are still not DONE as of this entry").
- **`architecture_freeze`** (declared 2026-07-13) — a narrower, scoped freeze: only the Relationship-Centric Workspace/Timeline architecture (an explicit file/directory `scope` list), with a `rule` naming exactly which actions are blocked (no Timeline refactor, no DocumentBuilder/TransactionPanel rewrite, no route deletion, no schema migration) "until the owner gives explicit Phase 3 authorization naming Phase 3 directly."

Both already share the same shape: `declared_by`, `declared_at`, `scope`, `rule`, `why`. This document names that shape so the next freeze doesn't have to be redesigned from scratch.

## Proposed rules

**RULE — Every freeze is a registry entry, not a conversational agreement.** A freeze exists in `CURRENT_STATE.json` (or wherever `production-governance.md`'s adopted structure lands it) with the 5 fields above — matching the pattern both `plan_lock` and `architecture_freeze` already use. A freeze that only exists in chat history is not verifiable by the next AI session and does not count.

**RULE — Scope is explicit and bounded.** `architecture_freeze.scope` lists exact files/directories, not a vague area — this is what let this session correctly reason that writing `docs/*.md` policy proposals and building `engines/domains/*` did not touch frozen scope, while a Timeline refactor would have.

**RULE — Exceptions are logged as exceptions, never as silent overrides.** `plan_lock.note_2026_07_13` is the worked example: an exception was granted and used, and the record explicitly states the underlying rule was not suspended. The Domain Infrastructure mission's `EXECUTION_MODE=OWNER_OVERRIDE` (2026-07-13, this session) follows the same shape — a named, scoped, explicit exception to `plan_lock`, with its own `FORBIDDEN_OPERATIONS` list preventing it from silently expanding into frozen `architecture_freeze` territory.

**RULE — Lifting a freeze requires naming it directly.** Both existing freezes require an authorization that names the freeze/phase directly ("explicit Phase 3 authorization naming Phase 3 directly") — an ambiguous or general-sounding go-ahead does not lift a specific freeze. This is the same principle [`owner-approval-policy.md`](./owner-approval-policy.md) states generally; this document is the specific application to freezes.

## Validation Checklist

- [ ] Every active freeze has all 5 fields (`declared_by`, `declared_at`, `scope`, `rule`, `why`) populated in a registry file, not just described in a document
- [ ] Every exception ever granted against a still-active freeze has its own logged entry stating the freeze was not lifted, only exercised for a named, scoped instance
- [ ] No freeze is lifted by an authorization that doesn't name the freeze/phase directly

## Failure Conditions

- An AI session infers a freeze has been lifted from a generally-worded instruction ("let's move forward," "keep going") without the freeze being named directly — this is the exact failure this project's own protocol already treats as forbidden (see this session's repeated refusal to begin Phase 3 without an authorization naming it)
- A freeze's `scope` is left vague, causing legitimate out-of-scope work (like this session's docs/domain work) to be incorrectly blocked, or in-scope work to be incorrectly allowed
- An exception granted for one narrow case is treated by a later session as a general precedent for unrelated work

## Recovery Procedure

1. If a freeze was incorrectly treated as lifted: halt the work that shouldn't have proceeded, record what happened in `registry/CHANGELOG.json`, and re-confirm the freeze's actual current state directly with the owner before resuming anything in scope.
2. If a freeze's scope was too vague to apply correctly: tighten it (explicit file/directory list, per the `architecture_freeze` precedent) rather than leaving it ambiguous for the next session.
3. Any exception, once exercised, gets its own logged note (per `plan_lock.note_2026_07_13`'s pattern) confirming the underlying freeze remains in force beyond that one instance.
