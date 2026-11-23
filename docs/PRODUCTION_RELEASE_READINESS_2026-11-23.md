# Production release additions — 2026-11-23

This checklist records the Market Brief requirements and the verified Production changes as of 2026-11-23. It is not proof that the application code or Auth templates have been released.

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

The new provenance schema defines capability-sized DNA bundles in Supabase. Each bundle links its category, exact repository paths and file hashes, source commit, event timestamps, intended system/environment, and (for Production) company and organization IDs plus policy version/hash. Production approval is captured separately by an authenticated owner of that organization after reviewing the exact bundle; the database records the approver profile and timestamp. `occurred_at` and `recorded_at` retain the actual event time and the Supabase write time separately. GitHub Actions results are optional evidence; a recorded manual check/build can carry the release evidence when Actions is unavailable. Readiness requires merge, checks, build, deployment, route verification, and migration verification where migrations are recorded to be linked to the same DNA bundle. The schema is only a migration until applied and verified on the approved project. See `supabase/migrations/20261123000002_development_change_sets.sql` and `docs/DEVELOPMENT_PROVENANCE_LEDGER.md`.

## Production database change recorded on 2026-11-23

- Supabase project `xeytcavxejhyzxwevgto` already contained the provenance tables and first migration's RPCs, but migration `20261123000001` was absent from its migration history. The second migration's change-set tables and RPCs were absent.
- Applied only `20261123000002_development_change_sets.sql` through the linked Supabase Management API query. Its SHA-256 is `90c00c5459d461b73ac95185c4b8992bf722b78af8909d53a147910fd6ce3ebd`.
- Repaired the Supabase migration-history entries for `20261123000001` and `20261123000002` to `applied`; a subsequent migration-list query showed both versions present on local and remote history.
- Verified the four change-set relations and RPC permissions. `anon` can execute only `read_public_development_change_sets`; it cannot read private change-set tables or call the private projection. An authenticated user can invoke the approval RPC only when the database confirms that user's `owner` membership and the exact company/organization binding.
- Read-only Production history showed 86 existing companies without `organization_id`. Production change-set approval cannot be used for those companies until their legitimate organization ownership is linked. No company ownership was guessed or changed.
- Two Production migration events and one append-only timestamp-correction event were written under the DNA lineage. The initial two event `occurred_at` values were entered as 00:20Z and 00:21Z even though the database recorded the writes at 04:25Z. They were not edited or deleted; the later event key `dnaos-prod-migration-20261123000002-timestamp-correction-for-ce18ffcc-and-941ef0` records this correction at the database's actual time. Use `recorded_at` as the reliable write time for the initial records.
- The complete Production migration graph remains divergent: the remote project contains many older migration versions whose SQL files are absent from this checkout. No bulk `db push` was run.
- The schema migration was applied directly as an infrastructure change at the user's request; there is no per-company owner approval row or Production change-set bundle for it. This was recorded as migration evidence, not represented as an owner-approved business release.
- No Auth email template was changed, and this branch's application code has not been merged or deployed. The PR remains draft because its GitHub workflows failed before creating any job steps; local type-check, diff check, pre-commit guards, and isolated ledger checks had passed earlier.

The database ledger itself is now installed and its public/private access boundaries were verified. The broader application release remains separate and must not be described as complete until its source commit and target are aligned and verified.

## Production rollback evidence

Before a Worker release, preserve source commit, lockfile hash, Worker version/deployment ID, config hash, compatibility date, binding names (never secret values), migration set, environment/approver, and post-deploy verification. Keep this evidence outside Cloudflare's short deployment history. Use Worker Previews for branch and PR review.

## Email template source and status

The tracked template package is `supabase/templates/dna-os-draft/`. The local Supabase Auth `magic_link` template points at `magic-link-or-otp.html`, which contains the one-time-code card and no sign-in link. Thirteen subjects/bodies and the local editor are preserved with the package.

The source package's verification record applies only to Supabase project `cxxatziqyddkxbmepjzm` on 2026-11-18/19. It does not establish that the same templates are installed on Production project `xeytcavxejhyzxwevgto`, nor that all notification types were delivered. Before Production, compare the intended bodies in the authenticated Production dashboard, confirm the sender/domain and code length against the login form, then send and verify a controlled OTP email. Do not copy action-link templates into Production without separately checking callback domains and link behavior.

Read-only Production dashboard observation on 2026-11-23: Authentication → Emails → Magic link or OTP shows the subject `รหัสยืนยันการเข้าสู่ระบบ DNA OS`, which differs from the saved card subject. The accessible editor exposed only its final safety paragraph in this inspection, so the complete Production HTML body remains unverified.

## Current release blockers

- Existing GitHub Actions workflows supply the broad `SUPABASE_SERVICE_ROLE_KEY` to provenance and deploy-gate jobs, while the target URL comes from a secret. The repository does not hard-limit that URL to a non-Production project, so it cannot prove CI is unable to write Production. The new manual history path does not depend on Actions, but this existing CI credential path remains a release blocker until removed or replaced with a narrowly authorized non-Production evidence writer.
- The available database audit dated 2026-11-20/22 is a read-only Local catalog, not a Production catalog. It also records migration-source divergence and missing source checksums. It cannot prove Production schema or migration alignment.
- The originating development checkout has multiple unrelated uncommitted changes. This release-preparation change is isolated from them; any release must still be built from a clean, reviewed commit whose GitHub SHA is the exact deployed SHA.
- Cloudflare and Supabase target identities in source configuration are source evidence only until confirmed against the authenticated live dashboards. Unknown or mismatched target IDs block release.

## Required evidence before release approval

1. Read-only live Production catalog and migration-history comparison against the approved baseline.
2. A reviewed authority manifest for each database/deployment operation with exact target, approver, and least-privilege credential class.
3. No Production write credential in CI, Workers, or AI-agent runtime.
4. Verified email-template source, Production dashboard body, sender/domain, OTP length, code-only behavior, and successful login through the real Production entry route.
5. Clean published commit, passing recorded checks (manual evidence is acceptable when Actions is unavailable), rollback manifest, and post-deploy route/database verification tied to that exact commit and deployment ID.
