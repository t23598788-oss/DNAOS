# control/agent-physical-scope/

Enforces **task/repository/runtime isolation** for coding agents by composing
existing DNA OS authorities. It does not replace work/task registries,
source-workspace, write-gate, agent-host Seatbelt, runtime-control, MCP
export policy, or GitHub publish authority.

## What is reused

| Concern | Existing owner |
|---|---|
| Task / worktree assignment | `control/source-workspace` reservations |
| Repository identity | `software/repository-registry` |
| Kernel write/exec jail | `control/agent-host` `sandbox-exec` |
| Seatbelt renderer | `control/runtime-adapter` |
| File write gate | `permissions/write-gate` + `execution/file-write` |
| Process spawn | `execution/run/process-gate` |
| Protected services/ports | `control/runtime-control` `SERVICES` |
| MCP mutation tools | `control/mcp-code-knowledge` `SOURCE_MUTATION_TOOLS` |
| GitHub push | `control/engineering-runtime/github-publish-authority` |
| Owner vs development surface | `control/owner-surface-separation` leases |

## Fail-closed rule

If `task_id` cannot be resolved to a registered reservation, **no** filesystem
write, Git write, process mutation, or port mutation is authorized.

Caller-supplied absolute paths, PIDs, ports, and repository ids are not
authoritative.

## Honest remaining gap

Interactive Cursor/Codex sessions that use host tools **without**
`control/agent-host#launchAgent` still have ambient OS authority. This
capability closes DNA OS mutation APIs and sandboxed agent-host children.
It cannot kernel-confine a tool runtime that never enters `launchAgent`.

## Tests

`npx tsx control/agent-physical-scope/tests/agent-physical-scope.test.ts`
