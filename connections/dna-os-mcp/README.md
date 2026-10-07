# connections/dna-os-mcp/

หน้าที่: DNA OS's canonical MCP (Model Context Protocol) server — the
**External Agent Boundary only**. Lets Codex / Claude / any external AI
agent discover and call DNA OS through one standard MCP surface, without
ever needing to know Supabase, GitHub, Vercel, Keychain, or any other
backend implementation detail.

**MCP = boundary, not a new brain.** This folder creates no Decision
Engine, Registry, Dispatcher, or Credential system of its own. Every tool
handler reaches DNA OS through exactly one path:
`./adapters/dna-os-http-client.ts` → DNA OS's own already-canonical HTTP
transport (`transport/owner-command-http/server.ts`,
`http://127.0.0.1:8791`) → the existing owner-command / command-router /
registration / agent-gateway pipeline. No SQL, no `pg.Pool`, no provider
SDK, no database credential exists anywhere in this folder.

## Canonical flow

```
External Agent
  -> DNA OS MCP Server (this folder)
  -> DNA OS Identity/Auth (./identity.ts -> ownerIdentity, forwarded to
     the existing permissions/access-control + permissions/execution-policy
     boundary already enforced by transport/owner-command-http/server.ts)
  -> Existing Input/API Contracts (POST /command, POST /registry/candidates,
     GET /registry/capabilities/:id, GET /registry/resources/:id,
     GET /task/:id, POST /handoff, GET /runtime/inventory)
  -> Existing Registration/Command/Lookup Pipeline
  -> Evidence/Result
  -> MCP Response
```

## MCP Tool Resolver

Every tool call passes through `./capability-gate.ts` before its handler
runs. For tools tied to an entry in the real
`control/command-router/capability-registry.ts` (currently only
`submit_work_result`, gated on `dispatcher`), the resolver requires
REGISTERED (entry exists) + VERIFIED (`health_status === "CONNECTED"`) +
AVAILABLE (`endpoint.kind !== "not_yet_built"`) before invoking — a
missing/unverified/unavailable capability returns
`CAPABILITY_NOT_AVAILABLE`, never a fallback or an AI-authored
implementation. Tools that are core DNA OS ingress/lookup primitives
(not optional routed capabilities) are reported
`NOT_GATED_CORE_PRIMITIVE`, never silently treated as verified without
saying so.

## Tools (first round — only what has a real canonical pipeline today)

| tool | reuses | read/write |
|---|---|---|
| `submit_command` | `POST /command` (owner-command Input Ingress) | write |
| `submit_registration_candidate` | `POST /registry/candidates` (Registration Ingress) | write |
| `lookup_capability` | `GET /registry/capabilities/:id` (Registry Lookup) | read |
| `get_resource` | `GET /registry/resources/:id` (`findResourceById`) | read |
| `get_task` | `GET /task/:id` (task/result/evidence lookup) | read |
| `submit_work_result` | `POST /handoff` (existing canonical handoff ingress — admission checks unchanged) | write |
| `get_system_status` | `GET /runtime/inventory` (live capability/runtime status) | read |

No tool was created for a capability without a real, already-wired
pipeline behind it.

## Runtime requirement

This repo's standard Node version is now >= 18 (see root `.nvmrc` /
`package.json`'s `engines.node`). `engine-strict=true` in `.npmrc` makes
`npm install` genuinely refuse to run on an older Node (verified: real
`EBADENGINE` failure on v16) — that's npm's real enforcement boundary,
it does not gate `npm run <script>` itself (npm has no such hook). Run
`nvm use` at the repo root before anything else, for both install and
run. `@modelcontextprotocol/sdk` (this folder's one MCP-specific
dependency) needs Node >= 18 for web-standard globals like
`Headers`/`fetch`; the rest of the repo needs it because that is now the
one standard, not a per-folder exception.

`test:mcp` is still a separate script from `test:integration` — not
because of Node version, but because it has a real external precondition
`test:integration` doesn't: the canonical DNA OS server
(`npm run owner-command:serve`) must already be running on
`127.0.0.1:8791`, since every tool handler makes a genuine HTTP round
trip to it.

## Transports

1. **Streamable HTTP** (canonical remote transport) — `POST /mcp` on
   `http://127.0.0.1:8793` by default (`PORT` env var to override),
   stateless mode (`sessionIdGenerator: undefined`).
2. **stdio** — for a local Agent host process, via `--stdio`.
3. The deprecated HTTP+SSE transport is never used.

Input: MCP JSON-RPC requests (Streamable HTTP or stdio).
Output: MCP `CallToolResult`s, each carrying a `correlation_id` and,
where the underlying DNA OS response includes them, the real
`dna_os_command_id`/`dna_os_task_id`/`dna_os_decision_id`/evidence —
so an MCP request can be traced through to the DNA OS decision and back.

Dependency ที่อนุญาต: `@modelcontextprotocol/sdk`, `zod`, this folder's
own files only.

สิ่งที่ห้ามแตะ:
- No direct Postgres/Supabase/GitHub/Vercel access from any handler —
  every handler goes through `DnaOsHttpClient` only, which itself only
  calls DNA OS's own loopback HTTP transport.
- No database credential is ever held here.
- No raw SQL.
- No bypass of the Registration Gate, execution-policy, or
  work-coordination — every one of those already runs inside the
  endpoints this folder calls, unmodified.
- No tool for a capability that isn't REGISTERED + VERIFIED + AVAILABLE
  (or a proven core primitive).
- No exposing internal implementation names (Supabase table names,
  Keychain account/service, `pg.Pool`, provider tokens) through any tool
  schema or response — only DNA OS-level contract shapes.
