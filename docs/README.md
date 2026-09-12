# DNA OS documentation index

Ordered entry point for **existing** CONTROL_PLANE implementation in
`t23598788-oss/-DNA-OS-INFRASTRUCTURE-`.

This tree describes what is already in this repository. It does **not**
invent a second registry, a new architecture, or speculative runtimes.

## Canonical flow (implemented path)

```
Owner Intent
→ Owner Command
→ Intent validation
→ Owner Authority
→ Capability / Repository resolution
→ Write Gate
→ Execution
→ Tests / Typecheck
→ Evidence
→ Registration
→ Git publication
```

## Read in this order

1. [architecture/DNA-OS-CONTROL-PLANE.md](architecture/DNA-OS-CONTROL-PLANE.md)
2. [architecture/WRITE-AUTHORITY-FLOW.md](architecture/WRITE-AUTHORITY-FLOW.md)
3. [architecture/REPOSITORY-BOUNDARY.md](architecture/REPOSITORY-BOUNDARY.md)
4. [registry/REPOSITORY-REGISTRY.md](registry/REPOSITORY-REGISTRY.md)
5. [registry/CAPABILITY-REGISTRY.md](registry/CAPABILITY-REGISTRY.md)
6. [registry/RUNTIME-REGISTRY.md](registry/RUNTIME-REGISTRY.md)
7. [security/WRITE-GATE.md](security/WRITE-GATE.md)
8. [security/OWNER-AUTHORITY.md](security/OWNER-AUTHORITY.md)
9. [security/SECRET-BOUNDARY.md](security/SECRET-BOUNDARY.md)
10. [runtime/OWNER-COMMAND-RUNTIME.md](runtime/OWNER-COMMAND-RUNTIME.md)
11. [runtime/DNA-OS-MCP.md](runtime/DNA-OS-MCP.md)
12. [runtime/LOCAL-EXECUTION.md](runtime/LOCAL-EXECUTION.md)
13. [evidence/VERIFICATION-MATRIX.md](evidence/VERIFICATION-MATRIX.md)
14. [evidence/LIVE-PROOF-INDEX.md](evidence/LIVE-PROOF-INDEX.md)

## Hard boundaries (existing)

- There is **one** Repository Registry (`software/repository-registry/`). Do not create another.
- Git/source identity (`source_authority` / `repository_id`) is **not** the same as local `repository_root`.
- `repository_root` is node-local binding. A stale checkout from another machine does not grant write authority.
- CONTROL_PLANE writes must resolve inside the single ACTIVE CONTROL_PLANE checkout for this node.
