# DNA OS MCP — Canonical Tooling Connection Guide

Canonical implementation: `connections/dna-os-mcp/`  
Descriptor / grant authority: `tool-grant.ts`, `canonical-tool-descriptor.ts`  
Transport: Streamable HTTP `POST /mcp` on `127.0.0.1:8793` (stdio: `--stdio`)  
DNA OS backend: `127.0.0.1:8791` via `adapters/dna-os-http-client.ts`

## Principle

| Layer | Role |
|---|---|
| AI client (ChatGPT / Codex / Claude / Claude Code / VS Code / local agent) | Configuration only — which MCP endpoint to call |
| DNA OS MCP | One ingress / one egress; tool discovery + invoke gates |
| DNA OS | Execution and authorization authority |
| Canonical registries | Source of truth (capability, connector, schema, permission, evidence, Owner approval) |

Client configuration does **not** grant capability permission.

## Discover what you may use

Call:

`dna_os.resolve_tool_grant`

DNA OS returns only tools granted for the caller/scope, each with a canonical descriptor of **references** (capability, schema, connector, permission, approval, evidence). No secrets.

Inspect one tool:

`dna_os.inspect_tool_descriptor` with `{ "tool_id": "lookup_capability" }`

## Existing tools (reused)

Core ingress (unchanged):

- `submit_command`
- `list_capabilities` / `lookup_capability`
- `get_resource`
- `get_task`
- `submit_work_result`
- `get_system_status`

Grant / descriptor (this branch):

- `dna_os.resolve_tool_grant`
- `dna_os.inspect_tool_descriptor`

Plus the existing extended DNA OS MCP surface (local resources, runtime facts, canonical information reads, development-scoped tools under lease, etc.).

### Conceptual names → existing tools

These are **aliases only** (`conceptual-tool-aliases.ts`). They do not register a second tool universe.

| Conceptual | Existing tool_id |
|---|---|
| `dnaos.lookup_capability` | `lookup_capability` |
| `dnaos.inspect_capability` | `dna_os.get_capability_status` |
| `dnaos.resolve_tool_grant` | `dna_os.resolve_tool_grant` |
| `dnaos.read_resource` | `get_resource` |
| `dnaos.inspect_connector` | `dna_os.get_capability_binding_status` |
| `dnaos.verify_connection` | `dna_os.get_tool_health` |
| `dnaos.inspect_runtime` | `dna_os.get_runtime_identity` |
| `dnaos.run_test` | `dna_os.get_verification_status` |
| `dnaos.collect_evidence` | `dna_os.get_work_evidence` |
| `dnaos.submit_work_result` | `submit_work_result` |
| `dnaos.request_write` | `dna_os.create_action_preview` |
| `dnaos.prepare_publication` | `dna_os.get_promotion_status` |
| `dnaos.request_owner_approval` | `dna_os.open_owner_review` |
| `dnaos.verify_publication` | `dna_os.get_runtime_verification` |
| `dnaos.get_task` | `get_task` |
| `dnaos.get_system_status` | `get_system_status` |

`submit_registration_candidate` remains intentionally non-model-callable (not in tools/list).

## Owner approval

Privileged tools declare `owner_approval_policy_ref` pointing at:

- `control/owner-authentication/contract.ts#validateOwnerSession`
- `control/owner-authentication/human-verification.ts#runVerification`

Chat / bot / GitHub App / Cloud Agent identity is not Owner-device approval.

## Fail closed

Unknown, revoked, capability-unavailable, permission-denied, and approval-scope-mismatch outcomes do not fall through to a default tool or invented connector.

## Client examples (same authority)

All clients point at the same MCP:

```text
http://127.0.0.1:8793/mcp
```

Optional Owner session header (pointer only — not a credential):

```text
x-dna-os-owner-session: <session_id>
```

Optional internal machine credential (possession of channel key — never Owner identity):

```text
x-dna-os-internal-credential: <keychain-backed secret>
```

### ChatGPT / Codex / Claude / Claude Code / VS Code / local agent

Configure the MCP server URL (or stdio command `npm run dna-os-mcp:serve:stdio`).  
Then call `dna_os.resolve_tool_grant` — do not hard-code an Owner procedure list into the system prompt.

## Canonical owners (do not duplicate)

See `CANONICAL_OWNERS` in `canonical-tool-descriptor.ts`.
