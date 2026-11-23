# Production release additions — 2026-11-23

This checklist records the Market Brief requirements that must be resolved before a Production release. It is evidence and release preparation, not proof that Production has been changed or verified.

## Release authority and database boundary

- Every database release record must name `environment_id`, exact Supabase `target_project_ref`, `operation`, `approver`, and `credential_class`.
- The target must match a reviewed allowlist. Missing identity, unknown target, or a credential class broader than the operation is a hard stop.
- Production Branch read-write credentials must remain owner-controlled and separate from Worker, CI, and AI credentials. No agent or CI job may merge a database branch into Production.
- Preview and staging work must use isolated targets and credentials. Cloudflare Version URLs are not a staging substitute because they can use Production bindings.
- A migration is not considered applied because a source file exists. Compare the live catalog and migration history for the exact target before and after any approved operation.

## Deterministic execution and evidence

For each authorized command, preserve a minimal, secret-free envelope with actor reference, organization/resource scope, command/capability, policy version, input hash, result, cost reference when applicable, and handoff/retry state. AI remains an optional worker; state changes pass through fixed commands/RPCs and explicit authorization.

Document-derived facts must retain provider/document reference, source file and page/version, content hash, extracted fact and confidence, verifier reference, and the state transition that used the fact. Keep private document contents outside the public development/release ledger.

Operational records should link order → resource/movement → milestone → document → handover → cost → exception. Each external provider remains authoritative for its own source records; DNA OS stores references and verified transitions rather than claiming ownership of provider data.

## Production rollback evidence

Before a Worker release, preserve source commit, lockfile hash, Worker version/deployment ID, config hash, compatibility date, binding names (never secret values), migration set, environment/approver, and post-deploy verification. Keep this evidence outside Cloudflare's short deployment history. Use Worker Previews for branch and PR review.

## Email template source and status

The tracked template package is `supabase/templates/dna-os-draft/`. The local Supabase Auth `magic_link` template points at `magic-link-or-otp.html`, which contains the one-time-code card and no sign-in link. Thirteen subjects/bodies and the local editor are preserved with the package.

The source package's verification record applies only to Supabase project `cxxatziqyddkxbmepjzm` on 2026-11-18/19. It does not establish that the same templates are installed on Production project `xeytcavxejhyzxwevgto`, nor that all notification types were delivered. Before Production, compare the intended bodies in the authenticated Production dashboard, confirm the sender/domain and code length against the login form, then send and verify a controlled OTP email. Do not copy action-link templates into Production without separately checking callback domains and link behavior.

Read-only Production dashboard observation on 2026-11-23: Authentication → Emails → Magic link or OTP shows the subject `รหัสยืนยันการเข้าสู่ระบบ DNA OS`, which differs from the saved card subject. The accessible editor exposed only its final safety paragraph in this inspection, so the complete Production HTML body remains unverified.

## Current release blockers

- GitHub Actions supplies the broad `SUPABASE_SERVICE_ROLE_KEY` to provenance and deploy-gate jobs, while the target URL comes from a secret. The repository does not hard-limit that URL to a non-Production project, so it cannot prove CI is unable to write Production. Replace the path with a narrowly authorized evidence writer or remove database writes from CI before release; do not reuse the broad service-role key.
- The available database audit dated 2026-11-20/22 is a read-only Local catalog, not a Production catalog. It also records migration-source divergence and missing source checksums. It cannot prove Production schema or migration alignment.
- The originating development checkout has multiple unrelated uncommitted changes. This release-preparation change is isolated from them; any release must still be built from a clean, reviewed commit whose GitHub SHA is the exact deployed SHA.
- Cloudflare and Supabase target identities in source configuration are source evidence only until confirmed against the authenticated live dashboards. Unknown or mismatched target IDs block release.

## Required evidence before release approval

1. Read-only live Production catalog and migration-history comparison against the approved baseline.
2. A reviewed authority manifest for each database/deployment operation with exact target, approver, and least-privilege credential class.
3. No Production write credential in CI, Workers, or AI-agent runtime.
4. Verified email-template source, Production dashboard body, sender/domain, OTP length, code-only behavior, and successful login through the real Production entry route.
5. Clean published commit, passing required checks, rollback manifest, and post-deploy route/database verification tied to that exact commit and deployment ID.
