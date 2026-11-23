<p><img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.svg" alt="DNA OS" width="148" height="60"></p>

# DNA OS sign-in route map

**Snapshot:** 2026-11-23 18:58 Bangkok time  
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
| Google / Apple / Facebook / LINE / TikTok | External identity providers via Supabase Auth | Intended provider → Supabase → DNA OS callback | Current Worker UI does not start OAuth; provider tiles are illustrative. The legacy app source had Google, Apple and Azure OAuth, but this is not evidence of current production provider configuration. | For each desired provider: verify official authorization, configure credentials and callback allowlist, implement a real click/start action, then test return to the same account. Add external-provider logos only from approved official assets with source and permission recorded. |
| OAuth callback and session handoff | DNA OS auth application | `app/auth/confirm/route.ts` | Callback code exists in source and handles OAuth PKCE exchange plus OTP verification. Production `GET /auth/confirm` returns 404; `/auth/verify` also returns 404. Auth Worker has no such route. | Expose the canonical callback on the production host or add a safe allowlisted callback route in the auth Worker; preserve one-time code verification, safe internal `next`, and one-account session issuance. |
| Session memory | Worker auth cookies / Supabase Auth | `workers/business-onboarding/index.ts` | Source sets access cookie up to 1 hour and refresh cookie to 30 days; refresh endpoint rotates the pair. This supports returning sessions while cookies remain valid. Browser/device persistence is not proven by an unauthenticated HTTP probe. | Verify cookie attributes and real browser refresh behavior; add device/passkey only as a separate follow-up after this core route is complete. |
| Auth email | Supabase Auth → Custom SMTP → Resend | [`AUTH_EMAIL_TEMPLATES`](AUTH_EMAIL_TEMPLATES_2026-11-23.md), template package and index | The configured path and sender are recorded. The 13-template source package exists; all production Dashboard templates have not been verified. | Reconcile all 13 templates in Supabase Dashboard and run one controlled OTP delivery/return flow. |
| DNA OS identity artwork | Static assets on `dnaos.dev` | [`brand asset index`](https://dnaos.dev/assets/brand/dna-os/v1/brand-assets.json) | Production index and monochrome SVG return 200. `/brand/dna-os-mark-d.png` returns 404, while the documented distribution route `/assets/brand/dna-os/v1/` works. | Change login asset references to a production-served canonical path or add the assets to the auth Worker. Do not substitute DNA OS art for provider marks. |
| Website navigation | Cloudflare homepage Worker `dnaos-homepage` | `/` and `/assets/*`; source `workers/landing-entry/wrangler.jsonc` | Source routes the home page and static assets separately from `dnaos-auth-entry`. | Ensure the landing page's sign-in button points to `https://dnaos.dev/login`; verify the destination after publishing. |

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

## Finish order for the sign-in route

1. Point the sign-in UI and its logo to production-served files; make the landing page button lead to `/login`.
2. Close the callback gap: route `/auth/confirm` to the canonical verifier, including OAuth PKCE exchange and safe return routing.
3. Confirm Supabase Site URL, redirect allowlist, email OTP settings, and each enabled OAuth provider in the live project.
4. Make each visible provider button start the matching OAuth flow. Keep unconfigured providers visibly unavailable instead of implying a working login.
5. Verify one email OTP sign-in and one approved OAuth sign-in in a browser, including session restoration after refresh and correct return page.
6. Publish the auth Worker and confirm production `/login`, callback, session and asset paths against this map. Record deployment ID and time in the next change event.

At this snapshot, do not label Google, Apple, Facebook, LINE, TikTok or device biometrics as production-connected. Their dashboard setup and end-to-end callbacks have not been verified. Email OTP is the only documented/current route to finish first.

## Sources

- Cloudflare route declarations: [`workers/auth-entry/cloudflare.config.ts`](../workers/auth-entry/cloudflare.config.ts), [`workers/landing-entry/wrangler.jsonc`](../workers/landing-entry/wrangler.jsonc)
- Auth allowlist and gateway implementation: [`workers/auth-entry/index.ts`](../workers/auth-entry/index.ts), [`workers/business-onboarding/index.ts`](../workers/business-onboarding/index.ts)
- OAuth callback source: [`app/auth/confirm/route.ts`](../app/auth/confirm/route.ts)
- Email delivery and template boundary: [`Auth email guide`](AUTH_EMAIL_TEMPLATES_2026-11-23.md), [`template index`](../supabase/templates/dna-os-auth-v1/template-index.json)
- Provider logo use: [`DNA OS Brand Standard`](brand/DNA_OS_BRAND_STANDARD.md)
- Provider setup references: [Supabase Auth sessions](https://supabase.com/docs/guides/auth/sessions), [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Google OAuth redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server)
