# Cloudflare service and page map — 2026-11-23

This map records the observed Cloudflare deployment boundaries and the source paths used for the login-surface build. A configured source route is not, by itself, evidence of a live provider connection.

## Browser routes

| Live service | Cloudflare route | Source/configuration | Destination | Observed state |
| --- | --- | --- | --- | --- |
| `dnaos-homepage` | `https://dnaos.dev/`, `/assets/*` | `workers/landing-entry/index.ts`; `workers/landing-entry/wrangler.jsonc`; assets in `public/landing-preview/` | Public landing page and static brand assets. Landing-page sign-in links target `/login`. | Live HTTP 200; deployment `a763d013-b2d3-4452-b919-54ef2bccff64`, 2026-11-23 01:15 UTC. |
| `dnaos-auth-entry` | `https://dnaos.dev/login`, `/start`, `/v1/auth/*` | `workers/auth-entry/index.ts`; `workers/auth-entry/cloudflare.config.ts`; shared page/auth handlers in `workers/business-onboarding/` | Login/OTP page and the allowlisted session endpoints. | Live `/login` and `/start` HTTP 200; latest observed deployment `ebdac195-7eec-4e7e-8e76-de4190397816`, 2026-11-22 11:46 UTC. |

The authentication Worker imports `workers/business-onboarding/index.ts` and supplies a newly constructed, allowlisted environment with `AUTH_ONLY=true`. This reuses authentication code without exposing the business Gateway or deploying `dnaos-business-onboarding` as a separate Worker. The live login page currently verifies an email OTP and retains an authenticated session on the same page. No application/workspace destination is routed on `dnaos.dev` (`/app`, `/workspace`, and `/auth/confirm` returned 404 during inspection), so successful login must not claim to enter an application that is not deployed there.

## API/service Workers (not browser pages)

| Live service | Source/configuration | Route / role | Observed state |
| --- | --- | --- | --- |
| `dnaos-demand-ingest` | `workers/demand-ingest/index.ts`; `workers/demand-ingest/cloudflare.config.ts` | Inbound demand/order service; no public browser page route in its config. | Deployed; Workers Dev and preview URLs disabled. |
| `dnaos-stock-ingest` | `workers/stock-ingest/index.ts`; `workers/stock-ingest/cloudflare.config.ts` | Stock data ingestion; no public browser page route in its config. | Deployed; Workers Dev and preview URLs disabled. |
| `dnaos-fulfillment-ingest` | `workers/fulfillment-ingest/index.ts`; `workers/fulfillment-ingest/cloudflare.config.ts` | Fulfillment status ingestion; no public browser page route in its config. | Deployed; Workers Dev and preview URLs disabled. |
| `dnaos-business-onboarding` | Shared source: `workers/business-onboarding/index.ts` | Not a separately deployed Cloudflare Worker; imported behind the Auth Worker boundary. | Cloudflare reported no Worker by this name. |

## Meta Pages connector: existing pipe and remaining wiring

Meta should extend the central Connect/Gateway path used by provider adapters, not create a second database or event pipeline.

- Existing source: `engines/integration-gateway/adapters/meta.ts` validates Meta signatures and normalizes Facebook Page Messenger / Instagram messaging events; `app/api/gateway/observe/meta/route.ts` handles webhook verification, calls the adapter, and publishes to the canonical event bus. It is an inbound observe receiver, not a Page OAuth flow, Page selector, catalog sync, or outbound Page automation connector.
- Existing reusable connection pieces: `engines/connect/accounts.ts` resolves account metadata and credentials through the provider-neutral accessor; `app/api/gateway/observe/line/route.ts` demonstrates multi-account webhook credential resolution by LINE destination. The `connect_external_accounts` / `connect_external_identities` migration is present in source but marked NOT APPLIED, so confirm live schema before routing Meta through it.
- Meta App webhook setup now has a Connect contract (`provider=meta`): it stores `app_id` as connector config and `app_secret` / `verify_token` in the existing server-only connector secret store, derives the callback URL, and follows the existing Register → Test → Enable lifecycle. The receiver reads those credentials from that same connector; it no longer depends on `META_APP_SECRET` / `META_VERIFY_TOKEN` environment variables. Duplicate Meta app connectors fail closed as ambiguous.
- The Meta allow-list migrations `20261007000001_propose_meta_gateway_providers.sql` and `20261007000002_propose_source_channel_meta.sql` are explicitly DRAFT / NOT APPLIED. Do not claim Meta events are production-writable until the approved migration state and deployed route are verified.
- The existing capability map references `meta-mcp`, but `mcp.json` has no Meta MCP server entry; that reference is not a working Page integration.
- The shared Gateway description and Connector Catalog now list Facebook Pages/Messenger and Instagram as separate inbound observer identities, backed by the existing shared Meta adapter. They are not marked as outbound-capable merely because the global Execute channel exists. The Connect contract configures the Meta App webhook only; Page OAuth, page selection, organization binding, Catalog/stock sync, publishing, comments, and order operations remain outside the implemented capability.
- Request permissions by selected task only: Page listing/webhook subscription (`pages_show_list`, `pages_manage_metadata`), Messenger access (`pages_messaging` plus the required Page task), Page publishing (`pages_manage_posts`, `pages_read_engagement`, `pages_show_list`), and catalog sync (`catalog_management`, separate Meta App Review). A login provider grant is separate from Page/Catalog consent and from DNA OS organization access.
- Public workbench source `workers/business-onboarding/connections-page.ts` now links the official Meta Pages webhook, Page listing, and catalog references and records this status/scope split. The Connectors catalog source also declares only the permissions relevant to the currently implemented receive path.

## Login/auth boundary

- `GET /login` and `GET /start` render the shared login page from `workers/business-onboarding/entry-page.ts`.
- `GET /v1/auth/csrf`, `POST /v1/auth/otp`, `POST /v1/auth/verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, and `GET /v1/auth/session` are the public auth-only endpoints allowlisted in `workers/auth-entry/index.ts`.
- The page currently uses the configured Supabase email OTP flow, and its OTP request sets `create_user: false`; this confirms only existing DNA OS identities can use this Worker today. A first-time public identity cannot yet be created through this entry route.
- Identity decision from the owner: one personal DNA OS identity is the common entry; organization membership is not required to sign in. Organization administrators later assign module and business permissions. Each billed account has one named human responsible for payment; this billing responsibility is separate from login provider and business/system authority.
- The production provider inspection showed Email and Wallet enabled, but the Worker has no Wallet flow. Phone and standard OAuth providers were disabled and no custom LINE/TikTok providers were configured at inspection time. Do not display these as working login methods until provider setup, same-identity linking, and callback paths are implemented and verified.
- Current UI scope: login presentation only, with the email OTP interaction preserved and the personal-identity / separate-organization boundary stated. Local build passed at 2026-11-23 04:51 UTC (`npm run build` and `npm run typecheck` in `workers/auth-entry`). Node 24.16.0 emitted an engine-range warning because the package requests Node 24.22.0 or later; the build and typecheck still completed successfully. No Cloudflare deployment or Supabase provider setting was changed in this work.

## Evidence and limits

Service names, routes, and deployment references above came from the authenticated Cloudflare deployment inspection on 2026-11-23. HTTP status checks were made against the public `dnaos.dev` routes. Provider availability came from a read-only Supabase Auth dashboard inspection. Deployment references are observations, not claims that this local source revision is already deployed.
