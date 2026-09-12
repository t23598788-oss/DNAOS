# Write authority flow

Describes the **existing** path from Owner intent to a Write Gate decision.

## Flow

```
Owner Intent
→ Owner Command (`control/owner-command`, transport `transport/owner-command-http`)
→ Intent validation (envelope / semantics)
→ Owner Authority (owner authentication / write-gate shared-secret on non-loopback)
→ Capability / Repository resolution
   - Capability overlap: `software/capability-registrar` via Write Gate
   - Repository: `software/repository-registry` via `resolveControlPlaneCheckout()`
→ Write Gate (`permissions/write-gate` → `evaluateWriteIntent`)
→ Execution (e.g. file-write / agent-gateway adapters that already call Write Gate)
→ Tests / Typecheck
→ Evidence
→ Registration
→ Git publication
```

## Write Gate order (existing)

1. Well-formed intent (`ruleWellFormedIntent`)
2. CONTROL_PLANE path confinement (`ruleControlPlanePath`)
   - exactly one ACTIVE CONTROL_PLANE via Repository Registry
   - deny secret/env targets
   - deny paths outside resolved `repository_root`
3. Capability-folder overlap (`ruleRegistryLookup` / `searchOverlap`)

Only after path confinement may overlap search run.

## Fail-closed outcomes already implemented

| Condition | Reason code (existing) |
|---|---|
| No / multiple ACTIVE CONTROL_PLANE | `CONTROL_PLANE_REPOSITORY_UNRESOLVED` |
| Path outside CONTROL_PLANE root | `OUTSIDE_CONTROL_PLANE_ROOT` |
| `.env` / credential / secret-shaped path | `SECRET_OR_ENV_PATH_DENIED` |
| MODIFY/DELETE with no overlap | `NO_MATCHING_CAPABILITY` |
| Ambiguous overlaps | `UNKNOWN` / `AMBIGUOUS_OVERLAP` |
