# TikTok Public OAuth Support — Deployment Report

Work order: OWNER DECISION "APPROVE PUBLIC OAUTH SUPPORT DEPLOYMENT" (2026-09-01)

## Phase 1 — Resolve existing public host (Registry first)

Discovered from canonical registry (no filename guessing):

| Candidate | Source of truth | Deploy path | Verdict |
|-----------|-----------------|-------------|---------|
| Railway `dna-os-infrastructure` (env 4d28eafa…) | provider-project-registry; connection-declaration (DEPLOYMENT_PLATFORM, OBSERVED); credential `credential://railway/dna-os-infrastructure/production/project-token` ACTIVE | connections/railway is **read-only by design** ("Never add write/deploy without separate Owner approval") | host exists, **no deploy capability** |
| Public Railway services | repo config: `dna-os-circuit-production.up.railway.app`, `joint-monitor-production.up.railway.app` | git-push (cross-repo, production) | not used (would touch production services) |
| **Supabase Edge** `xeytcavxejhyzxwevgto` ("D N A O S system", ACTIVE_HEALTHY) | `supabase projects list` (CLI authenticated); existing live function `functions/v1/provider-alert-email-read` | **supabase CLI 2.107 (authenticated) — REUSABLE deploy path** | **REUSE ✅** |

**PUBLIC_HOST_RESOLUTION = REUSE (Supabase Edge, Owner's own project).** Railway not touched.

## Phase 2 — Minimal public surface

Deployed one Edge Function `tiktok-oauth-support` (source: `supabase/functions/tiktok-oauth-support/index.ts`) serving only the surfaces TikTok requires:

- `GET /terms` — real DNA OS Terms of Service (private self-hosted system; accesses only the Owner's own authorized TikTok data; no third-party use)
- `GET /privacy` — real Privacy Policy (tokens in OS Keychain; registry holds reference only; no sale/sharing; revocable)
- `GET /callback` — receives TikTok's OAuth redirect and **relays** to the existing `connections/tiktok-authorization` lifecycle (token exchange happens locally where Keychain is; **no second OAuth implementation**, no token exchange in the Edge function)

Legal content is minimal-but-truthful; contact `dnaos.tech@gmail.com`. No fabricated company/data-collection/sharing claims.

## Phase 3 — Deploy + external verification

Deployed via `supabase functions deploy tiktok-oauth-support --project-ref xeytcavxejhyzxwevgto --no-verify-jwt` (no Docker needed).

External verification (real `curl` from outside):

| URL | HTTP | HTTPS | Content |
|-----|------|-------|---------|
| `…/tiktok-oauth-support/terms` | 200 | ✅ ssl ok | `<title>Terms of Service · DNA OS</title>` |
| `…/tiktok-oauth-support/privacy` | 200 | ✅ | `<title>Privacy Policy · DNA OS</title>` |
| `…/tiktok-oauth-support/callback` | 200 | ✅ | callback page; `?code=&state=` handled |

Base: `https://xeytcavxejhyzxwevgto.supabase.co/functions/v1/tiktok-oauth-support`

**PUBLIC_ENDPOINTS_PROVEN = YES** (verified externally, not by deploy-command exit code).

## Phase 4 — TikTok app configuration — BLOCKED (Owner using machine)

Reused app `7680187321018533896` ("Simple Inventory"), Draft. Opened App details; began filling. **Halted**: the Owner is actively using the same machine (System Settings / ChatGPT came to front; keystrokes collided). Browser form-filling cannot proceed safely while the Owner is on the machine.

Remaining config (ready to enter the moment the machine is free, or the Owner does it in the already-open browser):
- Terms of Service URL, Privacy Policy URL (now available)
- Platform = Web, Redirect URI = the `/callback` URL above
- Add Login Kit; scopes `user.info.basic`, `video.list` (READ only)
- **App icon** (1024×1024 upload) — native file dialog; likely an OWNER_ACTION
- Save → Submit for review (→ TikTok review, days)

## Secret rotation — pending (same machine-collision blocker)

The earlier-exposed `client_secret` is treated COMPROMISED. Rotation approved. Not yet done — requires the browser + credential-capture at the execution boundary (no screenshot/chat/log). Will capture the new secret directly into the secure store, returning only a `credential_reference`.

## Evidence states (kept separate — not promoted)

- `BROWSER_OBSERVED`: account identity + video list (from logged-in profile page) — recorded in `data/browser-observation.json`. **Not** promoted to API.
- `OAUTH_PROVEN`: not yet.
- `API_PROVEN`: not yet.

## Blockers / next

- `EXTERNAL_PROVIDER_BLOCKED` (later): TikTok Production review is required before real tokens — days.
- `OWNER_ACTION`: free the machine so DNA OS finishes app config + secret rotation, **or** the Owner fills the 4 fields + uploads an icon in the open browser; then Submit for review.
