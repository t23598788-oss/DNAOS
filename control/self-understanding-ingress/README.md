# control/self-understanding-ingress/

**หน้าที่:** STAGE 1 — INGRESS of the DNA OS Self-Understanding Pipeline
(Owner-approved architecture, 2026-08-22):

```
INGRESS (this folder) -> INVENTORY (control/repository-discovery/, STAGE 2)
  -> IDENTITY -> UNDERSTANDING -> CLASSIFICATION -> RELATIONSHIP
  -> EVIDENCE JOINT -> CHECK -> VERIFICATION -> CAPABILITY RESOLUTION
  -> DUPLICATE/CANONICAL GATE -> REGISTRATION -> ACTION PLAN
  -> EXECUTION + POST-VERIFY
```

Only STAGE 1 is built this round — Stages 2–14 are explicitly
out of scope until separately authorized.

**Discovery result (reuse-first, no duplicate built):** no existing
capability accepted this exact bounded shape. `control/command-router/`
is a real, general, non-human-restricted command router, but its
`CommandEnvelope.payload` is untyped and it has no route registered for
a self-understanding request. `control/repository-discovery/` is real,
tested STAGE 2 work (`runDiscovery(repoRoot)`), but takes a bare string
and has zero real callers today — the natural downstream consumer of
this stage, not the ingress itself. Neither could absorb this
responsibility without a real boundary violation (command-router is
domain-agnostic; repository-discovery's own README forbids it from
"deciding" anything beyond a file scan). This folder exists because the
Owner's NEW_CAPABILITY_REQUIRED proof genuinely holds here.

**What this stage does:** `acceptIngressRequest()` validates a caller
request is well-formed — `request_id`, `target`, `scope`,
`requested_capability` all present — and that `target` is genuinely
bounded within `scope` (never a caller-chosen destination the Agent
picked by roaming the filesystem itself). Reuses
`connections/github/repo-path.ts`'s real `checkRepoPath()` — the same
repo-relative, no-traversal boundary `control/target-resolution/` already
trusts for the identical purpose — for both `target` and `scope`. No new
path-validation algorithm invented here.

**What this stage deliberately does NOT do:** it never touches the
filesystem, never scans anything, never classifies, never registers a
capability of its own initiative. `requested_capability` is carried
through untouched — this stage does not interpret or validate it against
a closed vocabulary; that decision belongs to a later stage not yet
built.

**Structural consumer (proven, not merely asserted):**
`./tests/ingress.test.ts` proves a real `ACCEPTED` result's
`validated_request.target` is genuinely usable as `runDiscovery()`'s
`repoRoot` input — `control/repository-discovery/` is the real,
structurally mandatory downstream consumer of this stage's output, even
though no automatic wiring between the two stages exists yet (that
wiring is STAGE 2+ territory, out of scope this round).

**Input:** `unknown` (a caller-supplied candidate, never trusted as
already-typed).
**Output:** `IngressResult` — `ACCEPTED` (carries the real, validated
`SelfUnderstandingIngressRequest`) or `REJECTED` (carries a real
`reason_code`, never a guess).
**Dependency ที่อนุญาต:** `../../connections/github/repo-path.ts`
(`checkRepoPath` only — the same direct-import precedent
`control/target-resolution/resolver.ts` already established), `./types.ts`.
**สิ่งที่ห้ามแตะ:** never accept a `target` that is not provably within
`scope`. Never touch the filesystem here. Never let a missing/malformed
field fall through to `ACCEPTED`. Never implement Stage 2–14 here.
