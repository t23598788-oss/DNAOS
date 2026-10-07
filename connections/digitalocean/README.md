# connections/digitalocean/

**Phase 1 — Owner-approved 2026-08-17. READ ONLY ONLY.**

The third and final layer of Owner's 3-layer provider architecture, now real for five read capabilities:

```
providers/digitalocean/                         — the DigitalOcean "dictionary" — DONE
credentials/provider-accounts/digitalocean/      — which account uses which key (types only) — DONE
connections/digitalocean/                        — THIS FOLDER: the connector that uses both — PHASE 1 DONE (read-only)
```

## What's implemented

Five read capabilities, each backed by a real record in `../../providers/digitalocean/definition/actions.json` or `billing.json` — never a hardcoded endpoint:

| Intent | Real endpoint | Required scope |
|---|---|---|
| `digitalocean.account.read` | `GET /v2/account` | `account:read` |
| `digitalocean.regions.list` | `GET /v2/regions` | not documented by DigitalOcean — see fallback below |
| `digitalocean.sizes.list` | `GET /v2/sizes` | not documented by DigitalOcean — see fallback below |
| `digitalocean.droplets.list` | `GET /v2/droplets` | `droplet:read` |
| `digitalocean.billing.read` | `GET /v2/customers/my/balance` | `billing:read` |

## Required flow (implemented exactly, in `digitalocean-adapter.ts`)

```
DNA OS request (CommandEnvelope)
  -> resolve account binding        (AccountBindingProvider — interface, no registry yet)
  -> validate binding STATUS        (fail-closed: expired/revoked/unverified)
  -> validate required scope        (fail-closed)
  -> resolve credential reference   (binding.token_reference — a Vault URI, never a secret)
  -> credential provider interface  (CredentialProvider — interface, no Vault client yet)
  -> DigitalOcean API                (real, GET-only fetch)
  -> normalized result               (never raw upstream JSON passed through)
  -> evidence                        (CapabilityResultEvidence[], safe to log/audit)
```

A command that fails any earlier step never reaches the next one — no credential is ever resolved for a request that fails binding/status/scope checks, and no network call is ever made for a request that fails credential resolution.

## The two required interfaces (no real implementation exists yet, on purpose)

- **`CredentialProvider`** (`credential-provider.ts`) — Owner's exact instruction: "Vault client does not exist yet. Therefore define a CredentialProvider interface only." No implementation lives in this folder.
- **`AccountBindingProvider`** (`binding-provider.ts`) — the same reasoning applied consistently: `credentials/provider-accounts/digitalocean/` has no registry yet either, so binding resolution is behind an interface too, not hardcoded or stubbed with a real-looking fake in production code.

Both are implemented **only** as in-memory fakes inside `tests/adapter.test.ts` — no real token, no real Vault call, no real binding store anywhere in this folder or its tests.

## Files

| File | Purpose |
|---|---|
| `adapter-contract.ts` | intents, payload shape, five normalized result types, outcome type |
| `provider-action-lookup.ts` | intent -> real endpoint/method/scope, read from `providers/digitalocean/definition/*.json` |
| `binding-provider.ts` | `AccountBindingProvider` interface |
| `credential-provider.ts` | `CredentialProvider` interface |
| `authorization.ts` | the two fail-closed gates (status, scope) |
| `host-runtime.ts` | GET-only `hostFetch` (by construction, no method/body param) + host primitives |
| `digitalocean-read-api.ts` | real fetch calls + pure normalizers for the five capabilities |
| `evidence.ts` | builds `CapabilityResultEvidence[]` per step |
| `digitalocean-adapter.ts` | `handleDigitalOceanReadCommand` — the one public entry point |
| `tests/adapter.test.ts` | offline tests: fail-closed paths + all five success paths, fake credential/binding providers, fake HTTP transport |

## Hard rules this folder enforces

- No secret value is ever hardcoded, logged, or returned — only `credential_source` (a Vault URI string) travels through results/evidence.
- No write capability exists anywhere (`host-runtime.ts`'s `hostFetch` has no `method`/`body` parameter — mechanically GET-only, not just a convention).
- No resource is created, updated, or deleted — verified in tests by asserting only `GET` URLs are ever constructed.
- `dna-os-circuit/` was not touched by this round.

## Explicitly NOT in this folder

- No real `CredentialProvider` implementation (no Vault client)
- No real `AccountBindingProvider` implementation (no binding registry/persistence)
- No create/update/delete intents for any DigitalOcean resource
- No Spaces, Kubernetes, App Platform, Databases, Networking, or AI/Inference capabilities — only the five Owner named
- No wiring into `control/command-router/capability-registry.ts`
