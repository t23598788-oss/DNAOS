<img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.png" alt="DNA OS" width="148" />

# DNA OS API and connection reference

**Meta route and public guide status checked:** 2026-11-26 07:04 Asia/Bangkok
**Other endpoint observations:** see their individual dates in [api-status.json](/api-status.json).
**Status source:** [machine-readable endpoint status](/api-status.json) · [system map](/system-map.md)

## What is available now

The public site serves the sign-in page and the browser-oriented email OTP entry points. These authentication routes use a browser session and CSRF protection. They are not a general developer API and do not issue developer API keys.

| Method and path | Status | What the status means |
|---|---|---|
| `GET /login` | **Live** · 200 | Public sign-in screen |
| `GET /start` | **Live** · 200 | Sign-in entry alias |
| `GET /v1/auth/csrf` | **Live** · 200 | Send `Origin: https://dnaos.dev`; returns a CSRF token for the browser flow |
| `GET /v1/auth/session` | **Live** · 401 when signed out | Route responds; an anonymous request has no session |
| `POST /v1/auth/otp` | **Live, last verified 2026-11-23** · 202 | Prior production probe accepted a sign-in request and matching email delivery was observed; this audit did not send another email |
| `POST /v1/auth/verify` | **Configured; live completion unverified** | No real OTP was submitted during this audit |
| `POST /v1/auth/refresh` | **Configured; live completion unverified** | POST-only route; a GET returning 404 is not a valid route test |
| `POST /v1/auth/logout` | **Configured; live completion unverified** | POST-only route; a GET returning 404 is not a valid route test |
| `GET /auth/google` | **In Development** · 404 | Candidate code exists but is not deployed; Supabase Production reports Google provider disabled (checked 2026-11-24 08:50 Asia/Bangkok) |
| `GET /auth/confirm` | **In Development** · 404 | Candidate callback exists but is not deployed |
| `GET /workspace` | **In Development** · 404 | Candidate signed-in destination exists but is not deployed |

The exact status, observation time, and evidence limits are in [api-status.json](/api-status.json). A status of **Live** means the documented method and path responded; it does not mean every identity provider or authenticated workflow has passed end-to-end verification.

## Facebook Page / Messenger events

The receive-only Meta webhook is **In Development**. Production currently returns 404 for both `GET` verification and `POST` event delivery at `/api/gateway/observe/meta`; the Worker and event adapter exist in the release branch but are not deployed. This phase accepts signed Page webhook events, normalizes event metadata, and forwards them to the DNA OS observe gateway. It does not connect a customer's Page, retain message text, or send replies.

The installation guide explains Meta MCP administrator setup separately from the future customer Page connection flow: [Facebook Page / Messenger guide](/docs/integrations/facebook-messenger.md) · [Meta MCP and Page installation map](/docs/integrations/meta-mcp-and-facebook-page-installation.md).

## Developer API boundary

The current public reference does **not** publish a general-purpose developer API contract, API-key self-service flow, quota/rate-limit policy, sandbox, or browser playground. Do not build an integration against an assumed endpoint or send business data to the sign-in routes. Those items must be designed and verified before being labelled Live.

## Integrations and hosting references

LINE, n8n, Railway, and Vercel names in the source map refer to source-level adapters or registry entries. They do not prove that a public endpoint or provider account is connected. This reference does not provide a live LINE/n8n webhook contract. Provider-specific documentation should be published only after the route, authentication/signature rules, example payload, and response have been verified against the deployed service.

The Meta guides linked above describe the candidate route and mark its current production status explicitly; they are not a claim that the endpoint is live.

## Search and AI crawlers

The current `robots.txt` permits the general Googlebot through `User-agent: *` and `Allow: /`, while explicit rules disallow Google-Extended, GoogleOther, Google-CloudVertexBot, and Google-Agent. Google Search crawling and Gemini/Vertex AI access are separate controls; publishing `llms.txt` does not override `robots.txt`. The current `/sitemap.xml` path returns 404. The candidate does not alter crawler permissions. See [Google's crawler reference](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) before changing those controls.

## Change evidence

Production HTTP observations are dated snapshots. Source configuration, a GitHub commit, or a database migration record alone does not prove that a public route is live. The release history should separately record the commit, checks, provider/configuration verification, deployment, and live route response. See the [sign-in route and release audit](https://github.com/t23598788-oss/DNAOS/blob/main/docs/DNA_OS_AUTH_ROUTE_MAP_2026-11-23.md) and [development provenance guide](https://github.com/t23598788-oss/DNAOS/blob/main/docs/DEVELOPMENT_PROVENANCE_LEDGER.md).
