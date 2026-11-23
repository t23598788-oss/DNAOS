<p><img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.svg" alt="DNA OS" width="148" height="60"></p>

# Cloudflare traffic audit — 2026-11-23

**Observed:** 2026-11-23 19:23 Bangkok time
**Window:** Cloudflare Analytics, previous 24 hours
**Zone:** `dnaos.dev`
**Method:** read-only Cloudflare Dashboard inspection in the owner's signed-in Chrome session. DNS, Worker routes, scripts, and security settings were not changed.

## Traffic summary

| Metric | Observed | Reading |
|---|---:|---|
| Requests | 2.25k | Up 13.0% versus the previous period. |
| Data transferred | 12.96 MB | Up 280.8%. |
| Unique visitors | 167 | Dashboard estimate. |
| Desktop requests | 2.06k | About 91.6% of requests; mobile was 198. |
| HTTP 2xx | 560 | Includes 200 (389), 202 (10), and 204 (161). |
| HTTP 3xx | 260 | Includes 301 (169) and 304 (91). |
| HTTP 4xx | 1.43k | Mostly 404s; not a server outage by itself. |
| HTTP 404 | 1.31k | About 58.2% of all requests. |
| HTTP 5xx | 0 | Cloudflare showed a 0.00% 5xx error rate. |
| Cache hit ratio | 8.30% | Most requests were dynamic or not served from cache. |

The high desktop count is real, but the failures are mostly client-facing 404 responses. There were no 5xx responses in this dashboard window, so this snapshot does not indicate that the Worker or origin was down. The analytics summary alone does not identify whether each 404 was produced by a Worker, an origin, or a missing host/path route.

## Hosts and failed paths

Filtering Analytics to edge status 404 showed 1.31k requests. The top hosts were:

| Host | 404 requests | Evidence |
|---|---:|---|
| `dnaos.dev` | 1.03k | Apex is routed to the homepage and auth Workers only for declared paths. Unrecognized paths can still 404. |
| `www.dnaos.dev` | 282 | No `www` Worker route is present in the active route table. Earlier direct checks also found `www` root and `/login` returning 404 rather than redirecting to apex. |

Top paths within all 404s included:

| Path | Count | Interpretation |
|---|---:|---|
| `/sw.js` | 99 | A service-worker source and registration call exist (`public/sw.js`, `components/pwa/PwaRegistration.tsx`), but the live URL returned 404 and had no Worker route. The source asset was missing from the homepage Worker bundle. |
| `/` | 42 | This is within 404s across hosts; the filtered `www` view had 21 root requests. Apex `/` has an active route. |
| `/assets/dnaos-internal-rectangular-stamp.png` | 13 | Missing/stale asset path in the requests. |
| `/nuxt/.env` | 12 | Looks like an automated environment-file probe. Cloudflare recorded it as 404. |
| `/admin/dashboard` | 12 | Looks like an automated admin-path probe. Cloudflare recorded it as 404. |
| `/.env.bak` | 11 | Looks like an automated environment-file probe. Cloudflare recorded it as 404. |
| `/.env.production` | 10 | Looks like an automated environment-file probe. Cloudflare recorded it as 404. |
| `/assets/dnaos-stamp-usage-reference.png` | 10 | Missing/stale asset path in the requests. |
| `/login` | 10 | Analytics aggregates all hosts; the `www` host has no login route. Apex `/login` is attached to the auth Worker. |

For `www.dnaos.dev` + 404, Cloudflare showed 282 requests: Sweden 166, Thailand 55, Netherlands 47, and United States 10. One client IP accounted for 166 requests. The country and IP concentration, plus environment-file/admin probes, are consistent with automated scanning, but an IP or user-agent alone does not prove who operated it. In that same `www` filter, the listed paths included `/` (21), the two old stamp image paths (20 combined), `/sw.js` (7), `/.env.stage` (5), `/campaign/.env` (4), and `/.git/config` (4). All were counted as 404s; the dashboard view did not reveal response bodies.

Across all 404s, Cloudflare categorized 1.14k as dynamic, 176 as bypass, and 2 as no cache status. This explains why a high request count can coexist with low cache-hit ratio; it does not mean 1.14k distinct human visits.

## Active Worker routes observed

Cloudflare Workers Routes listed these nine route attachments on the apex zone:

| Route | Worker |
|---|---|
| `dnaos.dev/` | `dnaos-homepage` |
| `dnaos.dev/assets/*` | `dnaos-homepage` |
| `dnaos.dev/login` | `dnaos-auth-entry` |
| `dnaos.dev/start` | `dnaos-auth-entry` |
| `dnaos.dev/v1/auth/*` | `dnaos-auth-entry` |
| `dnaos.dev/system-map` | `dnaos-homepage` |
| `dnaos.dev/system-map.json` | `dnaos-homepage` |
| `dnaos.dev/system-map.md` | `dnaos-homepage` |
| `dnaos.dev/system-map-ai.zip` | `dnaos-homepage` |

No route for `www.dnaos.dev/*` or `dnaos.dev/sw.js` appeared. The four system-map routes are attached in production; this branch had omitted their declarations and static files, although the production-pinned source revision contains them. `/sw.js` is a separate missing route and asset. The route table confirms path attachment, not source revision or request-level ownership of each 404.

## What to fix, in order

1. **Align homepage source with current production paths.** Restore the production-pinned system-map files and route declarations so an ordinary homepage release does not drop them.
2. **Restore `/sw.js`.** Bundle the existing worker source unchanged and route the registered URL through the homepage Worker. This fixes the concrete PWA 404 without changing its cache behavior.
3. **Normalize `www`.** A `www` → apex 308 redirect preserving path and query is prepared locally. It needs a `www.dnaos.dev/*` Worker route in Cloudflare; DNS stays unchanged. This has not been deployed.
4. **Keep scanner requests fail-closed.** The listed `/.env*`, `/.git/*`, `/nuxt/.env`, and `/admin/dashboard` probes received 404s. Do not expose files or create placeholder admin routes to make these requests succeed. Review Security Events/WAF only if the volume or request pattern continues to affect service.
5. **Leave unknown legacy stamp URLs unresolved until identified.** The two observed image paths are not present in repository history; they remain 404 rather than being redirected to an assumed replacement. Current canonical brand assets are under `/assets/brand/dna-os/v1/`.

Source reconciliation is prepared locally. The `www`, `/sw.js`, and restored system-map route changes still need a reviewed Cloudflare Worker release. No production change has been applied as part of this follow-up.

## Evidence boundary

Cloudflare Analytics is aggregate request data for the selected 24-hour window. It does not prove user intent, page rendering success, session completion, or the identity behind a client IP. A 404 on a guessed secret-file path is evidence that Cloudflare reported Not Found for that request, not a complete security audit of every deployment or response body. The 0.00% 5xx figure is limited to the same Analytics window and zone view.

