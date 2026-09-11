# Runtime V1 documentation set

**role of this folder:** DESTINATION + PLACEMENT companions to `governance/architecture-rules/`. Not a lifecycle stage. Not executable law.

| File | Role |
|---|---|
| [DESTINATION.md](./DESTINATION.md) | End-state architecture (mechanisms). Go/folder examples are illustrative. |
| [PLACEMENT.md](./PLACEMENT.md) | Migration authority: KEEP / MIGRATE / ADD / RETIRE, current vs destination, order. |
| [CURRENT-MAP.md](./CURRENT-MAP.md) | Working-tree gap map (human). |
| [gap-map.yaml](./gap-map.yaml) | Same map, machine-readable. Includes `provider_separation` for Step 7. |
| [STEP-7-ADAPTER-BOUNDARY.md](./STEP-7-ADAPTER-BOUNDARY.md) | Cross-repo adapter audit + reversible Step 7 cuts. Plan only. |
| [source/](./source/) | Original DOCX artifacts. |

**CURRENT law:** TypeScript contracts, registries, permissions, tests, and evidence in this checkout.

**DESTINATION wins** only for intended convergence, never for what may execute today.

Executable vocabulary already frozen: [`../RUNTIME_NODE_AND_OPTIONAL_PROVIDER.md`](../RUNTIME_NODE_AND_OPTIONAL_PROVIDER.md) and `contracts/architecture/runtime-node-and-optional-provider.ts`.

Status vocabulary (only): `VERIFIED` | `PARTIAL` | `MISSING` | `CONFLICT` | `RETIRE_CANDIDATE` | `DEFERRED`.
