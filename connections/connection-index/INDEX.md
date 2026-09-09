# DNA OS Connection Index

This is a generated documentation projection. Per-connection `connection-document.json` records remain authoritative; this index is not a second runtime registry.

Machine index: [index.json](./index.json) · Builder: [build.ts](./build.ts)

## Connections

| Connection | Status | Verification | Human document | Machine record | Evidence | Known gaps |
|---|---|---|---|---|---|---|
| OpenAI / AI Model → DNA OS MCP Requester Connection | CONNECTED | MCP_PATH_CONNECTED_PROVIDER_API_NOT_VERIFIED | [open](../ai-model/OPENAI_AI_MODEL_CONNECTION.md) | [open](../ai-model/connection-document.json) | available | No OpenAI provider API client/adapter is implemented in this repository.; ai/model-router, ai/model-registry, and connections/ai-providers are README-only/not yet built. |
| DNA OS ↔ DigitalOcean Provider Connection | BLOCKED | PARTIAL_LIVE_BOUNDARY_VERIFICATION | [open](../digitalocean/DIGITALOCEAN_CONNECTION.md) | [open](../digitalocean/connection-document.json) | available | No production DigitalOcean account-binding registry or persistence exists.; No production Vault/credential broker exists for DigitalOcean references. |
| DNA OS MCP → Owner Command Connection | VERIFIED | LIVE_END_TO_END | [open](../dna-os-mcp/MCP_OWNER_COMMAND_CONNECTION.md) | [open](../dna-os-mcp/connection-document.json) | available | execution.run from live POST /owner/submit-command is not verified/wired in this connection because executionRequestBase is not supplied by the live HTTP ingress. The router's runExecutionStep explicitly blocks when executionPolicyContext or executionRequestBase is missing; this document does not claim execution.run execution. |
| DNA OS Engineering Runtime Coding Gate | VERIFIED | DNA_OS_SOURCE_PUBLICATION_AUTHORITY | [open](../engineering-runtime/ENGINEERING_RUNTIME_CONNECTION.md) | [open](../engineering-runtime/connection-document.json) | available | Pull Request creation is NOT_WIRED; production deploy (Supabase/Vercel/Railway/DigitalOcean) is NOT_WIRED |
| DNA OS ↔ GitHub Source Authority Connection | CONNECTED | PARTIAL_LIVE_VERIFICATION | [open](../github/GITHUB_CONNECTION.md) | [open](../github/connection-document.json) | available | GitHub Contents / executeSource writes to this registered repository are closed (DNA_OS_PUBLISH_AUTHORITY_REQUIRED).; No Pull Request, review, branch protection, release, Actions, or deploy path exists in this connection. |
| DNA OS ↔ n8n Workflow Control Connection | BLOCKED | HISTORICAL_LIVE_PROOF_WITH_CURRENT_CONFIGURATION_DRIFT | [open](../n8n/N8N_CONNECTION.md) | [open](../n8n/connection-document.json) | available | Configuration drift: declared Hostinger target is unreachable while local :5678 is observed without DNA OS ownership or wiring.; No evidence proves the registered n8n API credential authenticates the observed local instance. |
| DNA OS ↔ Railway Provider and Runtime Connection | CONNECTED | PARTIAL_LIVE_BOUNDARY_VERIFICATION | [open](../railway/RAILWAY_CONNECTION.md) | [open](../railway/connection-document.json) | available | The Railway invoker is registered in control/connector-execution-boundary but no railway capability entry exists in control/command-router/capability-registry.ts; direct invoker verification must not be presented as Owner-command routing verification.; The connection declaration target_resolution is UNRESOLVED and state OBSERVED. |
| DNA OS ↔ Supabase Project Connection | CONNECTED | PARTIAL_BOUNDARY_VERIFICATION | [open](../supabase/SUPABASE_CONNECTION.md) | [open](../supabase/connection-document.json) | available | No authoritative live PostgREST success record is available for this documentation pass.; No live Supabase Auth session proof is available in this repository evidence set. |
| tiktok connection declaration | NOT_VERIFIED | DECLARATION_ONLY | DOCUMENT_MISSING | DOCUMENT_MISSING | none | DOCUMENT_MISSING |

## Current authoritative entry

### MCP → Owner Command

- Status: `VERIFIED`
- Network Authorization: `VERIFIED`
- Owner Session Binding: `VERIFIED`
- `submitOwnerCommand`: `VERIFIED`
- Router: `VERIFIED`
- Capability Registry: `VERIFIED`
- agent-host / LOCAL worker: `VERIFIED`
- Result/Evidence return: `VERIFIED`
- execution.run from Owner Command: `NOT_WIRED / NOT_VERIFIED`
- Human document: [MCP_OWNER_COMMAND_CONNECTION.md](../dna-os-mcp/MCP_OWNER_COMMAND_CONNECTION.md)
- Machine record: [connection-document.json](../dna-os-mcp/connection-document.json)

## Projection rules

- `VERIFIED`, `CONNECTED`, `NOT_VERIFIED`, `BLOCKED`, and `NOT_WIRED` are the only statuses.
- A declaration without an authoritative semantic document is shown as `NOT_VERIFIED` with `DOCUMENT_MISSING`.
- Existing configuration drift is shown as `BLOCKED`; no success is inferred.
- Secret values are never copied into the index.

## Missing authoritative connection documents

- `connection-declaration://tiktok/SOCIAL_ACCOUNT/BIDIRECTIONAL/account=owner-primary,login_kit=v2` — tiktok connection declaration — `NOT_VERIFIED`

Future connection documents must register by adding an authoritative `connection-document.json`; rerun the builder to project it here.
