# Write Gate

**Location:** `permissions/write-gate/`  
**Entrypoint:** `evaluateWriteIntent()` via `permissions/write-gate/contract.ts`

## Rule (existing)

Only the **ACTIVE CONTROL_PLANE** checkout resolved by Repository Registry
is eligible for CONTROL_PLANE writes.

Fail closed for:

- Business repo paths
- Product Surface / control-workspace repo paths
- Unregistered sibling repo paths
- Prefix-confusion paths (`${root}-evil/...`)
- `.env` / credential / secret-shaped targets
- Unresolved CONTROL_PLANE checkout (`CONTROL_PLANE_REPOSITORY_UNRESOLVED`)
- Stale foreign-machine checkout paths that are not the node-local root

## Implementation points

- Path confinement: `ruleControlPlanePath` in `rules.ts`
- Resolver: `resolveControlPlaneCheckout()` in `software/repository-registry`
- Overlap semantics unchanged after confinement (CREATE / MODIFY / DELETE / UNKNOWN)

## Proofs

See [../evidence/VERIFICATION-MATRIX.md](../evidence/VERIFICATION-MATRIX.md)
and [../evidence/LIVE-PROOF-INDEX.md](../evidence/LIVE-PROOF-INDEX.md).
