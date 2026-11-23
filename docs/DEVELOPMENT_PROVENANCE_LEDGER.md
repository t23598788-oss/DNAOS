# DNA OS development history

This is the durable record of how a code change moved from its source to a verified destination. GitHub Actions is optional evidence; it is not the only writer or the release-history store.

## One DNA bundle per coherent change

`system.development_lineages` holds the permanent platform DNA ID. Each coherent change gets one immutable `system.development_change_sets` row with its own bundle ID and stable `change_set_key`. Use one bundle for one capability-sized unit of work, not one bundle for the whole repository. A commit can be represented in several bundles when it spans distinct categories; each bundle still points back to the same root DNA and exact source commit. A bundle records:

- category: `database_schema`, `business_formula`, `business_policy`, `application_api`, `integration`, `infrastructure`, `authentication_email`, or `documentation`;
- short title and technical summary;
- repository and the exact changed paths;
- full commit SHA and SHA-256 of each resulting file (deleted files retain a null content hash);
- a hash of the ordered file manifest;
- where it is intended to run: target kind, environment, and target reference;
- the exact operation and environment ID;
- for Production, foreign keys to the target `public.companies.id` and `public.organizations.id`, that company's policy reference/version/hash, and the scoped credential class. Owner approval is stored separately in an immutable approval table, not asserted by the registering script.

Keep policy text, secrets, customer/account records, transaction amounts, and commercial payloads out of this ledger. Store references and hashes only.

AI/read-only clients can inspect categories, technical titles, repository paths, commit hashes, file hashes, and timestamps through `read_public_development_change_sets`. That projection omits the target company, Production policy reference, approver, and credential class. Those release-authority fields remain available only through the service-role-only internal read RPC; the AI-facing read path cannot write to either table.

## Event timeline

The existing append-only `system.development_events` records actual events. Its `occurred_at` is when GitHub, a person, Supabase CLI, or the deploy process says the event happened; `recorded_at` is when Supabase persisted it. Both are `timestamptz`, so they preserve date, minute, second, and offset even when separate systems finish seconds apart. A unique event key makes retries idempotent, and the sequence/previous-event link catches breaks in the timeline.

Link events to bundles with `system.development_event_change_sets` (many-to-many). Examples include work started, commit created, GitHub branch published, merge into `main`, manual checks, migration applied and verified, build verified, deployment completed, and live route verified. A linked event that carries a commit SHA must match a commit in that bundle's file manifest.

## No GitHub Actions dependency

Record a manual check/build result through the same Supabase RPC path when Actions is unavailable. Record a failed or blocked result honestly; do not invent a pass. GitHub CI events are useful when present but are optional. Release readiness requires a `main` merge, manual checks, build evidence, migration verification when applicable, and Production deployment plus live-route verification. It also requires a file bundle naming the Production target, company, and hashed policy reference.

## Recording a bundle

Run `npm run history:record-bundle` from a clean checkout with the approved Supabase URL and service-role credential supplied through the local secret manager. Set the `DNAOS_*` values documented in `scripts/register-development-change-set.ts`; the script derives the changed paths and file hashes from `DNAOS_BASE_SHA..DNAOS_COMMIT_SHA`, and refuses a commit that is not the checked-out `HEAD`. Staging and Production require an exact `environment_id`. Production bundles fail closed unless the target project/Worker, existing company and organization IDs, operation, policy reference/version/hash, and `production_release_scoped` credential class are present. Before an owner can inspect or approve, the database verifies that `companies.organization_id` ties that exact company to the stated organization. The authorized owner must inspect the recorded target and file manifest through `read_development_change_set_for_approval`, then approve using `approve_development_change_set` from an authenticated organization-owner session with the expected company ID and policy hash. The database captures the authenticated profile and timestamp and rejects a conflicting approval. Release readiness requires this approval and a later migration or deployment event. Existing companies without an organization binding cannot be approved until that ownership relationship is resolved.

Use `npm run history:record-event` for each timestamped event. Set `DNAOS_CHANGE_SET_KEY` to attach that event to the same bundle. Use `npm run history:read` to review the read-only technical history. Never put the service-role credential in GitHub Actions or commit it to the repository.

## Current boundary

The migration is source code until it is applied and its exact version/hash are verified in the intended Supabase project. A record in a local checkout or a GitHub commit is not proof that the database or Production changed. The ledger migration itself must be applied once to the approved Supabase target before these recording commands can persist there.
