# permissions/network-auth-gate

Shared-secret authentication gate for transport-layer HTTP servers in this
repo that were built assuming loopback-only reachability
(`transport/owner-command-http`, `dna-os-circuit/runtime`). Created
2026-08-24 during the GitHub/Railway migration, after two independent
reviews (this session + a peer session) confirmed none of the network
services eligible for Railway deployment had any request authentication of
their own — they relied entirely on `127.0.0.1`-only binding plus, in
`owner-command-http`'s case, an external caller's already-verified auth.

## What this is

Two pure decision functions, no HTTP framework coupling:

- `verifySharedSecret(authorizationHeader, expectedSecret)` — timing-safe
  Bearer-token compare.
- `evaluateBindPolicy(bindHost, secret)` — the fail-closed startup check: a
  server binding to a non-loopback host with no secret configured must
  refuse to start, not silently listen unauthenticated. Loopback + no
  secret is unchanged, existing behavior (today's real Mac processes).

Each consuming server keeps its own thin transport-specific glue (reading
its own request/response types, sending its own 401 body) and calls into
this capability only for the actual decision.

## What this is not

Not per-user identity or a JWT verifier. Every route this protects already
treats its caller as one already-authorized single owner (see
`control/agent-gateway`'s fixed single-owner grant model,
`permissions/access-control`) — a shared secret is the right-sized gate for
"is this caller authorized to reach this owner's DNA OS instance at all,"
not "which of many users is calling." If this system grows real multi-user
identity, that belongs in `permissions/access-control` /
`permissions/execution-policy`, not here.

## Dependency ที่อนุญาต

`node:crypto` only, per `contract.ts`.
