<img src="https://dnaos.dev/assets/brand/dna-os/v1/dna-os-horizontal-mono.png" alt="DNA OS" width="148" />

# DNA OS public system and integration map

Generated at: 2026-11-23T06:33:23.113Z
Source revision: 6d966e6074523ff521c7afb33c725a27b0b8e2b2 (working tree contained uncommitted changes at generation)

## Production services
- **dnaos-homepage** — Cloudflare Worker; https://dnaos.dev/, https://dnaos.dev/assets/*, https://dnaos.dev/system-map, https://dnaos.dev/system-map.json, https://dnaos.dev/system-map.md. Source: [workers/landing-entry/index.ts](https://github.com/t23598788-oss/DNAOS/blob/6d966e6074523ff521c7afb33c725a27b0b8e2b2/workers/landing-entry/index.ts).
- **dnaos-auth-entry** — Cloudflare Worker; https://dnaos.dev/login, https://dnaos.dev/start, https://dnaos.dev/v1/auth/*. Source: [workers/auth-entry/index.ts](https://github.com/t23598788-oss/DNAOS/blob/6d966e6074523ff521c7afb33c725a27b0b8e2b2/workers/auth-entry/index.ts).
- **dnaos-business-onboarding** — shared source imported by auth Worker; not_a_separately_deployed_worker_per_2026_11_23_inspection. Source: [workers/business-onboarding/index.ts](https://github.com/t23598788-oss/DNAOS/blob/6d966e6074523ff521c7afb33c725a27b0b8e2b2/workers/business-onboarding/index.ts).

## Connection pipeline
1. provider webhook or poll
2. signature/authentication boundary
3. provider adapter normalization
4. canonical Gateway event bus
5. scoped authorized consumer

Gateway adapters in source: github (webhook: repository, branch, commit, pull_request, workflow_run); supabase (poll: health, migration_state); vercel (webhook: deployment); railway (webhook: deployment); line (webhook: message, document, location, identity_signal, interaction); facebook (webhook: message, document, interaction); instagram (webhook: message, document, interaction).
Connect contracts in source: railway, github, line, meta. A registered contract does not prove a live account is connected.

## Database and compute
Supabase migration objects in the provenance ledger: table system.development_lineages, table system.development_events, function system.assign_development_event_sequence, function system.reject_development_event_mutation, function public.record_development_event, function public.read_development_history, function system.development_release_readiness, table system.development_change_sets, table system.development_change_files, table system.development_event_change_sets, table system.development_change_set_approvals, function public.register_development_change_set, function public.read_development_change_set_for_approval, function public.approve_development_change_set, function public.link_development_event_to_change_set, function public.read_development_change_sets, function public.read_public_development_change_sets, function system.development_release_readiness.
Production Supabase migration evidence (observed 2026-11-23): project xeytcavxejhyzxwevgto; 20261123000002 was applied with SQL SHA-256 90c00c5459d461b73ac95185c4b8992bf722b78af8909d53a147910fd6ce3ebd; 20261123000001 history was reconciled after existing objects were verified. Older remote migration versions diverge from this checkout, and no bulk migration push was run. Evidence: [docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md](https://github.com/t23598788-oss/DNAOS/blob/6d966e6074523ff521c7afb33c725a27b0b8e2b2/docs/PRODUCTION_RELEASE_READINESS_2026-11-23.md).
Registered compute resources: 0. Live instance status is not claimed unless recorded and freshly verified.

## Evidence limits
Deployment IDs are dated observations from the cited service map and may predate this source revision. The public JSON lists paths and SHA-256 hashes only; it excludes secrets, customer data, financial payloads, and private account identifiers.

Machine-readable version: [system-map.json](/system-map.json)
Brand kit: [manifest](https://dnaos.dev/assets/brand/dna-os/v1/brand-assets.json) · [usage notes](https://dnaos.dev/assets/brand/dna-os/v1/README.md)
