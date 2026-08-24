# credentials/provider-accounts/digitalocean/

**Purpose:** the registry-record *shape* for "which DNA OS Account uses which DigitalOcean key" — the middle layer of Owner's 3-layer provider architecture:

```
providers/digitalocean/       — the DigitalOcean "dictionary" (what exists, what endpoint, what scope) — DONE
credentials/provider-accounts/digitalocean/   — THIS FOLDER: which account is bound to which credential, referenced only — DESIGN DONE, NOT_YET_BUILT (no registry yet)
connections/digitalocean/     — the connector that looks up a binding here, then calls the real API — NOT_YET_BUILT
```

**Status:** `TYPES_DEFINED` — this round was type design only, per Owner's explicit instruction to stabilize this shape before `connections/digitalocean/` is built to consume it. No registry (create/get/list a binding), no credential broker, no Vault access, no real DigitalOcean call exists anywhere in this folder.

## What's here

| File | Owner's named concern | Contents |
|---|---|---|
| `account-binding.ts` | account-binding | `AccountBinding` — DNA OS `account_id` <-> real DigitalOcean `digitalocean_team_id` |
| `credential-reference.ts` | credential-reference | `VaultReference` — a `vault://` locator, never a secret. Extends the reference-only pattern already proven in `../../../contracts/connector/connection.ts`'s `ConnectionRegistration.credential_ref` (dna-os-deadboard TASK-172) |
| `scope-policy.ts` | scope-policy | `ScopePolicy` + `scopeSatisfies()` — does this binding's granted scopes cover a required scope |
| `expiry-policy.ts` | expiry-policy | `ExpiryPolicy` + `deriveBindingStatus()` — is this binding still good, purely from its own timestamps |
| `rotation-policy.ts` | rotation-policy | `RotationPolicy` + `canAutoRotate()` — only OAuth 2.0 can self-refresh; PAT/Spaces key/inference tokens cannot |
| `status.ts` | (derived) | thin wrapper so `AccountCredentialBinding.status` is always computed the same way |
| `types.ts` | (composition) | `AccountCredentialBinding` — the 10-field record Owner specified, composed from the five files above |

## The 10 fields, as delivered

| Owner's field | Where it lives |
|---|---|
| `ACCOUNT_ID` | `AccountBinding.account_id` |
| `DIGITALOCEAN_TEAM_ID` | `AccountBinding.digitalocean_team_id` |
| `AUTH_METHOD` | `RotationPolicy.auth_method` (`"pat"` \| `"oauth2"` \| `"spaces_key"` \| `"inference_bearer_auth"` — matches `providers/digitalocean/definition/provider.json`'s `auth_methods[].method_id`) |
| `TOKEN_REFERENCE` | `AccountCredentialBinding.token_reference` — `VaultReference \| undefined` |
| `SCOPES` | `ScopePolicy.granted_scopes` |
| `EXPIRES_AT` | `ExpiryPolicy.expires_at` |
| `REFRESH_REFERENCE` | `RotationPolicy.refresh_reference` — only populated for `auth_method="oauth2"` |
| `STATUS` | `ExpiryPolicy`-derived, via `status.ts` — never hand-set |
| `LAST_VERIFIED` | `ExpiryPolicy.last_verified` |
| `REVOKED_AT` | `ExpiryPolicy.revoked_at` |

## Hard rule this folder enforces

No field anywhere in this capability folder may hold a real secret value. `token_reference` and `refresh_reference` are always `{ uri: "vault://..." }` or `undefined` — the actual token lives in Vault, never here. `credential-reference.ts`'s `isVaultReference()` guard exists specifically to catch the one mistake this rule exists to prevent.

## One capability, one folder

Per `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md`: this folder is self-contained (edit/move/test/delete as one unit) and communicates with other capabilities only through the types it exports — no other capability folder's implementation is imported here, and this folder imports nothing from outside itself.

## Known overlap, deliberately not merged this round

`../../../contracts/connector/connection.ts`'s `ConnectionRegistration.credential_ref` already implements the same "reference, never the secret" idea, generically across any connector/software (not DigitalOcean-specific, no scope/expiry/rotation tracking). This folder's `VaultReference` is designed to slot into that contract's `credential_ref` union as a future `{ kind: "vault_ref" } & VaultReference` variant — not done yet, intentionally out of this round's scope. Flagged here so the next person (human or AI) doesn't rediscover this from scratch.

## Explicitly NOT in this folder

- No `connections/digitalocean/` connector code
- No credential broker / Vault client
- No registry (nothing persists a binding anywhere yet)
- No wiring into `contracts/connector/connection.ts`
