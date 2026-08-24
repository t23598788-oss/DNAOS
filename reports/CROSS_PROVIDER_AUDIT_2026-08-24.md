# Cross-Provider Capability Audit — 2026-08-24

**Owner's axis (verbatim intent):** audit what DNA OS already owns, pays for, authenticates to, or actively uses before researching anything new; discover each provider's complete official capability surface; map against the Persistent Software Registry; pass every discovered capability through Duplicate Gate; register evidence-backed capabilities and integration pointers; flag overlaps; implement nothing.

This is not a new methodology — it's the exact pipeline `providers/hostinger/` and `providers/digitalocean/` already prove live: Candidate → Validation → Classification → Duplicate Resolution → Registration Decision → Repository Resolution → Registry Writer → `software/registry-database/` (the real Persistent Software Registry). This round applies it to six providers that ground-truth (`.env.local` credentials, real call sites) confirmed DNA OS already pays for/authenticates to but that pipeline had never touched.

## Ground truth (before research) — real credentials vs. registration status

| Provider | Credential confirmed in `dna-os-deadboard/.env.local` | `connections/` folder | `providers/` (registry) |
|---|---|---|---|
| Supabase | ✅ (URL, anon key, service role, mgmt token) | `NOT_YET_BUILT` | none — **audited, found correct-as-designed** |
| Vercel | ✅ (deploy creds implied, webhooks/drains wired) | `NOT_YET_BUILT` ×3 | none — **registered as reference-implementation pointer** |
| AI providers (Anthropic/OpenAI/Gemini) | ✅ (`OPENAI_API_KEY`, `GEMINI_API_KEY`; Anthropic via `services/ai/gateway.ts`) | `NOT_YET_BUILT` | none — **Gemini registered, OpenAI deliberately not (dead credential)** |
| GitHub | ✅ | `BUILT` (narrow) | none — out of scope this round |
| DigitalOcean | ✅ | `BUILT` | `BUILT` (the template) |
| RunPod | ✅ (`RUNPOD_API_KEY`, live MCP tools) | missing entirely | none — **registered** |
| LINE | ✅ (channel token, LIFF) | missing entirely | none — **registered** |
| Gmail | ✅ (OAuth client/secret/refresh) | missing entirely | none — **registered** |
| Railway | ❌ no credential | `router-invoker.ts` only, no README | none — likely dead code, not audited further |
| Hostinger | n/a (no credential needed) | n/a | `BUILT` (the precedent) |

## Findings, per provider

### RunPod
Official surface (source: `https://api.runpod.io/v2/openapi.json`): Pods, Serverless, Templates, Network Volumes, Registries, Catalog, Billing, Clusters, Account — 9 categories.
Real usage: **1 endpoint** (`GET /v2/catalog/gpus/{id}`), via a real, already-working, credentialed adapter chain in **DNA-LAB-PERMISSION-REASONER**: `dna_os/ingress/runpod_adapter.py` → `dna_os/connectors/runpod_connector.py` → `dna_os/credentials/vault.py` (resolves `RUNPOD_API_KEY`) → `dna_os/ingress/registry.py`. Not a gap in the sense of "nothing exists" — the adapter is real and live, just unregistered in DNA-OS-INFRASTRUCTURE's registry.
**Registered**: `resource-b7168e56-345f-47fe-94c3-ce36c4d66f43`, `resource_type=CONNECTOR`.

### LINE
Official surface (source: `developers.line.biz`): Messaging API (reply/push/multicast/narrowcast/broadcast, rich menus, Flex, quick replies, content retrieval, profile, group ops, webhooks, account linking, beacon, quota analytics), LINE Login, LIFF SDK.
Real usage: extensive — webhook+signature verify, push/reply, Flex messages, quick replies, content retrieval, profile fetch (cached+queued), rich-menu link/unlink (menu itself never created — `lifecycle.rich_menu: DISABLED`), LIFF add-friend flow, owner-command channel. Confirmed live via a real `GET /v2/bot/info` verification recorded in `registry/communication/line.registry.json`.
Never touched: multicast, narrowcast, broadcast, account linking, beacon, LINE Login, LIFF's richer client SDK, quota analytics.
**Registered**: `resource-3c04a980-8951-4410-bf6c-a133a3d18c55`, `resource_type=CONNECTOR`. Flagged as DNA OS's most business-critical external channel currently bypassing the fail-closed authorization pattern `connections/digitalocean/`/`connections/github/` already enforce.

### Gmail
Official surface (source: Google's Gmail API reference): ~30+ methods across 12 resource groups (messages, drafts, threads, labels, history, settings, delegates, filters, forwarding, send-as, CSE).
Real usage: **2 read-only methods** (`messages.list`/`.get`), `gmail.readonly` scope only, powering 2 Supabase Edge cron functions (bank/subscription email sync) via a shared client helper.
**Duplicate-authority flag (unresolved, noted only):** a second, structurally independent Gmail identity exists in this same environment — this session's own `claude.ai Gmail` MCP connector (the user's personal OAuth, much broader scope including send/draft/label/trash) — separate credential, separate identity, same provider.
**Registered**: `resource-8a42e397-78fc-4a8b-953f-d125b4d43769`, `resource_type=CONNECTOR`.

### Supabase — audited, no gap found
Full platform surface confirmed (DB, Auth, Storage, Realtime, Edge Functions, Management API, pgvector, Cron, Queues). dna-os-deadboard's usage is extensive and already correctly self-contained, including Management API self-monitoring (`app/api/cron/supabase-project-status/route.ts`, `providers/supabase/provider.json`, `scripts/register-known-connectors.ts`). `connections/supabase/`'s `NOT_YET_BUILT`, external-destination-only scope is **correct-as-designed** per the root README's explicit boundary rule ("Operational still queries its own Supabase directly, that's its own data") — not a gap. **Not registered as a new candidate** — nothing new to point at.

### Vercel
3 existing folders (`connections/vercel/`, `-webhooks/`, `-drains/`) are all `NOT_YET_BUILT` (planning docs only, zero source files) — but dna-os-deadboard already has **real, working** Vercel code: domain add/verify/remove (`engines/domains/vercel-binding.ts`), HMAC-verified webhook ingress (`engines/integration-gateway/adapters/vercel.ts`), CLI-based deploy status (`program-graph/connectors/vercelStatus.ts`). The 3 folders' scope split (outbound vs. two inbound streams) is coherent, not overlapping. `vercel-drains` has zero real usage anywhere.
**Registered as a reference-implementation pointer** (not a new connector claim, since the 3 folders' intent already exists): `resource-6cd6e043-58a9-4fee-890b-c90d03900952`, `resource_type=SOURCE_REFERENCE`, so future work on those 3 folders reuses proven patterns instead of reinventing them.

### AI providers
- **Anthropic**: real, live, complete via `services/ai/gateway.ts`'s `CAPABILITY_PROVIDER` table — no gap.
- **OpenAI**: `OPENAI_API_KEY` is a **dead credential** — the codebase's own comment confirms it ("zero real OpenAI SDK/call code exists anywhere in this repo"). Deliberately **not registered** — there is no real capability to point at.
- **Gemini**: real, working calls exist (`generativelanguage.googleapis.com generateContent`) in a Supabase Edge Function (Deno secret store) and a read-only IDE research adapter — but split across two runtimes/secret stores, and dna-os-deadboard's own `.env.local` `GEMINI_API_KEY` is an empty string. The one real, defensible gap.
**Registered**: `resource-924c4bf4-b2cc-46a6-b1e8-6ae89154717b`, `resource_type=SOURCE_REFERENCE`, `source_system=gemini`.

### Telemetry — semantic duplicate, cross-repo
DNA-OS-INFRASTRUCTURE's device-telemetry (`connections/telemetry/collector.ts`) is already registered in the Persistent Software Registry (`capability-448891d2-a02e-4dc3-8910-728985695580`, real consumer `dna-os-circuit/runtime/server.ts` at `/gateway/dna_telemetry`). DNA-LAB-PERMISSION-REASONER independently built its own local-machine CPU/RAM/network collector (`research/dashboard/api/local_telemetry.py` + `telemetry_sampler.py`), feeding the Lab UI's own § Local Machine section. Same measurement domain, same physical host, zero shared code, never reconciled — a real `DUPLICATE_SEMANTIC` candidate under the pipeline's own closed vocabulary (`UNIQUE | DUPLICATE_EXACT | DUPLICATE_SEMANTIC | UNRESOLVED_DUPLICATE`), but the pipeline's automated fingerprint matching is an exact normalized-field hash and will not catch two independently-written implementations of the same real-world measurement.
**Registered**: `resource-0eacfb15-5b8f-4cf9-a364-e2df5d7582da`, `resource_type=TELEMETRY_REFERENCE`. **Real limitation surfaced**: `software/registry-database`'s `RelationshipKind` vocabulary (`FILE_TO_MODULE`, `MODULE_TO_CAPABILITY`, `CAPABILITY_TO_{WORKER,API,TEST,DEPENDENCY,OWNER}`, plus 6 fixed AI_INGRESS system-component kinds) has **no relationship kind for flagging two already-registered capabilities as duplicates of each other** — only `kind:"capability"` candidates may carry `relationships` at all, and even then only for structural graph edges, not duplicate-flagging. The duplicate finding is recorded narratively in this candidate's `behavior` field instead of structurally, and here in this permanent report. This is a real gap in the registry's own vocabulary, not a workaround — flagged for whoever next extends `RelationshipKind`, not fixed here (out of this round's scope).

## What was NOT done (explicitly, per the axis's own "implement nothing")

- No new `connections/runpod/`, `connections/line/`, `connections/gmail/` adapter code was written — only registry pointers to the real, already-existing implementations (RunPod, LINE, Gmail) or real gaps (Vercel, Gemini).
- No `RelationshipKind` vocabulary extension.
- Railway (`connections/railway/router-invoker.ts`, no credential, no README) was noted but not investigated further — no evidence of active use to audit against.
- GitHub and DigitalOcean were not re-audited this round (already `BUILT`, out of scope — this round targeted the confirmed-credentialed gaps only).

## Registered this round (6 total, all `status: REGISTERED`, verified persisted in `software/registry-database/data/canonical/resources.jsonl`)

| resource_id | name | resource_type |
|---|---|---|
| `resource-b7168e56-345f-47fe-94c3-ce36c4d66f43` | runpod-compute-provider | CONNECTOR |
| `resource-3c04a980-8951-4410-bf6c-a133a3d18c55` | line-messaging-connector | CONNECTOR |
| `resource-8a42e397-78fc-4a8b-953f-d125b4d43769` | gmail-readonly-connector | CONNECTOR |
| `resource-6cd6e043-58a9-4fee-890b-c90d03900952` | vercel-integration-reference-implementations | SOURCE_REFERENCE |
| `resource-924c4bf4-b2cc-46a6-b1e8-6ae89154717b` | gemini-api-split-usage-reference | SOURCE_REFERENCE |
| `resource-0eacfb15-5b8f-4cf9-a364-e2df5d7582da` | dna-lab-local-machine-telemetry | TELEMETRY_REFERENCE |

The one-time registration script (`reports/cross-provider-audit-2026-08-24-register-candidates.ts`) has been deleted after running — it was a one-time registration pass, not a reusable capability of its own; this report is the permanent record.
