# `@dna-os/semantic-preflight` — source package

This is a **source-only, private pre-publication package**. It is not published and does not include DNA OS Core implementation, registries, business engines, connector credentials, runtime maps, database clients, or deployment configuration.

## Purpose

External developers can use this adapter boundary to request and consume a Semantic Preflight produced by **their host Context Planner**. The package deliberately does not reproduce capability resolution, dependency analysis, Archify inspection, connector gating, identity creation, or persistence.

## Public API

```ts
import { prepareSemanticPreflight } from "@dna-os/semantic-preflight";

const result = await prepareSemanticPreflight(hostAdapter, {
  workspaceSessionId,
  ownerId,
  actor,
  changedFiles: ["relative/path.ts"],
});
```

`hostAdapter.prepareContextPlan()` is mandatory. It must call the host's existing Context Planner and return its `semanticPreflight`. The returned object is validated and passed through unchanged.

## Input / Output

| Item | Contract |
| --- | --- |
| Input | `workspaceSessionId`, `ownerId`, `actor`, optional string-only `changedFiles` |
| Host dependency | `prepareContextPlan(request) -> { semanticPreflight }` |
| Output | Exact host `SemanticPreflight`, scoped input echo, and `authority: "HOST_CONTEXT_PLANNER"` |
| Runtime evidence | Only `VERIFIED_LIVE`, `CONFIGURED`, `SOURCE_REFERENCE`, `UNKNOWN` |

## Permissions and boundaries

- Requires the caller to provide workspace/owner/actor identity; it never creates identities.
- Requires a host adapter authorized to call its own Context Planner.
- Does **not** access files, databases, environment variables, connector credentials, network endpoints, capability registries, dependency graphs, or Archify reports.
- Does **not** invoke a connector. External execution remains governed by the host's existing connector Run gate.
- `UNKNOWN` must contain an explicit host reason; this package never guesses or upgrades evidence.

## DNA OS integration adapter (not shipped here)

Within DNA OS, the adapter belongs at the existing Factory Workspace `prepare-context` / `buildContextPlan()` entrypoint. It must delegate to that Core function. Do not copy `buildSemanticPreflight()` into this package and do not add a second registry, dependency graph, or execution path.

## Testing

```bash
npx tsx external-packages/semantic-preflight/test/semanticPreflightPackage.test.ts
npx tsc -p external-packages/semantic-preflight/tsconfig.json --noEmit
```

The package test uses an in-memory host adapter only. It makes no network call and reads no DNA OS secret or business data.