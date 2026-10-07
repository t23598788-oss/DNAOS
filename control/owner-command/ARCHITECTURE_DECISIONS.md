# control/owner-command/ — Architecture Decisions

## §ONE_SURFACE

`submitOwnerCommand` is the only public entry point (via `contract.ts`).
It never exposes each routed step as its own surface: `../command-router/`'s
`routeOwnerCommand` already folds a multi-step command into ONE
`CapabilityResult`, and `OwnerSurfaceState.current_worker` is set to the
LAST capability_id invoked, not a list. This satisfies the Owner spec's
"Owner only ever sees one task, not each sub-step as a separate surface."

## §LIFECYCLE_MAPPING

`deriveLifecycle()` maps a `CapabilityResult.status` onto
`../command-status/lifecycle.ts`'s `CommandLifecycleStage` strictly along
`LEGAL_TRANSITIONS` — it never jumps `executing` straight to `responded`:

| CapabilityResult.status | lifecycle path |
|---|---|
| `COMPLETED` | received → authenticated → authorized → classified → routed → executing → **evidenced** → responded |
| `FAILED` | received → ... → executing → failed → responded |
| `PENDING` / `RUNNING` | received → ... → executing (stops here — not yet terminal) |
| `BLOCKED` / `OWNER_REVIEW` | received → authenticated → authorized → classified → **rejected** (stops here; `rejected` carries the router's own reason as its `note`, never fabricated as success) |

Rationale for stopping `BLOCKED`/`OWNER_REVIEW` at `classified` rather
than `routed`/`executing`: both statuses mean the router decided NOT to
actually invoke the capability (a permission denial, an ambiguous match,
or a not-connected capability) — no adapter/executor call was made, so
`routed`/`executing` would misrepresent what happened. `FAILED`, by
contrast, only occurs after a real invocation was attempted (or refused
for a structural reason like `UNSUPPORTED_COMMAND`), so it passes through
`executing` honestly.

## §NON_HUMAN_REJECTION

`submitOwnerCommand` throws if `ownerIdentity.kind !== "human"`, matching
`./README.md`'s stated boundary verbatim ("รับคำสั่งที่มาจาก Owner
โดยเฉพาะ ... Owner มีสิทธิ์ระดับ manage_infrastructure"). A
non-human caller (an AI agent, an external program) does not go through
this folder — it would go directly to `../command-router/` with its own
`issued_by.kind`, a wiring this round does not build (out of scope: this
round is the OWNER surface only).

## §NO_CROSS_REPO_IMPORT

Same rule as `../command-router/ARCHITECTURE_DECISIONS.md`
§NO_CROSS_REPO_IMPORT: this folder imports only
`../command-router/contract.ts` for anything capability-shaped — it never
imports `../command-router/router.ts` or `../command-router/capability-registry.ts`
directly, and it never imports anything from `connections/`,
`execution/`, or `permissions/` itself (those are `../command-router/`'s
job to cross).
