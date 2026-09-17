# Canonical URL Policy — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy. Documentation only — no code, route, DNS, or config was changed to produce this document.

## Objective

Guarantee that every resource on this system is reachable through exactly one canonical URL, with every other variant (protocol, host, trailing slash, casing) resolving to it via redirect rather than serving duplicate, divergent content.

## Current state (verified, not assumed)

- The real production domain is `dnaos.co.th` (`registry/infrastructure.json`), not yet bound to the `dna-os-deadboard` Vercel project (see [`domain-migration-policy.md`](./domain-migration-policy.md)).
- Vercel's own platform already enforces one real canonicalization today: every preview/branch deployment URL (`dna-os-deadboard-*.vercel.app`) is distinct from the aliased production URL (`dna-os-deadboard.vercel.app`) — confirmed by this repo's own deploy history, where each `vercel --prod` run produces a new unique deployment URL that gets aliased to the same stable production URL. This is the existing canonical mechanism for the `*.vercel.app` host; it does not yet exist for `dnaos.co.th` because no custom domain is bound.
- No `next.config.ts` redirect/rewrite rule enforces trailing-slash or casing canonicalization today (verified by reading `next.config.ts`) — Next.js's own default behavior (no trailing slash) is the only canonicalization currently in effect.

## Proposed rules

**RULE — Exactly one canonical form per resource.** Once `dnaos.co.th` is bound (per `domain-migration-policy.md`), every one of these must redirect (HTTP 301/308) to the single canonical form, never serve content directly:
- `www.dnaos.co.th` → `dnaos.co.th` (or the reverse — the owner picks the canonical host once, per [`owner-approval-policy.md`](./owner-approval-policy.md), and it does not change without a recorded [`domain-migration-policy.md`](./domain-migration-policy.md) event)
- `http://` → `https://` (already enforced by Vercel's platform-level HTTPS redirect for any bound domain — verify, don't assume, once binding happens)
- Any remaining `*.vercel.app` alias → the canonical custom domain, once bound

**RULE — Canonical form is declared once, referenced everywhere.** The canonical host is a single source of truth (proposed: a `NEXT_PUBLIC_CANONICAL_URL` env var, already partially precedented by the existing `NEXT_PUBLIC_APP_URL` used in `gateway/connectors.ts` for OAuth redirect URIs) — not hardcoded separately in each place a full URL is constructed (LIFF endpoint config, OAuth redirect URIs, sitemap/meta tags if added later).

## Validation Checklist

- [ ] Every non-canonical host/protocol variant returns a redirect, not a 200
- [ ] No two variants of the same URL (with/without trailing slash, with/without `www`) both return distinct 200 responses
- [ ] `gateway/connectors.ts`'s OAuth `redirect_uri` construction and any future LIFF/webhook URL construction reference the one canonical source, not a hardcoded string

## Failure Conditions

- Search engines or LINE's link-preview crawler index two different hosts for the same content (duplicate-content risk)
- An OAuth or webhook registration is configured against a non-canonical host and breaks silently when that host's redirect behavior changes

## Recovery Procedure

1. Add the missing redirect rule at the platform (Vercel domain settings) or `next.config.ts` level.
2. Audit every external registration (LINE Developers console, any OAuth app config) against the canonical host; fix any pointing at a non-canonical variant.
