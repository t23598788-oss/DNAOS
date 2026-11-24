<p><img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.svg" alt="DNA OS" width="148" height="60"></p>

# DNA OS sign-in route map

**Snapshot:** 2026-11-24 06:19 Bangkok time
**Scope:** public entry, identity providers, sessions, auth email, and production-to-source mapping.

This page separates three kinds of evidence: live HTTP observations, checked-in source configuration, and provider-dashboard settings that cannot be confirmed from the repository. A route in source is not proof that it is deployed.

The production observations above are a dated snapshot. The later local candidate audit at the end of this document supersedes its source-code descriptions where they differ; it does not supersede or imply a Production deployment.

## Route map

```text
Browser → Cloudflare route dnaos.dev/login
        → dnaos-auth-entry Worker (allowlisted auth-only surface)
        → workers/business-onboarding/index.ts auth handlers
        → Supabase Auth project xeytcavxejhyzxwevgto
        ├─ email OTP → Supabase Auth template → Custom SMTP → Resend → inbox
        └─ OAuth provider → Supabase OAuth callback → DNA OS /auth/confirm → one DNA OS session → safe in-app destination
```

The email path is the active sign-in path. OAuth remains a separate incomplete path: the production callback returns 404, and the auth Worker has no allowlisted OAuth start or callback endpoint.

## Services and connections

| Category | Service / owner | Public route or source | Current evidence | Remaining connection |
|---|---|---|---|---|
| Entry page | Cloudflare Worker `dnaos-auth-entry` | `/login`, `/start` → `workers/auth-entry/index.ts`; route declarations in `workers/auth-entry/cloudflare.config.ts` | Production `/login` and `/start` return 200. The homepage sign-in links point to `/login`. The auth-only Worker is separate from the homepage Worker. | Finish the post-login return destination when the workspace shell exists. |
| Auth gateway | `dnaos-auth-entry` → imported `workers/business-onboarding/index.ts` | `/v1/auth/csrf`, `/otp`, `/verify`, `/refresh`, `/logout`, `/session` | CSRF endpoint responds 200; a signed-out session responds 401; a malformed OTP request is rejected before provider delivery. A valid OTP request returned 202 and one matching message arrived in the owner inbox. | Complete code verification in the user's browser, then verify cookie persistence, refresh, and logout. No OTP value was read or used in this inspection. |
| Identity database | Supabase Auth, project `xeytcavxejhyzxwevgto` | Supabase Auth API; Worker secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` | OTP/session logic is present in source. Provider enablement and redirect allowlist in the live Dashboard are not proven by repository files. | Confirm provider toggles, site URL and exact redirect allowlist in Supabase Dashboard. Never put secrets in this document. |
| Google / Apple / Facebook / LINE / TikTok | External identity providers via Supabase Auth | Intended provider → Supabase → DNA OS callback | Current Worker UI does not start OAuth; provider tiles are illustrative. The release ledger records a live Google OAuth probe returning `400 provider is not enabled`, with provider toggles, redirects and Google Console callback still blocked (`V2_PRODUCTION_REPLACEMENT_MATRIX.md`, OAuth row). This is the latest code-side evidence found, not proof of current Dashboard state. | Recheck current Supabase and Google Cloud settings. Supabase's Google callback is `https://xeytcavxejhyzxwevgto.supabase.co/auth/v1/callback`; the DNA OS post-login redirect must separately allow `https://dnaos.dev/auth/confirm`. Verify both exact values in their respective consoles; then exercise a real sign-in and return. Do not assume either console is configured from the domain being live. |
| OAuth callback and session handoff | DNA OS auth application | `app/auth/confirm/route.ts` | Callback code exists in source and handles OAuth PKCE exchange plus OTP verification. Production `GET /auth/confirm` returns 404; `/auth/verify` also returns 404. Auth Worker has no such route. | Expose the canonical callback on the production host or add a safe allowlisted callback route in the auth Worker; preserve one-time code verification, safe internal `next`, and one-account session issuance. |
| Session memory | Worker auth cookies / Supabase Auth | `workers/business-onboarding/index.ts` | Source sets access cookie up to 1 hour and refresh cookie to 30 days; refresh endpoint rotates the pair. This supports returning sessions while cookies remain valid. Browser/device persistence is not proven by an unauthenticated HTTP probe. | Verify cookie attributes and real browser refresh behavior; add device/passkey only as a separate follow-up after this core route is complete. |
| Auth email | Supabase Auth → Custom SMTP → Resend | [`AUTH_EMAIL_TEMPLATES`](AUTH_EMAIL_TEMPLATES_2026-11-23.md), template package and index | One production OTP request was accepted and a matching message was found in the owner inbox. Source package has 13 templates; the production Dashboard configuration for all 13 has not been verified. | Complete code verification and reconcile the hosted templates; do not treat the email receipt alone as a completed login. |
| DNA OS identity artwork | Homepage Worker static assets on `dnaos.dev` | `/assets/dna-os-mark-d.png`, `/assets/dna-os-integration-generic.svg` | Both assets now return 200 from the live homepage Worker; login markup uses these shared static paths. | None for the current login artwork. |
| Website navigation | Cloudflare homepage Worker `dnaos-homepage` | `/` and `/assets/*`; source `workers/landing-entry/wrangler.jsonc` | Production homepage is live, and its sign-in links point to `/login`, which reaches the separate auth Worker. | Keep the two Worker route sets separate. |
| Public system map and brand kit | Cloudflare Worker `dnaos-homepage` → static `public/landing-preview` assets | `/system-map*`, `/assets/brand/dna-os/v1/*` | Map exports and brand assets respond from the deployed homepage Worker. The map pins source revision `77d539c20f52860fe650d5cd47301b36cdf039e4`. | Keep the documents and brand kit as static assets. |
| PWA service worker | `public/sw.js` → `components/pwa/PwaRegistration.tsx` | `/sw.js` | The existing source is copied unchanged into the homepage asset bundle; production now returns 200. | None for route delivery. |
| `www` alias | Dedicated Cloudflare Worker `dnaos-www-redirect` → apex canonical host | `www.dnaos.dev/*` → `https://dnaos.dev/*` | A separate Worker with no static asset binding returns 308 and preserves path and query. Production root and a query-string `/login` request both redirect correctly; DNS remains unchanged. | Search Console re-crawl/removal of old indexed snippets remains separate. |

## Google OAuth and Google Search are separate routes

Google OAuth is an identity-provider connection: Google returns authorization to Supabase's callback, then Supabase redirects the user to the allowlisted DNA OS callback. Current source/history does **not** prove it is enabled: the release matrix records the production error `400 provider is not enabled`. This needs a fresh console check because settings could have changed after that record. The DNA OS callback currently responds 404, so even an enabled provider cannot complete the intended return path until that route is restored.

Google Search indexing is separate from OAuth and does not grant or deny login. The owner's exact Google result at 19:09 Bangkok time showed **“DNA OS — Developer Portal”** at **`https://www.dnaos.dev/`**, with an old snippet describing the 8-layer architecture. At that time `www` root and `/login` returned 404 while apex `/` returned the live landing page. The later release added a `www` → apex redirect; the indexed snippet may remain stale until Google recrawls.

The apex `robots.txt` allows public search, `/sitemap.xml` returns 404, and the public `/system-map`, `.json`, and `.md` routes are available. That generated map says `2026-11-23T07:53:56.027Z` and source revision `77d539c20f52860fe650d5cd47301b36cdf039e4`, older than the login source changes recorded above. A generic `site:dnaos.dev` query returned no result in one search lookup; the owner's exact Google query did return the old `www` result. The signed-in browser result may be region/account personalized, so current index state still needs confirmation in Search Console.

**Next check for Search:** inspect verified apex and `www` properties in Google Search Console, their Page Indexing / URL Inspection results, and submitted sitemap state. `/sitemap.xml` previously returned 404; current Search Console ownership, sitemap submission and index state are not visible from this repository or public HTTP. The `www` → apex redirect is now live. Refreshing search results is not an OAuth setting and may take time after Google recrawls.

## Cloudflare route reconciliation (DNS unchanged)

The pre-release Cloudflare inspection found these route groups. Their current live status follows each item:

1. `www.dnaos.dev/*` — Google previously indexed the old “DNA OS — Developer Portal” at this host. The separate `dnaos-www-redirect` Worker now redirects requests to the apex with 308, preserving path and query. DNS remains unchanged.
2. `dnaos.dev/system-map*` — the HTML map, JSON index, Markdown reference and AI ZIP are included in the homepage Worker's deployed static assets and respond 200.
3. `dnaos.dev/sw.js` — the existing service worker is included unchanged in the deployed homepage asset bundle and responds 200.

The signed-in dashboard's nine-route table and 24-hour analytics are pre-release snapshots. Current production additionally serves `/sw.js`, all four `/system-map*` paths, and a separate `www.dnaos.dev/*` redirect Worker; see the [Cloudflare traffic audit](CLOUDFLARE_TRAFFIC_AUDIT_2026-11-23.md). DNS is unchanged.

## Production observations

Read-only HTTP checks against `https://dnaos.dev` on 2026-11-23 around 18:58 Bangkok time:

| Request | Result | Meaning |
|---|---|---|
| `GET /login` | `200 text/html` | Login entry is live. |
| `GET /start` | `200 text/html` | Start page is live. |
| `GET /auth/confirm` | `404` | The documented OAuth / email callback is not reachable at this path. |
| `GET /auth/verify` | `404` | No public verification page at this path. |
| `GET /v1/auth/session` | `401 application/json` | No session was present in the probe; endpoint is responding. |
| `GET /assets/brand/dna-os/v1/brand-assets.json` | `200 application/json` | Canonical public brand asset manifest is reachable. |
| `GET /assets/brand/dna-os/v1/dna-os-horizontal-mono.svg` | `200 image/svg+xml` | Document/logo variant is reachable. |
| `GET /assets/brand/dna-os/v1/dna-os-mark-color.svg` | `200 image/svg+xml` | Color mark is reachable. |
| `GET /brand/dna-os-mark-d.png` | `404` | Current app-style asset path is not served by the production static asset route. |
| `GET https://www.dnaos.dev/` | `404` (no redirect) | The `www` host does not serve the live site or redirect to the apex host. |
| `GET https://www.dnaos.dev/login` | `404` | Login is reachable on the apex host, not `www`, in this inspection. |
| `GET /system-map` | `200 text/html` | Static public document is still live. |
| `GET /system-map.json` | `200 application/json` | Machine-readable system map is still live. |
| `GET /system-map.md` | `200 text/markdown` | Markdown reference is still live. |
| `GET /system-map-ai.zip` | `200 application/zip` | Download package is still live. |

Those checks are retained as pre-release evidence and do not describe the current `www` or static-asset routes.

Latest read-only production observations on 2026-11-23 around 20:15 Bangkok time:

| Request | Result | Meaning |
|---|---|---|
| `GET /` | `200` | Homepage Worker serves the first screen. |
| `GET /login`, `GET /start` | `200 text/html` | Auth entry page and start route respond. |
| `GET /v1/auth/csrf` with exact origin | `200` | CSRF bootstrap is configured and reachable. |
| `GET /v1/auth/session` without cookies | `401` | No session is established in this probe; endpoint responds. |
| `POST /v1/auth/otp` with malformed email | `400 EMAIL_INVALID` | Input is rejected before the Auth provider call. |
| `POST /v1/auth/otp` for the owner account | `202 accepted`; one matching inbox message found | Supabase Auth → Custom SMTP → Resend delivered the sign-in-code message. The code was not read or used. |
| `/assets/dna-os-mark-d.png`, `/assets/dna-os-integration-generic.svg` | `200` | Login artwork loads from the homepage static route. |
| `/sw.js`, `/system-map`, `/system-map.json`, `/system-map.md` | `200` | Deployed homepage assets and reference routes respond. |
| `https://www.dnaos.dev/` | `308` → `https://dnaos.dev/` | Canonical host redirect is live. |
| `https://www.dnaos.dev/login?next=%2Fworkspace` | `308` preserving path and query | Return-path query survives canonicalization. |
| `GET /auth/confirm` | `404` | OAuth callback is not deployed; social sign-in is not complete. |

The inbox match proves delivery only. Code verification, authenticated browser cookie persistence, refresh, logout and organization-scoped access still need a signed-in session flow.

## Change and evidence timeline

Times are Bangkok time (UTC+7), taken from Git commit metadata or the production probe above.

| Date and time | Evidence | Change / event |
|---|---|---|
| 2026-09-24 20:27 | Git `0fe09b8` | Earlier unified identity implementation included Google, Apple and Microsoft OAuth and a shared `/auth/confirm` PKCE/OTP verifier. Historical source evidence only. |
| 2026-11-20 13:21 | Git `f78e09e` | Isolated Cloudflare auth-entry Worker introduced. |
| 2026-11-23 15:04 | Git `97439c1` | Email OTP sign-in page and card revised. |
| 2026-11-23 15:57 | Git `68b6ebd` | Auth email delivery route and DNA OS brand asset registry documented; changelog `DNA-000219`. |
| 2026-11-23 17:07 | Git `92102c9` | Login identity provider connection points added to the entry UI. |
| 2026-11-23 18:37 | Git `2d6f99a`, `b26e018` | DNA OS asset usage standardized and account panel background aligned. These commits are on `codex/auth-entry-email-card-2026-11-23`; production still serves the older login rendering. |
| 2026-11-23 18:58 | Live HTTP observation | `/login` and `/start` respond, but `/auth/confirm` is 404 and the `/brand/*` login image path is 404. |
| 2026-11-23 19:03 | Live HTTP + release ledger | `/sitemap.xml` is 404; public system map identifies older source revision `77d539c...`; release matrix records the previous Google OAuth live probe as `400 provider is not enabled`. These are independent search-index and login-configuration gaps. |
| 2026-11-23 19:09 | Owner Google result + live HTTP | Google shows “DNA OS — Developer Portal” at `https://www.dnaos.dev/`; live `www` root and login return 404, while apex root returns the current landing page. The indexed `www` URL has no current redirect. |
| 2026-11-23 19:16 | Production map + Git source + Cloudflare session | The live map serves four `/system-map*` resources from the `dnaos-homepage` asset Worker and pins revision `77d539c…`; that revision declares all four routes, while the current source declares only `/` and `/assets/*`. Cloudflare Dashboard in Chrome required sign-in, so active route attachments remain unverified. DNS unchanged. |
| 2026-11-23 19:23 | Cloudflare Analytics + Workers Routes (signed-in dashboard) | 2.25k requests in 24h; 1.31k 404, 1.43k 4xx total, 0 5xx; 2.06k desktop requests. Of 404s, 282 are on `www.dnaos.dev` and 1.03k on apex. Dashboard confirms nine apex Worker routes, none for `www` or `/sw.js`. Top 404 paths include `/sw.js` (99), root `/` (42), and automated-looking probes such as `/.env*`, `/nuxt/.env`, and `/admin/dashboard`. No DNS or production settings changed. |
| 2026-11-23 19:35 | Source reconciliation | Corrected the `/sw.js` diagnosis after tracing the app's real registration and worker source. Restored production-pinned system-map and brand-kit assets/routes; added the unchanged service-worker asset/route, mirrored the two existing DNA OS assets into the homepage bundle and corrected the login asset paths, and prepared a `www` → apex 308 redirect. No DNS or production settings changed; production release remains pending. |
| 2026-11-23 19:46 | Owner-approved cleanup and sequence | Removed the unused public price table and its only caller; registry sync records both as retired. Set the release order: first-screen website, identity/session/permissions, email triggers, workspace category navigation, then capability-to-processor gateway links. |
| 2026-11-23 19:55 | Redirect route isolation | Review identified that asset-first routing could bypass a redirect inside the homepage Worker. Moved `www` canonicalization into its own Worker with no asset binding, keeping homepage static requests on the asset-first path and leaving DNS unchanged. |
| 2026-11-23 20:04 | GitHub PR #35 merge `efab9db` | Merged homepage routes/assets, retired public price components and the isolated `www` redirect. Governance jobs could not start under the billing lock; the owner had approved skipping them. PR/review/status rules were restored after merge. |
| 2026-11-23 20:05 | Cloudflare Worker deployment | `dnaos-homepage` deployed version `d7c11b7e-60e3-41bc-b3f8-887515c38ac8`; added `/sw.js`, system-map paths and shared login artwork while retaining asset-first serving. |
| 2026-11-23 20:06 | Cloudflare Worker deployment | `dnaos-www-redirect` deployed version `35e04be4-3d7a-472f-868b-4f7e8ab3def1`; `www` redirects to apex. DNS remains unchanged. |
| 2026-11-23 20:17 | Live auth and email route check | Login links and `/login`, `/start`, CSRF and signed-out session routes respond. One owner OTP request returned 202 and one matching inbox message was found; the code was not read or used. |

## Build and release order

1. **Publish the first screen and site scope — complete.** Homepage, system-map documents, brand kit, static assets, service worker and `www` redirect are live. The home sign-in action opens `/login`; DNS is unchanged.
2. **Finish the single account entrance — in progress.** The auth-only Worker, CSRF bootstrap, OTP request/verify handlers, HTTP-only session/refresh cookies and gateway permission boundary exist in source and production routes. Next verify an authenticated session and define a safe return destination; OAuth providers and `/auth/confirm` are not connected.
3. **Complete email sign-in triggers — delivery confirmed, sign-in not yet confirmed.** One owner OTP request was accepted and one inbox message was found through Supabase Auth → Custom SMTP → Resend. Next complete OTP verification and session creation, then reconcile the 13 hosted templates. The code was not retrieved or used in this run.
4. **Build the workspace shell and category navigation.** Add the blank workspace, settings entry and category/icon markers as navigation only. Do not couple category presentation to backend processors yet.
5. **Connect capabilities through the gateway.** For each capability, wire the authenticated request from the gateway to its authorized backend processor and return path. Add its event record and scope only when the processor boundary is defined.

Next, complete an authenticated OTP session and its permissions/return boundary. Then build the blank workspace and category navigation; only afterward connect capability requests to backend processors.

At this snapshot, do not label Google, Apple, Facebook, LINE, TikTok or device biometrics as production-connected. Their dashboard setup and end-to-end callbacks have not been verified. Email OTP is the only documented/current route to finish first.

## Sources

- Cloudflare route declarations: [`workers/auth-entry/cloudflare.config.ts`](../workers/auth-entry/cloudflare.config.ts), [`workers/landing-entry/wrangler.jsonc`](../workers/landing-entry/wrangler.jsonc)
- Auth allowlist and gateway implementation: [`workers/auth-entry/index.ts`](../workers/auth-entry/index.ts), [`workers/business-onboarding/index.ts`](../workers/business-onboarding/index.ts)
- OAuth callback source: [`app/auth/confirm/route.ts`](../app/auth/confirm/route.ts)
- Email delivery and template boundary: [`Auth email guide`](AUTH_EMAIL_TEMPLATES_2026-11-23.md), [`template index`](../supabase/templates/dna-os-auth-v1/template-index.json)
- Provider logo use: [`DNA OS Brand Standard`](brand/DNA_OS_BRAND_STANDARD.md)
- Provider setup references: [Supabase Google login](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) — Google Console's authorized redirect URI is the Supabase project's callback; [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) — DNA OS `redirectTo` must separately match the project's allowlist; [Google Search indexing FAQ](https://developers.google.com/search/help/crawling-index-faq) — sitemap submission helps discovery but does not guarantee indexing; [Request Google recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl) — URL Inspection requires a verified Search Console owner/full user.

## Production login release record — 2026-11-24

The current white sign-in screen is served at [`https://dnaos.dev/login`](https://dnaos.dev/login) by the separate Cloudflare Worker `dnaos-auth-entry`. The homepage's sign-in action routes into this page. The UI source is `workers/business-onboarding/entry-page.ts`, reached through `workers/auth-entry/index.ts`; the route and auth API bindings are declared in `workers/auth-entry/cloudflare.config.ts`.

The deployment and live-page check are recorded under the existing `dnaos-platform` identity lineage in Supabase `system.development_events`:

| Sequence | Event | Status | Production Worker version | Source commit |
|---:|---|---|---|---|
| 14 | `deployment_completed` | passed | `c23863da-109f-4d28-8f01-f525c64f3b49` | `16000a9d8f6bacdb3c711d0ca24397e93dcf56cb` |
| 15 | `live_route_verified` | passed | `c23863da-109f-4d28-8f01-f525c64f3b49` | `16000a9d8f6bacdb3c711d0ca24397e93dcf56cb` |

The shared commit and deployment ID link the visible login page to the code and its live Worker version. The event rows are append-only; use the `dnaos-platform` history projection to follow later releases. This records the page delivery and visual route check only; it does not claim that every identity provider is enabled or that a signed-in session has been completed.

## Local authentication release candidate audit — 2026-11-24 08:14 Bangkok time

This is a local release-candidate branch based on `main` at `42191e944a1af58797cc703a5b9a9efae0314683`. It has not been published to GitHub, merged, or deployed. The latest Production history event remains sequence 20 (`deployment_completed`) for commit `42191e944a1af58797cc703a5b9a9efae0314683`; that event does not include the files listed below.

### Change groups

| Group | Changed source and assets | Intended flow | Local evidence |
|---|---|---|---|
| Auth entry and session | `workers/auth-entry/index.ts`, `workers/auth-entry/cloudflare.config.ts`, `workers/business-onboarding/index.ts`, `workers/business-onboarding/entry-page.ts` | Landing `/login` → email OTP or Google start → Supabase → DNA OS `/auth/confirm` → `/workspace`; workspace logout returns to `/login` | Worker typecheck, Vite build, and `test-auth-surface.mjs` pass locally. This does not prove live OTP completion, provider enablement, browser cookie persistence, or organization authorization. |
| Provider button asset | `public/landing-preview/assets/providers/google/` | The Google sign-in control uses the official Google-provided artwork and points to `/auth/google?next=%2Fworkspace`. Other provider tiles remain noninteractive. | Source asset and its provenance README are present. Google OAuth credentials are not in source. |
| App and brand assets | `public/favicon.ico`, `public/icons/*`, `public/manifest.json`, `public/landing-preview/favicon.ico`, `public/landing-preview/icons/*`, `public/landing-preview/manifest.json`, `public/landing-preview/index.html`, `presentation/assets/manifest.ts` | Homepage serves the current color DNA OS mark and app icons; PWA start destination is `/workspace`. | Source paths and asset manifests are locally present; the homepage Worker still needs a release before production serves these candidate files. |
| Static asset route | `workers/landing-entry/wrangler.jsonc` | Homepage Worker routes `/favicon.ico`, `/manifest.json`, and `/icons/*` to its static assets. | Local route declaration only; not evidence of a live Cloudflare route. |
| Auth surface verification | `workers/auth-entry/test-auth-surface.mjs` | Exercises auth-only route boundaries and callback/session surfaces. | Passed locally at 2026-11-24 08:07 Bangkok time. |

### Live settings and release gates

- Supabase production project is `xeytcavxejhyzxwevgto`. `https://dnaos.dev/auth/confirm` is visible in its redirect allowlist. The Site URL is still `https://dna-os-deadboard-production.up.railway.app`; it was not changed. The Google provider page could not be reloaded successfully during this audit. The latest readable provider inspection from the preceding session showed Google disabled with no Client ID/Secret configured; treat that as last-known, not a fresh verification.
- Google Cloud's authorized redirect URI must be `https://xeytcavxejhyzxwevgto.supabase.co/auth/v1/callback`. This is separate from Supabase's post-login allowlist URL above. Credentials must be configured by the owner in the provider console; do not store them in this repository or history ledger.
- The auth Worker route and Google OAuth callback code are source-only until the auth Worker is deployed. The changed favicon, PWA manifest, and icon routes are source-only until the homepage Worker is deployed.
- The real email OTP → verified browser session → `/workspace` route and Google sign-in → callback → `/workspace` route have not been completed against Production. The current candidate is not ready for a Production release.
- Supabase's live migration history records `20261123000002 development_change_sets` as applied. The `main` baseline used for this candidate lacked that migration source; this candidate restores the exact file from Git commit `5fd49b8b18e528842c0019079b51cabf0d241d18` and restores the ledger manual and registration script. This closes the source-file gap in the candidate branch, not in `main` until merged. Do not reapply the migration. The live migration table records version/name, not a SQL checksum, so the exact applied bytes still need a checksum/catalog reconciliation before a production release claim.

### Provenance status

The database remains the source of truth for append-only events and per-file hashes. This candidate restores the bundle-registration workflow and the source migration that the live database already lists as applied; it does not run that migration again. At the time of the initial candidate audit, no event or change set had been written. The service-role credential has since been stored in the local macOS Keychain, and a fresh read at 2026-11-24 08:50 Asia/Bangkok still found the prior 20 events and no public change-set rows. Candidate commits remain local until their publication, merge, deployment, and live-route events are recorded after those actions actually occur.

### Supabase provider configuration recheck — 2026-11-24 08:50 Asia/Bangkok

Read the Production Supabase Auth public settings endpoint using the locally stored service credential. Email is enabled; Google, Apple, Facebook, LINE, TikTok, phone, and the other listed external providers report disabled. This read does not reveal whether provider client credentials are present, and no provider setting was changed. The Google route still returns 404 in Production, so the Auth Worker must not be released as a completed Google sign-in flow until the provider is enabled with valid credentials and its callback is verified. The refreshed public endpoint status records this observation.

## Public endpoint and crawler audit — 2026-11-24 08:28 Bangkok time

Fresh unauthenticated Production probes used exact GET paths and did not submit an OTP, start an OAuth flow, send a webhook, or write business data. Results are published in the candidate's `public/landing-preview/api-status.json` and summarized in `api-reference.md`:

| GET path | Production result | Meaning |
|---|---:|---|
| `/`, `/login`, `/start` | 200 | Public page/entry routes respond. |
| `/v1/auth/csrf` with `Origin: https://dnaos.dev` | 200 | Browser CSRF bootstrap responds; returned token was not recorded. |
| `/v1/auth/session` without session cookie | 401 | Session route responds and correctly has no authenticated session. |
| `/auth/google`, `/auth/confirm`, `/workspace` | 404 | Candidate routes are not deployed to Production. |
| `/system-map`, `.json`, `.md`, `-ai.zip` | 200 | Public reference resources respond. Their map snapshot is stale: generated `2026-11-23T07:53:56.027Z`, source revision `77d539c20f52860fe650d5cd47301b36cdf039e4`. |
| `/llms.txt`, `/openapi.json`, `/sitemap.xml` | 404 | These discovery/contract files are not served by Production yet. |

GET probes for POST-only refresh/logout endpoints returned 404 by design, so they are not classified as unavailable. The OTP endpoint's last successful 202/delivery observation remains the separately dated 2026-11-23 record; this audit did not send another email. The public map's Railway/Vercel entries identify source-level adapters only, not public DNA OS API routes or proof of live provider accounts. The candidate adds a method-aware endpoint guide, JSON status index, and `llms.txt` as static homepage assets; these files remain unavailable until the homepage Worker is deployed.

The live `robots.txt` allows the general Googlebot via `User-agent: *` / `Allow: /` but explicitly disallows Google-Extended, GoogleOther, Google-CloudVertexBot, and Google-Agent. Google says Google-Extended controls Gemini training/grounding and does not affect Google Search inclusion; these crawler policies are distinct. This candidate does not change `robots.txt` or authorize broader AI content access. A sitemap is also not served yet. See [Google's crawler documentation](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers).
