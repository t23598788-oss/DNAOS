# Change Plan — `GITHUB_API_VERSION`: `2022-11-28` → `2026-03-10`

**status: PLAN ONLY — the constant has NOT been changed. Do not edit `adapter-config.ts`'s `GITHUB_API_VERSION` value until this plan is Owner-approved.**

## Why this plan exists

Round 2026-08-14 research (`connections/github/` capability audit, dispatched to verify the Owner's claim against official GitHub documentation) confirmed both parts of the claim:

1. GitHub's current REST API version is `2026-03-10` ([source](https://docs.github.com/en/rest/about-the-rest-api/api-versions)) — `2022-11-28` is the other of exactly two supported versions.
2. Omitting `X-GitHub-Api-Version` silently defaults to `2022-11-28`, verbatim from the docs: *"Requests without the `X-GitHub-Api-Version` header will default to use the `2022-11-28` version."*

`adapter-config.ts:41` currently pins `GITHUB_API_VERSION = "2022-11-28"`. This is **not broken** — it is still a supported version, and being pinned at all (rather than omitted) already puts this capability ahead of the silent-default risk. This plan is about moving to the *current* version deliberately, not fixing a defect.

## The diff (proposed, not applied)

```diff
- export const GITHUB_API_VERSION = "2022-11-28";
+ export const GITHUB_API_VERSION = "2026-03-10";
```

One line, one file (`adapter-config.ts`). No other file references the version string directly — every call site reads the constant via `github-read-api.ts`'s `githubHeaders()`.

## Real behavior change this version bump causes (not just a version bump)

From [Breaking changes](https://docs.github.com/en/rest/about-the-rest-api/breaking-changes), cross-referenced against every endpoint this capability actually calls:

| Endpoint in use | Change under `2026-03-10` | Impact |
|---|---|---|
| `GET /repos/{owner}/{repo}` (`getRepository`) | `has_downloads`, `use_squash_pr_title_as_default` removed from response | **None** — this capability reads only `default_branch` and `visibility` |
| `GET /repos/{owner}/{repo}/branches/{branch}` (`getBranch`) | not listed as affected | **None** |
| `GET /repos/{owner}/{repo}/contents/{path}` (`getPathStatus`) | **submodule entries return `type: "submodule"` instead of `type: "file"`** | **Real, in-scope behavior change** |

### The submodule change, specifically

Today (`2022-11-28`), a path that is actually a git submodule is misreported by GitHub's own API as an ordinary file. `status-operations.ts`'s `getPathStatus` passes `entry_type` straight through without reinterpreting it (`adapter-contract.ts`'s `GithubPathStatus` type already has a comment anticipating `"submodule"` as a real value, written before this plan existed). Concretely:

- **Today**: a submodule path → `{ kind: "file", blob_sha, size_bytes }` — silently wrong.
- **After the bump**: the same path → GitHub reports it distinctly; this capability's existing `kind: "failed"` fallback (for any `type` other than `"file"`) fires — an honest, explicit failure instead of a quiet misclassification.

This is a strict correctness improvement with no code change required in `status-operations.ts` itself — the type was already anticipated. Directory listings (`entry_type` passed through raw in `GithubDirectoryEntry`) become more accurate, not less, since submodule entries would be labeled correctly there too.

## Tests

### 1. Header verification — DONE, passing, in `adapter.test.ts` today

Added this round: `"the configured GITHUB_API_VERSION is the version GitHub actually confirms it used"` (live suite). It calls GitHub directly with the *current* configured header and asserts GitHub's own `x-github-api-version-selected` response header matches — closing the gap the research round flagged ("nothing currently proves the header goes out"). Runs against `t23598788-oss/camo` specifically because a fine-grained PAT always has read access to public repositories regardless of Repository access selection, so this test provides real evidence even while `-DNA-OS-INFRASTRUCTURE-` itself remains blocked on repository selection (see Task 1 status, separate report).

**Real result, this session:** `EVIDENCE: GitHub confirms x-github-api-version-selected=2022-11-28 (matches configured GITHUB_API_VERSION="2022-11-28")` — PASS. Once the constant above is changed, this exact test re-run should show `x-github-api-version-selected=2026-03-10` — that observation is what "approved and verified" looks like for this change, not just the constant compiling.

### 2. Submodule-behavior verification — BLOCKED, cannot be built this round

Checked the one fully-accessible repository (`t23598788-oss/camo`, public, read reachable regardless of PAT repository selection) for a real submodule to test against: **no `.gitmodules` file, no submodule entries found** at its root. This capability's own rule (`README.md`, `POLICY.md`) forbids fabricating test data to fill a gap — so no synthetic submodule fixture was created.

**What this needs before it can be built:** a real, accessible repository containing an actual git submodule. Two honest paths forward, for the Owner to choose, neither taken yet:
- (a) once `-DNA-OS-INFRASTRUCTURE-` repository access is fixed, check whether it (or any other repository the fixed PAT can reach) contains a real submodule;
- (b) if none exists, this specific behavior remains **NOT_YET_BUILT / NOT VERIFIED** and should be stated as such rather than asserted from documentation alone — the documented claim is trusted for the change-plan's reasoning above, but this capability's own discipline (empirical, not just cited) doesn't yet have a live example to point at.

## What is NOT part of this plan

- Not changing `GITHUB_API_VERSION`'s value (pending this plan's approval).
- Not adding write/push/delete capability (unrelated to this change).
- Not touching any other capability folder.
- Not fabricating a submodule test fixture.

## Approval checklist (for the Owner)

- [ ] Constant change (`"2022-11-28"` → `"2026-03-10"`) approved
- [ ] Re-run `adapter.test.ts` after the change, confirm `x-github-api-version-selected=2026-03-10` in the header-verification test's output
- [ ] Decide the submodule-test path (a) or (b) above once a candidate repository is known
