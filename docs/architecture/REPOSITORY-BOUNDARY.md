# Repository boundary

## Identity ≠ path

| Field | Meaning |
|---|---|
| `repository_id` / `source_authority` | Git/source identity |
| `repository_root` | Node-local checkout binding |
| `world` | Boundary tag (`CONTROL_PLANE`, `BUSINESS_LINE_FINANCE`, `PRODUCT_SURFACE`, …) |
| `status` | `ACTIVE` / `SUSPENDED` / `RETIRED` |

A registration’s Git identity does **not** automatically authorize writes
on every filesystem path that happens to contain a clone of that remote.

## Node-local binding

`resolveControlPlaneCheckout()` (`software/repository-registry/checkout-resolution.ts`, exported from `contract.ts`; not re-implemented in `registry.ts`):

1. Requires exactly one operational row with `status=ACTIVE` and `world=CONTROL_PLANE`.
2. Prefers registered `repository_root` when that path exists on this node and Git identity matches.
3. If the registered path is missing/stale, may bind to the current git
   checkout of this process only when identity matches.
4. Otherwise returns `{ ok: false, … }` (fail closed).

A stale Mac checkout path from another machine therefore does **not**
grant CONTROL_PLANE write authority on a different node.

## Cross-world denial (Write Gate)

Paths under Business / Product Surface / unregistered sibling trees are
denied for CONTROL_PLANE writes (`OUTSIDE_CONTROL_PLANE_ROOT`), even when
those repositories are legitimately registered under other `world` values.
