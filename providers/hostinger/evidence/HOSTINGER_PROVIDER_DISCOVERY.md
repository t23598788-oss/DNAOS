# Hostinger Provider Discovery — Evidence

Discovery date: 2026-08-22. Fetched via direct WebFetch/WebSearch against official Hostinger, GitHub, and nexos.ai sources. No API token created, nothing deployed. This file is the evidence base every fact in `../definition/*.json` and `../sources/source-map.ts` must trace back to — never hand-invent a field there that isn't backed by a line here.

## MCP server (VERIFIED)

- Source: `https://raw.githubusercontent.com/hostinger/api-mcp-server/main/README.md` (full 4,243-line README fetched directly).
- Package: `hostinger-api-mcp` (npm), repo `hostinger/api-mcp-server`, Node.js >= 24.
- Transport: stdio (default, local) or Streamable HTTP (`--http`, local or Hostinger-hosted at `https://mcp.hostinger.com`).
- Auth: `HOSTINGER_API_TOKEN` env var (bearer, bypasses OAuth) OR OAuth 2.0 + PKCE (`OAUTH_ISSUER` default `https://auth.hostinger.com`), credentials cached at `~/.config/hostinger-mcp/credentials.json` (mode 0600). "OAuth sign-in is not supported in `--http` mode."
- Tool inventory: 365 tools total across 12 scoped binaries (`hostinger-vps-mcp`=62, `hostinger-hosting-mcp`=56, `hostinger-mail-mcp`=38, `hostinger-domains-mcp`=40, `hostinger-wordpress-mcp`=38, `hostinger-reach-mcp`=45, `hostinger-agency-hosting-mcp`=38, `hostinger-ecommerce-mcp`=29, `hostinger-billing-mcp`=9, `hostinger-dns-mcp`=8, `hostinger-horizons-mcp`=2). Confirmed by direct enumeration: zero tool names/descriptions/paths contain "gpu" anywhere in the README.
- Client config: Claude Code has an explicit command (`claude mcp add --transport http hostinger https://mcp.hostinger.com`) plus a generic JSON block usable by VS Code/Cursor/Devin (`command: "hostinger-api-mcp"`, env `HOSTINGER_API_TOKEN`). Codex and Antigravity have **no dedicated config block** in the README — UNKNOWN, not registered as a source pointer.

## API reference (PARTIAL)

- Canonical reference lives at `https://developers.hostinger.com/` (per search-result synthesis and the MCP README's own reference to it) — auto-generated from OpenAPI, includes interactive testing and OpenAPI spec download. Direct WebFetch of this URL returned `maxContentLength size of 10485760 exceeded` (page is JS-rendered/interactive, too large to render via simple fetch) — content NOT independently verified beyond the search-snippet level. Registered as a source pointer with `verification_state: PARTIAL`.
- Token creation flow (VERIFIED via direct fetch of `https://www.hostinger.com/support/10840865-what-is-hostinger-api/`): hPanel -> Dev Tools -> API -> Generate Token; name + expiration date required; token shown once. Scopes, read-only tokens, resource-limiting, and revocation flow: **UNKNOWN**, not documented in this source.
- Representative REST endpoints confirmed via the MCP README's own tool-to-path documentation (sample, not exhaustive): `GET /api/vps/v1/virtual-machines`, `GET /api/vps/v1/virtual-machines/{virtualMachineId}`, `POST /api/vps/v1/virtual-machines`.

## GPU infrastructure (VERIFIED absence of API/MCP surface)

- Source: direct fetch of `https://www.hostinger.com/support/how-to-manage-your-gpu-instance-at-hostinger/` and `https://www.hostinger.com/support/how-to-set-up-a-gpu-instance-at-hostinger/`.
- Quote: "Unlike VPS plans, which run on a monthly contract, GPU instances are billed hourly on an on-demand basis using your account credits." GPU instances are explicitly **not** VPS.
- Quote: "Interface: Setup occurs exclusively through hPanel's dashboard. No API or CLI alternative is mentioned."
- Monitoring described (hPanel-only): GPU compute throughput, VRAM usage, spend, region, OS, IP, service exposure (ports/protocols). No start/stop/restart/delete/resize operations documented anywhere for GPU, not even hPanel-side.
- Cross-checked against the MCP README: zero GPU-named tools exist in the 365-tool inventory.
- Conclusion: GPU is a real, registerable **product/source pointer** (documentation exists, is official, and is monitorable for change) but has **no confirmed API or MCP capability_scope** as of this discovery date.

## nexos.ai / AI Router (PARTIAL — separate product)

- Source: search-result synthesis of `https://nexos.ai/features/api/` (direct WebFetch returned HTTP 403 — not independently re-verified beyond snippet) and direct fetch of `https://www.hostinger.com/support/how-to-use-nexos-ai-with-n8n-on-hostinger-vps/` (confirms "nexos.ai provides an OpenAI-compatible gateway API" — this specific quote IS directly verified).
- nexos.ai is a distinct product/domain (`nexos.ai`, docs at `docs.nexos.ai`) from `developers.hostinger.com` / `api-mcp-server` — a partner integration Hostinger uses (e.g. Hostinger Horizons, OpenClaw credits), not a Hostinger-native API surface.

## n8n integration (VERIFIED existence, generic mechanism)

- Source: search-result synthesis of `https://www.hostinger.com/tutorials/how-to-use-n8n-with-mcp/` and `https://www.hostinger.com/support/how-to-use-nexos-ai-with-n8n-on-hostinger-vps/`.
- n8n's MCP Client Tool / MCP Server Trigger nodes are n8n's own generic MCP feature, usable to reach `mcp.hostinger.com`; nexos.ai is reachable from n8n as an OpenAI-compatible credential.

## Destructive-operation naming (VERIFIED, from direct README enumeration)

Tool-name pattern grep across the full README confirms destructive-shaped VPS/DNS/billing tools exist: `VPS_deleteProjectV1`, `VPS_deleteFirewallV1`, `VPS_deleteSnapshotV1`, `VPS_recreateVirtualMachineV1`, `VPS_resetHostnameV1`, `DNS_deleteDNSRecordsV1`, `DNS_resetDNSRecordsV1`, `billing_deletePaymentMethodV1`. Two Agency Hosting deploy tools carry an explicit LLM-facing instruction: "always confirm with the user before proceeding."

## Full raw evidence

Full raw README (4,243 lines) was fetched to a scratch path outside this repo during the prior discovery task (session-scoped, not committed) — this file captures every fact from it that is used downstream; the raw text itself is intentionally not persisted here (see `../README.md`'s transient-data rule).
