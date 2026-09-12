# DNA OS Control Plane

## What this repository is

`-DNA-OS-INFRASTRUCTURE-` is the **CONTROL_PLANE** software source and
control repository. It owns software commands, registries, write policy,
and transport for Owner Command — not business master data.

Operational repository worlds already registered include:

- `CONTROL_PLANE` — this repository
- `BUSINESS_LINE_FINANCE` — business/finance line (separate repo)
- `PRODUCT_SURFACE` — Owner product surface (separate repo)

## Existing bridge (this closeout)

```
Write Gate
→ Repository Registry
→ single ACTIVE CONTROL_PLANE
→ repository_root
→ local path boundary
```

Implemented by:

- `software/repository-registry/checkout-resolution.ts` → `resolveControlPlaneCheckout()` (exported via `contract.ts`; not re-implemented in `registry.ts`)
- `permissions/write-gate/rules.ts` → `ruleControlPlanePath()` before capability overlap

## What Control Plane is not

- Not a second capability registry
- Not a business database
- Not automatically every process that happens to listen on a port
- Not authoritative for writes into Business or Product Surface trees

## Related docs

- [WRITE-AUTHORITY-FLOW.md](WRITE-AUTHORITY-FLOW.md)
- [REPOSITORY-BOUNDARY.md](REPOSITORY-BOUNDARY.md)
- [../registry/REPOSITORY-REGISTRY.md](../registry/REPOSITORY-REGISTRY.md)
- [../security/WRITE-GATE.md](../security/WRITE-GATE.md)
