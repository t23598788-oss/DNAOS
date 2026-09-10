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

Cursor/IDE built-in Shell and Write still run as the host Cursor process.
They are **not** Seatbelt-confined unless DNA OS launches the worker through
`control/agent-host#launchAgent`.

Project hooks (`.cursor/hooks.json`) map Cursor `beforeShellExecution` /
`preToolUse` / `beforeMCPExecution` onto the same physical-scope guards.
Hooks are policy, not kernel: they can be disabled. Allowed IDE shell is
classified `NON_CANONICAL_UNTRUSTED_EXECUTION` and is not eligible for
automatic promotion (`agentProducedChangeEligibleForAutoPromotion`).

Canonical engineering execution:

`Cursor/IDE agent → task admission → control/agent-host launchAgent → Seatbelt / task scope → assigned workspace`

Preferred mutation tools (existing names reused):

- `dna_os.apply_scoped_source_write` / `apply_scoped_patch`
- `run_scoped_test` (read/discovery class; does not grant write)
- `publish_scoped_change` (Git write class; still closed to direct push)
- `restart_task_runtime` (runtime class; protected Owner ports remain denied)

## Tests

`npx tsx control/agent-physical-scope/tests/agent-physical-scope.test.ts`
`npx tsx control/agent-physical-scope/tests/seatbelt-isolation.test.ts`
`npx tsx control/agent-physical-scope/tests/cursor-hook.test.ts`
`npx tsx control/agent-physical-scope/tests/cursor-class-boundary.test.ts`
