<img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.png" alt="DNA OS" width="148" />

# DNA OS public system and integration map

Generated at: 2026-11-23T07:53:56.027Z
Source revision: 77d539c20f52860fe650d5cd47301b36cdf039e4

## Production services
- **dnaos-homepage** — Cloudflare Worker; https://dnaos.dev/, https://dnaos.dev/assets/*, https://dnaos.dev/system-map, https://dnaos.dev/system-map.json, https://dnaos.dev/system-map.md, https://dnaos.dev/system-map-ai.zip. Source: [workers/landing-entry/index.ts](https://github.com/t23598788-oss/DNAOS/blob/77d539c20f52860fe650d5cd47301b36cdf039e4/workers/landing-entry/index.ts).
- **dnaos-auth-entry** — Cloudflare Worker; https://dnaos.dev/login, https://dnaos.dev/start, https://dnaos.dev/v1/auth/*. Source: [workers/auth-entry/index.ts](https://github.com/t23598788-oss/DNAOS/blob/77d539c20f52860fe650d5cd47301b36cdf039e4/workers/auth-entry/index.ts).
- **dnaos-business-onboarding** — shared source imported by auth Worker; not_a_separately_deployed_worker_per_2026_11_23_inspection. Source: [workers/business-onboarding/index.ts](https://github.com/t23598788-oss/DNAOS/blob/77d539c20f52860fe650d5cd47301b36cdf039e4/workers/business-onboarding/index.ts).

## Login and identity
- Sign-in page: [https://dnaos.dev/login](https://dnaos.dev/login), served by `dnaos-auth-entry`.
- Current production endpoint status: [method-by-method table](/api-reference.md) · [machine-readable status](/api-status.json). The map's source revision and generated timestamp below are older than the 2026-11-24 live probe; check the status file before using a route.
- Route, session, and release reference: [DNA OS sign-in route map](https://github.com/t23598788-oss/DNAOS/blob/main/docs/DNA_OS_AUTH_ROUTE_MAP_2026-11-23.md).
- Screen source: [workers/business-onboarding/entry-page.ts](https://github.com/t23598788-oss/DNAOS/blob/main/workers/business-onboarding/entry-page.ts); route/gateway entry: [workers/auth-entry/index.ts](https://github.com/t23598788-oss/DNAOS/blob/main/workers/auth-entry/index.ts).
- Production release and live route verification are linked under the `dnaos-platform` identity lineage in Supabase `system.development_events` (sequences 14–15; Worker version `c23863da-109f-4d28-8f01-f525c64f3b49`).

## Connection pipeline
1. provider webhook or poll
2. signature/authentication boundary
3. provider adapter normalization
4. canonical Gateway event bus
5. scoped authorized consumer

Gateway adapters in source: github (webhook: repository, branch, commit, pull_request, workflow_run); supabase (poll: health, migration_state); vercel (webhook: deployment); railway (webhook: deployment); line (webhook: message, document, location, identity_signal, interaction); facebook (webhook: message, document, interaction); instagram (webhook: message, document, interaction).
These are source-level adapter/contract declarations, not public DNA OS API endpoints and not proof that an external provider account or webhook is connected. See the [endpoint status reference](/api-reference.md) for verified routes.

## API access and endpoint status
- Public API and connection guide: [api-reference.md](/api-reference.md).
- Meta integration guide: [Facebook Page / Messenger webhook](/docs/integrations/facebook-messenger.md) · [Meta MCP and Page installation map](/docs/integrations/meta-mcp-and-facebook-page-installation.md).
- Meta webhook status checked 2026-11-26: `GET` and `POST /api/gateway/observe/meta` returned 404. Worker source exists on the release branch; Production is not serving it yet. This phase is receive-only and does not connect customer Pages or send replies.
- Machine-readable endpoint status: [api-status.json](/api-status.json).
- AI-readable index: [llms.txt](/llms.txt).
- Search crawler sitemap candidate: [sitemap.xml](/sitemap.xml); Production currently returns 404 until the homepage Worker candidate is deployed.
- The 2026-11-24 probe found `/login`, `/start`, `/v1/auth/csrf`, `/v1/auth/session`, and the four system-map resources responding. `/auth/google`, `/auth/confirm`, and `/workspace` returned 404 in Production; they remain In Development until the auth Worker candidate is deployed.
- `/llms.txt` and `/openapi.json` returned 404 at the time of the probe. This candidate adds a static `llms.txt` and public endpoint status files, but they become available only after the homepage asset Worker is deployed. No public OpenAPI contract, developer API key issuance, rate-limit policy, sandbox/playground, or LINE/n8n webhook quickstart is currently published.

## Database and compute
Supabase migration objects in the provenance ledger: table system.development_lineages, table system.development_events, function system.assign_development_event_sequence, function system.reject_development_event_mutation, function public.record_development_event, function public.read_development_history, function system.development_release_readiness, table system.development_change_sets, table system.development_change_files, table system.development_event_change_sets, table system.development_change_set_approvals, function public.register_development_change_set, function public.read_development_change_set_for_approval, function public.approve_development_change_set, function public.link_development_event_to_change_set, function public.read_development_change_sets, function public.read_public_development_change_sets, function system.development_release_readiness.
Production Supabase migration evidence (observed 2026-11-23): project xeytcavxejhyzxwevgto; 20261123000002 was applied with SQL SHA-256 90c00c5459d461b73ac95185c4b8992bf722b78af8909d53a147910fd6ce3ebd; 20261123000001 history was reconciled after existing objects were verified. Older remote migration versions diverge from this checkout, and no bulk migration push was run. Evidence: [docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md](https://github.com/t23598788-oss/DNAOS/blob/77d539c20f52860fe650d5cd47301b36cdf039e4/docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md).
Registered compute resources: 0. Live instance status is not claimed unless recorded and freshly verified.

## Evidence limits
Deployment IDs are dated observations from the cited service map and may predate this source revision. The public JSON lists paths and SHA-256 hashes only; it excludes secrets, customer data, financial payloads, and private account identifiers.

Machine-readable version: [system-map.json](/system-map.json)
Brand kit: [manifest](https://dnaos.dev/assets/brand/dna-os/v1/brand-assets.json) · [usage notes](https://dnaos.dev/assets/brand/dna-os/v1/README.md)
