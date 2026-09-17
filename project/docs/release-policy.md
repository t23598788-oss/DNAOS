# Release Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. No deploy, tag, or config was created to produce this document.

## Objective

Define what counts as a "release" in this repo, since there is no git-tag/semver scheme today — grounded in what actually exists (`registry/CHANGELOG.json`'s `change_id` sequence and manual `vercel --prod` invocations), not an imported convention that doesn't fit.

## Current state (verified, not assumed)

- There is no `package.json` version bump workflow, no git tags observed, and deployment is a manual `vercel --prod` CLI invocation — not triggered by a git push (this repo has hundreds of uncommitted files across sessions per `CURRENT_STATE.json`'s `working_tree_note`, so "commit" and "deploy" are already decoupled today).
- The closest thing to a release identity that already exists is `registry/CHANGELOG.json`'s sequential `change_id` (`DNA-000019`, `DNA-000020`, `DNA-000021`, ...) — one entry per significant unit of work, not per deploy. A single `change_id` can span a large multi-part session (e.g. `DNA-000021` covers the entire Relationship-Centric Workspace migration).
- [`versioning-policy.md`](./versioning-policy.md) already governs a different, narrower thing: the `/api/v1/*` vs. unversioned `/api/admin/*` API surface split. This document is about the *application* release as a whole, not API contract versions.

## Proposed rules

**RULE — A release is a deploy, not a change_id.** A `registry/CHANGELOG.json` entry documents what changed; a release is the specific `vercel --prod` invocation that ships it to the production URL. One `change_id` may span zero, one, or several actual releases (work can be recorded before it's deployed).

**RULE — Every release references the change_id(s) it ships.** Proposed: a lightweight `RELEASES.md` or a `releases` array appended to `CURRENT_STATE.json`, recording the deploy timestamp, the Vercel deployment URL produced, and which `change_id`(s) are newly live as of that deploy — closing the current gap where "what's actually in production right now" isn't recorded anywhere, only inferred.

**RULE — A release requires [`deployment-gate-policy.md`](./deployment-gate-policy.md)'s gates to pass first.** No release ships past a failing Level 5 gate; a release that ships past a Level 4 gate carries an explicit owner sign-off recorded in the same entry.

**RULE — A release is reversible.** Every release has a corresponding rollback path per [`rollback-policy.md`](./rollback-policy.md) before it's considered complete, not discovered after something breaks.

## Requirements

- Record, at minimum, per release: timestamp, Vercel deployment URL, `change_id`(s) shipped, who initiated it (which AI session or the owner directly).
- A release initiated by an AI session follows the same authorization rules as any other write action of its risk level — routine bug fixes are Level 2 (auto-approved), but a release that includes a Level 4 change (e.g. this session's domain-binding work, once it ships) requires the owner sign-off to already be on record before the deploy, per [`owner-approval-policy.md`](./owner-approval-policy.md).
- No release ships with a failing TYPECHECK or BUILD gate (per `deployment-gate-policy.md`) — this is already true in practice today (a broken build cannot be deployed), this rule just makes it explicit policy rather than an incidental consequence of tooling.

## Validation Checklist

- [ ] Every production `vercel --prod` invocation has a corresponding release record (timestamp, URL, change_id(s))
- [ ] No release record exists without the gates in `deployment-gate-policy.md` having passed at that point in time
- [ ] Any release shipping a Level 4 change has an explicit, recorded owner approval predating the deploy, not a retroactive justification

## Failure Conditions

- Production is deployed to and nobody can later answer "what changed in this release" because no release record was made
- A release ships a Level 4 change without prior recorded owner approval
- Two different sessions both run `vercel --prod` in close succession without either being aware of the other, producing an unclear "current production state" — a real, already-observed risk pattern in this project given multiple concurrent AI sessions (see `registry/AI_SESSIONS.json`)

## Recovery Procedure

1. If production state is unclear: `vercel ls` / the Vercel dashboard is the ground truth for what's actually live, never a session's assumption from its own conversation history.
2. Reconstruct the missing release record retroactively from the actual deployed commit/build and `registry/CHANGELOG.json`'s entries around that timestamp, then adopt the recording habit going forward rather than treating the gap as unrecoverable.
3. If a Level 4 change shipped without prior approval, flag it to the owner explicitly and immediately rather than waiting to be asked — consistent with this project's existing "ห้ามเดา" discipline.
