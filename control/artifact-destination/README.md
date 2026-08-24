# control/artifact-destination/

หน้าที่: Artifact Destination Mapping — once `control/work-result-ingress/`
(or `POST /registry/candidates`) has REGISTERED an artifact, this folder
answers exactly one deterministic question: *where does it go next?*

```
REGISTERED ARTIFACT
  -> RESOURCE TYPE
  -> DESTINATION CLASSIFICATION
  -> DESTINATION CONTRACT
  -> TARGET RESOLUTION
  -> NEXT ACTION
```

**No AI guesses a destination. No Agent picks its own storage/deployment
target.** `resolveArtifactDestination(resource)` reads two fixed mapping
tables in `./destination-registry.ts` — it makes no decision of its own,
and it never receives or inspects the artifact's actual content, only its
already-registered `resource_id`/`resource_type`.

## The mapping (today)

| resource_type | destination_class | backing | status |
|---|---|---|---|
| `SOURCE_REFERENCE` | `SOURCE_AUTHORITY` | real `github` capability (`control/command-router/capability-registry.ts`), re-checked live via `getCapability()` every call | AVAILABLE (github is CONNECTED) |
| `TEST_RESULT`, `EXECUTION_EVIDENCE`, `REGISTRATION_EVIDENCE` | `EVIDENCE_STORE` | `software/registry-database/` itself — the same store the artifact just landed in | AVAILABLE |
| `CAPABILITY`, `MODULE`, `API`, `ADAPTER` | `CAPABILITY_GRAPH` | `software/registry-database/` itself | AVAILABLE |
| `AI_INGRESS`, `SYSTEM_SERVICE` | `SYSTEM_REGISTRY` | `software/registry-database/` itself | AVAILABLE |
| `UI_SURFACE` | `UI_REGISTRY` | *(none)* | **NOT_AVAILABLE** — no real UI Registry capability is registered in this repo today; none is invented here to fill the gap |

`VERSION_STORE` and `DEPLOYMENT_CANDIDATE` are valid `DestinationClass`
values with no resource_type routed to them yet, and no backing entry
either — reserved, not fabricated.

GitHub is never named directly inside `./resolver.ts`'s logic — it only
ever appears as one data entry in `./destination-registry.ts`, resolved
through `getCapability()` the same way every other entry would be.
Nothing here hardcodes Vercel or Supabase as a destination at all — no
resource_type maps to `DEPLOYMENT_CANDIDATE` yet, so no such branch
exists to hardcode in the first place.

## The two honest failure modes

- **`MAPPING_NOT_FOUND`** — no destination class is registered for this
  resource_type at all. Stops here; nothing guessed.
- **`NOT_AVAILABLE`** — the destination class exists, but no real
  capability currently backs it (or the one that does isn't CONNECTED
  right now). Stops here; no target is created to fill the gap.

Input: `RegisteredArtifactRef` (`resource_id`, `resource_type`, optional
`capability_id`, `evidence_ref` — never source content).
Output: `ArtifactDestinationResult` — `artifact_resource_id`,
`resource_type`, `destination_class`, `destination_capability_id`,
`destination_status`, `next_action`, `evidence_ref`.
Dependency ที่อนุญาต: `./resolver.ts`, `./destination-registry.ts`,
`./types.ts`, `../command-router/contract.ts` (`getCapability` only).
สิ่งที่ห้ามแตะ: never let `resolveArtifactDestination` fall back to a
guessed/default destination. Never add a `DESTINATION_CLASS_BACKING`
entry that isn't traceable to a real, already-registered capability or
store. Never wire GitHub/Vercel/Supabase actions (commit, deploy,
connect) here — this folder only classifies and resolves a target
reference, it never acts on it.
