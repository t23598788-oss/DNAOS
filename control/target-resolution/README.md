# control/target-resolution/

หน้าที่: Target Resolution — the layer between Destination Mapping
(`control/artifact-destination/`) and Permission/Policy / Admission /
Execute (not built this round):

```
REGISTERED ARTIFACT
  -> DESTINATION MAPPING (control/artifact-destination/)
  -> TARGET RESOLUTION (this folder)
  -> [ Permission/Policy -> Admission -> Execute — future rounds ]
```

Turns a `destination_class` + `destination_capability_id` into a
**concrete, structured target reference** — never a guess, never
executed. `resolveTarget()` calls `resolveArtifactDestination()`
unmodified first (Destination Mapping's own availability check still
applies), then adds one more real question on top: *given this
destination class is available, is there an actual, addressable target
to point at?*

## Two resolution shapes

- **Registry-internal classes** (`CAPABILITY_GRAPH`, `EVIDENCE_STORE`,
  `SYSTEM_REGISTRY`) always resolve once AVAILABLE — the target IS the
  same `software_registry` row the artifact was already written into. No
  external lookup, no network call.
- **`SOURCE_AUTHORITY`** (github) requires a real, already-registered
  `ConnectionRegistration` (`contracts/connector/connection.ts`) whose
  `adapter` matches and whose `status` is `"connected"`. **None exists
  anywhere in this repo today** — that contract's own header says so
  explicitly ("NOT_YET_BUILT: no real connection has been registered").
  `resolveTarget()` is genuinely connection-registry-driven (the caller
  supplies whatever real connections it knows about, default `[]`) —
  it honestly reports `TARGET_NOT_RESOLVED` today and will start
  resolving for real the moment a real Connection is registered
  somewhere, with zero code change here.

`artifact.source_location` is validated through the existing, real
`connections/github/repo-path.ts#checkRepoPath` — reused, not
reimplemented — before it's ever allowed into a target reference.

## Statuses

`target_status` is one of:
- `RESOLVED` — a real target_ref exists.
- `TARGET_NOT_RESOLVED` — the destination is available, but no concrete
  target could be found (no matching connection, or no resolution rule
  implemented yet for that class).
- `DESTINATION_NOT_AVAILABLE` — passthrough from Destination Mapping.
- `DESTINATION_MAPPING_NOT_FOUND` — passthrough from Destination Mapping.

Input: `ArtifactForTargetResolution` (`resource_id`, `resource_type`,
optional `capability_id`, `source_location`, `evidence_ref` — never
content), plus a `TargetResolutionContext` carrying real, caller-supplied
`ConnectionRegistration[]`.
Output: `ResolvedTarget`.
Dependency ที่อนุญาต: `../artifact-destination/contract.ts`,
`../../contracts/connector/connection.ts` (types only),
`../../connections/github/repo-path.ts` (`checkRepoPath` only), `./types.ts`.
สิ่งที่ห้ามแตะ: never call a network API. Never return `RESOLVED` for
`SOURCE_AUTHORITY` without a real, matching, connected
`ConnectionRegistration` actually found in the caller-supplied list.
Never invent a default repo/owner/branch. No commit, no deploy, no
Supabase connection — this folder only resolves a reference, it never
acts on it.
