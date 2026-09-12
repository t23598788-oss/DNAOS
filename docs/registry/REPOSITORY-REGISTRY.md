# Repository Registry

**Location:** `software/repository-registry/`  
**Public contract:** `software/repository-registry/contract.ts`  
**Store:** existing JSONL registration data under this capability folder.

This is the **only** Repository Registry. Do not create a second one.

## Responsibilities (existing)

- Register / get / list / suspend repositories
- Classify OPERATIONAL vs TEST_FIXTURE
- List operational repositories
- Resolve this node’s ACTIVE CONTROL_PLANE checkout: `resolveControlPlaneCheckout()`

## Critical rule

**Git/source identity ≠ local checkout path.**

- `source_authority` / `repository_id` identify the Git remote.
- `repository_root` is a **node-local** binding.
- A stale checkout from another machine must not grant authority.

## Operational worlds observed

Including (not an exclusive enum enforced at DB level):

- `CONTROL_PLANE`
- `BUSINESS_LINE_FINANCE`
- `PRODUCT_SURFACE`

## Related

- [../architecture/REPOSITORY-BOUNDARY.md](../architecture/REPOSITORY-BOUNDARY.md)
- [../security/WRITE-GATE.md](../security/WRITE-GATE.md)
