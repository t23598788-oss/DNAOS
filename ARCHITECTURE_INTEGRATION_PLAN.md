# Architecture Integration Plan — Phase 2.6

Read-only. No file moved, renamed, or modified.

**Interpretation stated up front, not silently assumed**: "the new DNA OS architecture" is read here as the Capability Registry / Composer / Planner / Orchestrator system built in Phase 7 of this session (`registry/capability-registry.json`, `core/workspace/composer/`, `core/workspace/planner/`, `core/workspace/orchestrator/`) — the only concretely-specified "new architecture" anywhere in this conversation. If a different target was meant, this whole report answers the wrong question — say so and I'll redo it against the right target.

This report is built from real data already gathered and verified across this session (`registry/module-registry.json`, `registry/dependency-graph.json`, `registry/capability-registry.json`, the Phase 2.2/2.3 layer-violation scan, the whole-repo circular-dependency scan, Phase 2.3B's dead-code findings) rather than re-deriving 471 individual files from scratch, which would either take extremely long or produce shallow, unverified per-file claims. Where this report speaks at folder/layer granularity instead of per-file, that's a deliberate choice to stay evidence-backed rather than guess at scale.

---

## Current Structure

445 registered modules (`registry/module-registry.json`) across these top-level folders:

| Folder | Count | Role (per this project's own Constitution) |
|---|---|---|
| `app/` | 153 | Next.js routes, pages, layouts — the UI/HTTP surface |
| `core/` | 68 | Runtime + Executor + Config/Connector Loader + Shared Types |
| `cognitive/` | 37 | Intent → Plan → Execute → Reflect pipeline |
| `engines/` | 43 | Calculation (price/debt/tax) + Validation + Document/Transaction Workflow |
| `supabase/` | 33 | Edge functions + migrations |
| `components/` | 36 | UI components |
| `plugins/` | 27 | App Drivers + macOS/LINE/local agent |
| `registry/` | 17 | Source of truth JSON/TS |
| `services/` | 10 | I/O boundary — DB, Realtime, AI bridge, middleware |
| `presenter/` | 5 | Summarize/explain/timeline (pre-existing, distinct from `core/workspace/presenters/`) |
| `gateway/` | 4 | The one DB-write door |
| `styles/`, `config/`, `scripts/`, root configs | 15 | Support/tooling |

**Current declared layer rules** (`registry/dependency-graph.json`, real, not paraphrased):
```
app        -> core, services, engines, registry, cognitive, gateway, presenter, plugins
components -> core, engines, services, registry
cognitive  -> core, services, engines, presenter, gateway, plugins
engines    -> core, services, registry
gateway    -> core, services, engines, registry
presenter  -> core, services
plugins    -> core, services, registry, gateway
core       -> registry
services   -> core
registry   -> core
```

This is already a real, mostly-clean layered architecture — flat, no deep nesting, one direction of dependency flow (roughly: `app`/`components` at the top, `core`/`registry` at the bottom).

## Target Structure — the Capability system built in Phase 7

```
registry/capability-registry.json          (202 Capabilities, frozen v1.0.0)
  ↓
core/workspace/composer/                    (CompositionPlan — dependency resolution, planning only)
  ↓
core/workspace/planner/                     (ExecutionPlan — staged, ordered, planning only)
  ↓
core/workspace/orchestrator/                (ExecutionSession — lifecycle/state, no execution)
  ↓
[Runtime — does not exist yet, see Risk Analysis]
```

Real, current coverage: **94 of 445 registered modules (21%) are represented as Capabilities.** The other 331 are entirely outside this system.

---

## Real findings (evidence, not estimation)

### Layer violations
**1 remaining**, down from 16 (Phase 2.3A fixed the other 15). `core/auth/session.ts:1` imports `@/services/supabase/server` — violates the declared `core: ["registry"]` rule. Deliberately deferred earlier this session due to its 73-file caller blast radius (every protected route in the app). Real, known, not new.

### Circular dependencies
**1 found**, whole-repo scan (467 files, real import graph, real cycle-detection algorithm): `engines/documents/engine.ts → template.ts → engine.ts`. The back-edge (`template.ts → engine.ts`) is `import type` — erased at compile time, zero runtime risk. Not a functional problem.

### Duplicate responsibilities
Two real instances found (Phase 7.0/7.3A):
1. **`presenter/` vs `core/workspace/presenters/`** — same conceptual name, architecturally distinct systems. The pre-existing `presenter/` (5 files: `enricher.ts`, `explainer.ts`, `formatter.ts`, `ranker.ts`, `index.ts`) predates this session; the new `core/workspace/presenters/*` (8 files, Phase 4) is the Capability-system equivalent. **Two of the old `presenter/` files (`enricher.ts`, `explainer.ts`) directly import Supabase**, which the new Presenter pattern explicitly forbids — this is the clearest single signal that the old and new systems are not yet reconciled.
2. **`isStale`** exported from both `cognitive/memory/context.ts` and `cognitive/memory/session.ts` — coincidental naming collision, different meanings, unrelated to the architecture question but a real duplicate-name finding.

### Dead / orphan modules
From Phase 2.3B's real, evidenced audit: exactly 4 modules confirmed as genuine orphans (zero real importers anywhere) — `supabase/functions/line-webhook-v2/helpers.ts`, `engines/impact/engine.ts`, `core/auth/index.ts`, `components/admin/AdminSidebarNav.tsx`. None of these are Capability-covered; their fate (delete/reconnect/deprecate) is an open owner decision, unrelated to this migration.

### Wrong folder placement
None found with real evidence. The `.tsx`-blindness bugs discovered in Phase 2.3B's own tooling (`scripts/build-arch-book.ts`) were *false positives in the checker*, not real misplacement — every affected file was already correctly located, just invisible to a buggy scanner. I'm not asserting folder misplacement anywhere in the current tree beyond what's listed above, because I don't have real evidence for more than that.

### Folders that should merge or split
No real evidence found for either. The current `app/core/cognitive/engines/services/gateway/plugins/registry/components` split is coherent and already documented as intentional in this project's own Constitution — proposing a split/merge here would be inventing a preference, not reporting a finding.

---

## Migration Order (blueprint only — not applied)

Given only 21% of modules are Capability-covered, and given the Composer/Planner/Orchestrator are explicitly "planning only, never execute" (confirmed via their own import audits — zero Runtime/BusinessEngine/Gateway/Presenter/Database import anywhere in those three directories), the real gap isn't file placement — **it's that nothing yet connects a `CompositionPlan`/`ExecutionPlan`/`ExecutionSession` to an actual running module.** The migration order that follows from that:

1. **Build the missing Runtime layer.** `core/workspace/runtimeRegistry.ts` (Phase 0) exists and is structurally ready (`register`/`unregister`/`getStatus`/`list`/`subscribe`), but nothing in the entire codebase ever calls `runtimeRegistry.register()` with a real module — confirmed via grep in an earlier phase this session. This is the actual missing link between "planning" (Composer/Planner/Orchestrator, done) and "doing" (Runtime, not started).
2. **Reconcile the `presenter/` vs `core/workspace/presenters/` duplication** — specifically get `enricher.ts`/`explainer.ts` off direct Supabase access, since that's the one concrete architecture debt blocking those 2 files from ever becoming real Capabilities cleanly.
3. **Expand Capability Registry coverage** from 94 to the remaining 351 real modules, in the same category order already used successfully in Phase 7 (BusinessEngine → Gateway → Presentation → Workspace), extending into `cognitive/` (currently 0 Capability coverage despite being 37 real modules — the single largest uncovered layer) and `services/`/`plugins/` last, since those are lower-level I/O layers Capabilities would depend on, not be defined by.
4. **Resolve the deferred `core/auth/session.ts` violation** — not because it blocks this migration technically, but because any Runtime layer built in step 1 will need to resolve "who is running this" for permission-gated Capabilities, and that inevitably touches the same auth boundary.
5. Everything under `app/` (153 modules — Routes/UI) stays outside the Capability system entirely, by design — Routes consume Capabilities through Applications (Phase 5's `ApplicationDefinition`), they don't become Capabilities themselves.

## Safe Move Order

**None proposed.** No real evidence supports moving, renaming, or relocating any file — every finding above is either already correctly placed (folder placement) or requires new code (Runtime layer) rather than file movement. A "safe move order" implies files need to go somewhere else; this audit didn't find that to be true anywhere in the current tree.

## Risk Analysis

| Risk | Severity | Basis |
|---|---|---|
| Building a Runtime layer that actually executes Capabilities | HIGH | Entirely new capability — nothing like it exists yet; the Composer/Planner/Orchestrator were deliberately built to never execute anything, so this is genuinely greenfield, not a refactor |
| Touching `core/auth/session.ts` | HIGH | Same 73-file blast radius flagged and deferred in Phase 2.3A — unchanged |
| Expanding Capability Registry into `cognitive/` (37 modules, 0 currently covered) | MEDIUM | Untested at that scale — the 94 modules covered so far are mostly straightforward calculators/gateways; `cognitive/`'s Intent→Plan→Execute→Reflect pipeline has more internal state and sequencing than anything wrapped so far |
| Reconciling `presenter/` vs `core/workspace/presenters/` | LOW | Contained to 2 files (`enricher.ts`, `explainer.ts`); real, already-identified, narrow fix |
| Everything else in this report | LOW | Read-only findings, no code implicated as broken |

## Estimated Impact

Given this session's own real pace on comparable work — Phase 7's 94-module Capability Registry (classification, contract validation, identity normalization, registry generation) took multiple full phases — extending to the remaining 351 modules plus building an actual Runtime execution layer is a materially larger undertaking than anything completed so far in this initiative, not a mechanical continuation of it. Sizing it precisely would itself be a guess; flagging that rather than inventing a number.

---

Stopping after this report, per instruction. Nothing moved, renamed, or modified.
