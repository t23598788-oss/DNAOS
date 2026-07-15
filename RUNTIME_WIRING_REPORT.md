# Runtime Wiring Audit — Phase 2.7

Read-only. No file modified, moved, or renamed. No fix applied.

## Chain under audit

```
Capability → Planner → Orchestrator → Executor → Driver → Result
```

This traces `registry/capability-registry.json` (202 Capabilities, frozen v1.0.0) through `core/workspace/composer/` → `core/workspace/planner/` → `core/workspace/orchestrator/` → whatever executes next → whatever performs the real side effect.

## Headline finding

**All 202 Capabilities score identically on this chain.** Not because they were sampled and happened to match — because the chain itself has no branching per-Capability: nothing in `app/` or `components/` ever names a `CapabilityId`, so no Capability can differ from any other in how far it travels. The evidence below is chain-level, not Capability-level, which is why this report gives one table instead of 202 identical rows.

| Question | Answer (all 202) | Evidence |
|---|---|---|
| Implemented | **YES** | `registry/capability-registry.json`, generated Phase 7.4 from direct source inspection; each entry's `OwnerModule`/`ExportName` was validated to exist and type-check at generation time |
| Referenced | **NO** | `grep -rln "CapabilityId\|requestedCapabilityIds" --include="*.ts" --include="*.tsx" app/ components/` → 0 results |
| Instantiated | **NO** | `grep -rln "capabilityComposer\|executionPlanner\|runtimeOrchestrator\|composerResolver" --include="*.ts" --include="*.tsx" app/ components/` → 0 results |
| Executed | **NO** | See "Where the chain ends" below — even a hypothetical caller has nowhere to hand off to |
| Reachable (via this chain) | **NO** | No entry point exists in real app code into `core/workspace/composer/` |
| Dead (via this chain) | **YES**, scoped — see caveat below | — |

## Where the chain ends

Each link was read directly, not inferred:

1. **Capability Registry** (`registry/capability-registry.json`) — real data, 202 entries, categories: `business` (117), `gateway` (41), `workspace` (27), `presentation` (17).
2. **Composer** (`core/workspace/composer/`) — `capabilityComposer.ts` resolves a `CompositionRequest` into a `CompositionPlan`. Confirmed (this session, Phase 7.5 build + this audit's grep) to import nothing from `Runtime`/`BusinessEngine`/`Gateway`/`Presenter`/`Database` — it is planning-only by construction, and has zero real callers in `app/`/`components/`.
3. **Planner** (`core/workspace/planner/`) — `executionPlanner.ts` turns a `CompositionPlan` into a staged `ExecutionPlan`. Same finding: zero real callers, planning-only.
4. **Orchestrator** (`core/workspace/orchestrator/runtimeOrchestrator.ts`) — manages `ExecutionSession` state transitions. Its `completeCapability` method (lines 100-111) was read directly:
   ```ts
   completeCapability(session, plan, capabilityId) {
     if (!plan.orderedCapabilities.includes(capabilityId)) {
       throw new Error(`Capability "${capabilityId}" is not part of ExecutionPlan "${plan.executionId}"`);
     }
     const next = moveCapability(session, capabilityId, "completedCapabilities");
     return {
       ...next,
       progress: executionProgressTracker.updateCapability(next.progress, capabilityId, 1, plan.executionStages),
     };
   },
   ```
   This is pure state bookkeeping — it moves a `CapabilityId` string between arrays and updates a progress percentage. It never looks up the Capability's real `OwnerModule#ExportName` from the registry and never calls any function. There is nothing downstream of this that could execute anything even if a caller existed upstream.
5. **Executor / Driver** — **do not exist for this chain.** The Orchestrator has no next step. Searched for any handoff:
   ```
   grep -rln "CapabilityId\|capability-registry\|PresentationGatewayDeps" core/executor/ plugins/drivers/
   → 0 results
   ```
6. **Runtime registration** — `core/workspace/runtimeRegistry.ts` (built Phase 0, structurally ready: `register`/`unregister`/`getStatus`/`list`/`subscribe`) is real and imported by 5 files (`core/workspace/presenterRegistry.ts`, `moduleRegistry.ts`, `screenController.ts`, `index.ts`, `components/workspace/canvas/useCanvasState.ts` — the last one mounted in real UI, `Canvas.tsx`/`PropertyInspector.tsx`, but that's the Visual Workspace canvas editor, a different feature). Checked whether anything ever calls `.register()` on it: only `presenterRegistry.ts` touches it, and only via `.get()`, never `.register()`. **`runtimeRegistry.register()` is never called anywhere in the codebase.** The registry that would be the actual execution handoff point exists but has never been populated.

**Conclusion: the chain is Capability → Planner → Orchestrator → *(nothing)*.** There is no Executor step and no Driver step reachable from a Capability. The diagram's own terminology ("Executor", "Driver") collides with a real, unrelated, pre-existing system in this codebase — see next section.

## Naming collision: this codebase already has an "Executor" and "Driver," and they are not this chain

`core/executor/` and `plugins/drivers/` are real, working code — but for a completely different purpose. Read directly (`plugins/executor.ts`, first ~20 lines): a Thai comment identifies it as "V6 Executor — the one layer allowed to write to DB / receives human commands → executes via the appropriate handler / every execute must be confirmed by a human first." It imports `findTool` from `./capabilities` (a *tool* registry, unrelated to `registry/capability-registry.json` despite the similar name) and `get as getDriver` from `@/core/executor/registry`, and dispatches `ExecuteRequest { tool_id, action, payload, confirmed }` to `AppDriver`s (LINE, macOS, VS Code, mail, etc. — confirmed via `plugins/registerAllDrivers.ts`, Phase 2.3A).

Confirmed via grep: zero references to `CapabilityId` or `capability-registry` anywhere in `core/executor/` or `plugins/drivers/`. This "Executor/Driver" system is real, functioning, human-confirmed automation infrastructure — it is simply not connected to, and was never intended to connect to, the Capability Registry built in Phase 7. Anyone reading only the words "Executor" and "Driver" in this codebase would find this unrelated system first, which is itself worth flagging as a real source of confusion, independent of the wiring gap.

## The "Dead" verdict, precisely scoped

"Dead (via this chain) = YES" must not be read as "these 202 capabilities' underlying functionality is unused." A separate, real, working path exists for a subset of them:

- The 8 `gateway.presentation.*` Capabilities (`getDebtSummary`, `getPartnerSummary`, `getInvoiceSummary`, `getOrderSummary`, `getDocumentSummary`, `getMaterialSummary`, `getTransportSummary`, `getWorkflowSummary`) correspond to real functions that **are** reachable in production — but via the Presentation Gateway pattern (`createPresentationGateway(deps)`, called directly from `app/workspace-preview/*` pages), not via Capability→Planner→Orchestrator.
- Per Phase 2.6's finding, roughly 94 of 445 real modules (the ones the 202 Capabilities wrap) have real functionality; a portion of those are reachable through other direct-import paths elsewhere in `app/`, independent of this chain.

So: dead **through this specific chain**, not dead in absolute terms. Whether a given Capability's underlying function is reachable by some other route is a per-function question outside this chain-focused audit's scope, except where already confirmed above.

## Additional finding: the Capability Registry is now stale against its own source, for at least one module

The registry was frozen in Phase 7.4. `core/workspace/gateway/presentationGateway.ts` was refactored in Phase 2.3A — flat top-level exports became methods returned by a `createPresentationGateway(deps)` factory. Checked directly:

```
Registry entries for presentationGateway.ts: 8
  gateway.presentation.getDebtSummary  | ExportName: getDebtSummary
  gateway.presentation.getDocumentSummary | ExportName: getDocumentSummary
  ... (6 more, same pattern)

Real current top-level exports of presentationGateway.ts:
  export interface WorkflowStepShape
  export interface PresentationGatewayDeps
  export function createPresentationGateway(deps)
```

`getDebtSummary` etc. are **no longer top-level exports** of that file — they're properties of the object `createPresentationGateway()` returns. The registry's `ExportName: "getDebtSummary"` claim, accurate at generation time (Phase 7.4), is now inaccurate for these 8 entries following the Phase 2.3A dependency-injection refactor (applied after the registry was frozen). This is a real staleness bug in the registry itself, separate from — but compounding — the wiring gap: even if something did try to instantiate these 8 Capabilities by `OwnerModule#ExportName` today, the lookup would fail as written.

## Execution graph

```
registry/capability-registry.json (202 nodes, real, frozen)
        │
        │  0 real callers in app/ or components/
        ▼
core/workspace/composer/            [Implemented, never Referenced]
        │
        │  0 real callers in app/ or components/
        ▼
core/workspace/planner/             [Implemented, never Referenced]
        │
        │  0 real callers in app/ or components/
        ▼
core/workspace/orchestrator/        [Implemented, never Referenced]
        │
        │  completeCapability() = pure state bookkeeping,
        │  never resolves OwnerModule#ExportName, never calls anything
        ▼
     ✕ NO EXECUTOR STEP EXISTS FOR THIS CHAIN
     ✕ NO DRIVER STEP EXISTS FOR THIS CHAIN
     ✕ core/workspace/runtimeRegistry.register() — never called, anywhere

──────────────────────────────────────────────────────────
  Unrelated, real, working system sharing the same words:
  core/executor/ + plugins/drivers/  →  AppDriver dispatch
  (LINE / macOS / VS Code / mail — human-confirmed automation,
   zero references to CapabilityId anywhere)
──────────────────────────────────────────────────────────

  Separate real path for a subset of underlying functions:
  app/workspace-preview/*/page.tsx → createPresentationGateway(deps)
  (8 of 202 Capabilities' real functions reachable this way,
   bypassing the Capability chain entirely)
```

## Summary

- 202/202 Capabilities: Implemented, never Referenced, never Instantiated, never Executed, unreachable via this chain, dead via this chain.
- The chain has no Executor and no Driver step — it terminates at the Orchestrator's in-memory state tracking.
- `runtimeRegistry.register()`, the one function that could plausibly be the missing handoff point, is never called anywhere in the codebase.
- The codebase's real "Executor"/"Driver" naming (`core/executor/`, `plugins/drivers/`) refers to a separate, working, unrelated automation system — a naming collision worth resolving independent of the wiring gap.
- The Capability Registry is confirmed stale for at least 8 entries (`gateway.presentation.*`) following the Phase 2.3A refactor of their `OwnerModule` file — frozen metadata no longer matches the real export surface.
- No fix applied, per instruction. Stopping here.
