<p><img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.svg" alt="DNA OS" width="148" height="60"></p>

# DNA OS sign-in route map

**Snapshot:** 2026-11-23 19:23 Bangkok time
**Scope:** public entry, identity providers, sessions, auth email, and production-to-source mapping.

This page separates three kinds of evidence: live HTTP observations, checked-in source configuration, and provider-dashboard settings that cannot be confirmed from the repository. A route in source is not proof that it is deployed.

## Route map

```text
Browser → Cloudflare route dnaos.dev/login
        → dnaos-auth-entry Worker (allowlisted auth-only surface)
        → workers/business-onboarding/index.ts auth handlers
        → Supabase Auth project xeytcavxejhyzxwevgto
        ├─ email OTP → Supabase Auth template → Custom SMTP → Resend → inbox
        └─ OAuth provider → Supabase OAuth callback → DNA OS /auth/confirm → one DNA OS session → safe in-app destination
```

The email path is the active sign-in path. The OAuth path describes the intended and previously implemented route; its production callback currently fails because `/auth/confirm` returns 404. The Worker has no allowlisted OAuth start or callback endpoint today.

## Services and connections

| Category | Service / owner | Public route or source | Current evidence | Remaining connection |
|---|---|---|---|---|
| Entry page | Cloudflare Worker `dnaos-auth-entry` | `/login`, `/start` → `workers/auth-entry/index.ts`; route declarations in `workers/auth-entry/cloudflare.config.ts` | Production `/login` and `/start` return 200. `/login` is served by the auth Worker and is not the same Worker as the homepage. | Publish the reviewed sign-in UI through this Worker and confirm it on the production route. |
| Auth gateway | `dnaos-auth-entry` → imported `workers/business-onboarding/index.ts` | `/v1/auth/csrf`, `/otp`, `/verify`, `/refresh`, `/logout`, `/session` | Source allowlist is explicit. Production `/v1/auth/session` returns 401 while signed out, as expected. OTP route is the current interactive method. | Run a signed-in browser flow to confirm email OTP, cookie persistence, refresh, and logout end to end. |
| Identity database | Supabase Auth, project `xeytcavxejhyzxwevgto` | Supabase Auth API; Worker secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` | OTP/session logic is present in source. Provider enablement and redirect allowlist in the live Dashboard are not proven by repository files. | Confirm provider toggles, site URL and exact redirect allowlist in Supabase Dashboard. Never put secrets in this document. |
| Google / Apple / Facebook / LINE / TikTok | External identity providers via Supabase Auth | Intended provider → Supabase → DNA OS callback | Current Worker UI does not start OAuth; provider tiles are illustrative. The release ledger records a live Google OAuth probe returning `400 provider is not enabled`, with provider toggles, redirects and Google Console callback still blocked (`V2_PRODUCTION_REPLACEMENT_MATRIX.md`, OAuth row). This is the latest code-side evidence found, not proof of current Dashboard state. | Recheck current Supabase and Google Cloud settings. Supabase's Google callback is `https://xeytcavxejhyzxwevgto.supabase.co/auth/v1/callback`; the DNA OS post-login redirect must separately allow `https://dnaos.dev/auth/confirm`. Verify both exact values in their respective consoles; then exercise a real sign-in and return. Do not assume either console is configured from the domain being live. |
| OAuth callback and session handoff | DNA OS auth application | `app/auth/confirm/route.ts` | Callback code exists in source and handles OAuth PKCE exchange plus OTP verification. Production `GET /auth/confirm` returns 404; `/auth/verify` also returns 404. Auth Worker has no such route. | Expose the canonical callback on the production host or add a safe allowlisted callback route in the auth Worker; preserve one-time code verification, safe internal `next`, and one-account session issuance. |
| Session memory | Worker auth cookies / Supabase Auth | `workers/business-onboarding/index.ts` | Source sets access cookie up to 1 hour and refresh cookie to 30 days; refresh endpoint rotates the pair. This supports returning sessions while cookies remain valid. Browser/device persistence is not proven by an unauthenticated HTTP probe. | Verify cookie attributes and real browser refresh behavior; add device/passkey only as a separate follow-up after this core route is complete. |
| Auth email | Supabase Auth → Custom SMTP → Resend | [`AUTH_EMAIL_TEMPLATES`](AUTH_EMAIL_TEMPLATES_2026-11-23.md), template package and index | The configured path and sender are recorded. The 13-template source package exists; all production Dashboard templates have not been verified. | Reconcile all 13 templates in Supabase Dashboard and run one controlled OTP delivery/return flow. |
| DNA OS identity artwork | Homepage Worker static assets on `dnaos.dev` | `/assets/dna-os-mark-d.png`, `/assets/dna-os-integration-generic.svg` | The login Worker referenced `/brand/*`, which returned 404 because those requests do not belong to its auth-only route allowlist. The exact existing public assets are copied byte-for-byte into the homepage Worker bundle, and the login markup now uses `/assets/*`, already routed to that Worker. Not yet deployed. | Release the auth markup and homepage assets together, then confirm both asset paths return 200 on production. |
| Website navigation | Cloudflare homepage Worker `dnaos-homepage` | `/` and `/assets/*`; source `workers/landing-entry/wrangler.jsonc` | Source routes the home page and static assets separately from `dnaos-auth-entry`. | Ensure the landing page's sign-in button points to `https://dnaos.dev/login`; verify the destination after publishing. |
| Public system map and brand kit | Cloudflare Worker `dnaos-homepage` → static `public/landing-preview` assets | `/system-map*`, `/assets/brand/dna-os/v1/*` | Map exports and brand assets are live. The map pins revision `77d539c20f52860fe650d5cd47301b36cdf039e4`; that revision contains the files and route declarations. The current working branch had dropped them; the static map and 10-file brand kit are restored in the local release source. | Keep the documents and brand kit as static assets. Production release still needs review/deploy. |
| PWA service worker | `public/sw.js` → `components/pwa/PwaRegistration.tsx` | `/sw.js` | The app registers this URL, but production returned 404 and Cloudflare had no matching Worker route. The existing source is now copied unchanged into the homepage asset bundle and its route is declared locally. | Release the homepage Worker with `/sw.js`; then confirm the public URL returns the expected JavaScript. |
| `www` alias | Dedicated Cloudflare Worker `dnaos-www-redirect` → apex canonical host | `www.dnaos.dev/*` → `https://dnaos.dev/*` | The host receives traffic but returned 404. A separate Worker with no static asset binding redirects all methods with 308 while preserving path and query. Its route is declared locally; DNS remains unchanged. | Publish this Worker and verify root, `/login`, `/assets/*`, and a query-string path. |

## Google OAuth and Google Search are separate routes

Google OAuth is an identity-provider connection: Google returns authorization to Supabase's callback, then Supabase redirects the user to the allowlisted DNA OS callback. Current source/history does **not** prove it is enabled: the release matrix records the production error `400 provider is not enabled`. This needs a fresh console check because settings could have changed after that record. The DNA OS callback currently responds 404, so even an enabled provider cannot complete the intended return path until that route is restored.

Google Search indexing is separate from OAuth and does not grant or deny login. The exact Google result opened from the owner's link for query `dna os.dev` shows **“DNA OS — Developer Portal”** at **`https://www.dnaos.dev/`**, with an old snippet describing the 8-layer architecture. In the same inspection, `https://www.dnaos.dev/` and `/login` both returned 404 without redirect, while the apex `https://dnaos.dev/` returned the current landing page with title `DNA OS — Connect business with clear rules`. This is evidence of a stale Google result for the old `www` URL; the old page is not currently served there.

The apex `robots.txt` allows public search, `/sitemap.xml` returns 404, and the public `/system-map`, `.json`, and `.md` routes are available. That generated map says `2026-11-23T07:53:56.027Z` and source revision `77d539c20f52860fe650d5cd47301b36cdf039e4`, older than the login source changes recorded above. A generic `site:dnaos.dev` query returned no result in one search lookup; the owner's exact Google query did return the old `www` result. The signed-in browser result may be region/account personalized, so current index state still needs confirmation in Search Console.

**Next check for Search:** inspect verified apex and `www` properties in Google Search Console, their Page Indexing / URL Inspection results, and submitted sitemap state. Missing sitemap and `www` 404 are confirmed; Search Console ownership and submission are not visible from this repository or public HTTP. Decide whether to establish a permanent `www` → apex redirect before requesting re-crawl/removal of the old indexed URL. Refreshing search results is not an OAuth setting and may take time after the live routes and sitemap are correct.

## Cloudflare route reconciliation (DNS unchanged)

The stale Google result and the old document exports are **two different route groups**:

1. `www.dnaos.dev/` — Google indexes the old “DNA OS — Developer Portal” page here. The live host returns 404. A separate `dnaos-www-redirect` Worker with a path/query-preserving 308 route is prepared locally; not yet deployed. DNS remains unchanged.
2. `dnaos.dev/system-map*` — the apex serves the HTML map, JSON index, Markdown reference, and AI ZIP. The production-pinned source revision (`77d539c…`) contains those exact routes and files; the current working branch had omitted them. They are restored locally to prevent a future homepage release from dropping the map.
3. `dnaos.dev/sw.js` — the current app registers this source, but the URL returned 404 because the Worker bundle and route omitted it. The exact existing worker file is now included in the local asset bundle and the route is declared.

The signed-in Cloudflare Dashboard confirms nine active Worker route attachments on the apex zone: `dnaos.dev/`, `dnaos.dev/assets/*`, `dnaos.dev/login`, `dnaos.dev/start`, `dnaos.dev/v1/auth/*`, and the four `dnaos.dev/system-map*` routes. It has no `www` or `/sw.js` attachment. The homepage source restores the four map paths and bundles the registered `/sw.js` unchanged. A separate `dnaos-www-redirect` Worker handles the `www` alias so homepage static assets do not need Worker-first processing. These route changes remain local and have not been released. DNS is unchanged. Read-only dashboard analytics showed 0.00% 5xx in the last 24 hours; details are in the [Cloudflare traffic audit](CLOUDFLARE_TRAFFIC_AUDIT_2026-11-23.md).

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

These checks prove route responses only. They do not prove a provider login, email arrival, successful callback, or Dashboard credential state.

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

## Build and release order

1. **Publish the first screen and site scope.** Keep the homepage, system-map documents, brand kit and static assets on the homepage Worker. Route the landing-page sign-in action into `/login`; preserve DNS.
2. **Finish the single account entrance.** Connect the sign-in page to the auth Worker, identity source, DNA OS user record, session lifecycle and organization permission boundary. Keep provider buttons aligned with providers actually enabled in Supabase; complete callback routing and safe in-app return paths.
3. **Complete email sign-in triggers.** Keep OTP templates as static source files; Supabase Auth sends through Custom SMTP → Resend. Finish the send, inbox receipt, code verify, session creation and return-to-entry flow, then record the exact provider and template route.
4. **Build the workspace shell and category navigation.** Add the blank workspace, settings entry and category/icon markers as navigation only. Do not couple category presentation to backend processors yet.
5. **Connect capabilities through the gateway.** For each capability, wire the authenticated request from the gateway to its authorized backend processor and return path. Add its event record and scope only when the processor boundary is defined.

The current task prepares the homepage/asset route reconciliation and the single entrance asset paths. The email delivery flow and provider callbacks still need their production end-to-end completion before workspace categories are connected to capabilities.

At this snapshot, do not label Google, Apple, Facebook, LINE, TikTok or device biometrics as production-connected. Their dashboard setup and end-to-end callbacks have not been verified. Email OTP is the only documented/current route to finish first.

## Sources

- Cloudflare route declarations: [`workers/auth-entry/cloudflare.config.ts`](../workers/auth-entry/cloudflare.config.ts), [`workers/landing-entry/wrangler.jsonc`](../workers/landing-entry/wrangler.jsonc)
- Auth allowlist and gateway implementation: [`workers/auth-entry/index.ts`](../workers/auth-entry/index.ts), [`workers/business-onboarding/index.ts`](../workers/business-onboarding/index.ts)
- OAuth callback source: [`app/auth/confirm/route.ts`](../app/auth/confirm/route.ts)
- Email delivery and template boundary: [`Auth email guide`](AUTH_EMAIL_TEMPLATES_2026-11-23.md), [`template index`](../supabase/templates/dna-os-auth-v1/template-index.json)
- Provider logo use: [`DNA OS Brand Standard`](brand/DNA_OS_BRAND_STANDARD.md)
- Provider setup references: [Supabase Google login](https://supabase.com/docs/guides/auth/social-sign-in/auth-google) — Google Console's authorized redirect URI is the Supabase project's callback; [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) — DNA OS `redirectTo` must separately match the project's allowlist; [Google Search indexing FAQ](https://developers.google.com/search/help/crawling-index-faq) — sitemap submission helps discovery but does not guarantee indexing; [Request Google recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl) — URL Inspection requires a verified Search Console owner/full user.
