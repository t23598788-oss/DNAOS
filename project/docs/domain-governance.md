# Domain Governance — Proposal

**STATUS: ARCHITECTURE_APPROVAL_PENDING.** Part of the [production-governance](./production-governance.md) proposal set. Not adopted policy.

## Current state (verified, not assumed)

**Correction from this document's first draft**: a domain is not fully undecided — `registry/infrastructure.json` records a real, already-registered domain:

| Field | Value |
|---|---|
| Domain | `dnaos.co.th` |
| Status | active |
| Owner | เฮีย |
| Cost | 50 THB/month, Annual plan |
| Renewal | **manual** (no auto-renew recorded) |
| Expiration | 2026-09-08 |
| If down | "เข้าเว็บด้วยชื่อไม่ได้ ต้องใช้ IP" (site unreachable by name) |

What's genuinely still open: whether `dnaos.co.th` is *bound to this Vercel project* (`dna-os-deadboard`, `prj_G1Fz2gKa4fOR5SCbzmtnXbpBapF6`). `.vercel/project.json` shows no custom domain on the local project link, and `engines/domains/vercel-binding.ts` exists specifically to attach/verify/remove a custom domain on this project — its existence as unused-so-far tooling is consistent with `STATE=PRE_DOMAIN_FREEZE`: the domain exists, the binding to *this* production app does not yet.

**Operational risk found while verifying this (not invented for this document)**: renewal is manual with no auto-renew on record and expires 2026-09-08. If nothing else changes this, the domain lapses on that date regardless of any policy adopted here. This is worth the owner's attention independent of this governance proposal.

The system already has real domain-management tooling built and ready, gated behind admin auth (`app/api/admin/domains/*` → `engines/domains/{hostinger.ts,cloudflare.ts,vercel-binding.ts}`):
- `hostinger.ts` — suggestions, availability, whois, registration (registration already follows the preview→confirmed-token→execute pattern, `app/api/admin/domains/register/route.ts`, citing "Rule 72: Real money, irreversible")
- `cloudflare.ts` — DNS zone/record management, gated behind the Connector Lifecycle Law (must be Connected→Registered→Tested→Enabled first, no exceptions)
- `vercel-binding.ts` — attach/verify/remove the custom domain on this specific Vercel project

This means a domain-migration or first-binding action, when it happens, has real machinery to route through — see [domain-migration-policy.md](./domain-migration-policy.md) for how this document proposes governing its use.

## Proposed rules

**RULE — Primary domain, once declared, is immutable without an explicit owner-approved migration.**
Once the owner designates a primary production domain, changing it is not a routine deploy action. It requires:
- A written migration record (who, when, why, old → new)
- The `deployment-contract.md` "domain migration" path, not a silent Vercel dashboard change
- Zero-breaking-change handling per `route-lifecycle.md` (old domain keeps resolving via redirect for a defined window, not a hard cutover)

**RULE — Public URLs (domain + path) are the contract with real users, not an implementation detail.**
Once a route is published (see `route-lifecycle.md` for what "published" means in this repo), its full URL is treated as an external API surface — LINE LIFF callback URLs, partner bookmarks, and any inbound webhook registration (Supabase Edge Functions, LINE Messaging API webhook URL) all depend on the domain staying stable. A domain change silently breaks those unless each external registration is updated in lockstep.

## Open question this document does not resolve

What the primary domain actually will be, and when it gets connected, is unresolved and out of scope for this proposal — that is an owner decision, not an architecture question. This document only says: *whatever gets decided, treat it as immutable from that point forward, with a defined migration path if it ever has to change.*
