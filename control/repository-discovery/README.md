# control/repository-discovery/

หน้าที่: Repository/File Discovery — a read-only inventory of what
actually exists on disk in the canonical repo:

```
REPOSITORY -> DISCOVER FILES -> FILTER NON-SOURCE/GENERATED/TEMP
  -> IDENTIFY BASIC FILE KIND -> DISCOVERY INVENTORY -> STOP
```

This folder never classifies a capability, never registers anything,
never binds a relationship, never maps a destination, never decides
policy, and never touches Admission/Execute — see the STEP that built it.
It produces one in-memory `DiscoveryInventory` (a read model), never a
write into `software_registry`.

## Deterministic only

`./rules.ts`'s `classifyFile()` is a pure function over
`relative_path`/`file_name`/`extension` — no filesystem access, no AI, no
guessing a file's purpose from its name beyond fixed, well-known
conventions (exact filenames, exact directory segments, exact
extensions). Same input always produces the same `FileKind`.

Only two directories are pruned by name during the walk — `node_modules/`
and `.git/` — the only exclusions unambiguous enough in this repo to
prune without inspecting content (proved wrong once already:
`execution/build/` is a real source folder despite its name, so
directory names like "build"/"dist"/"cache" are never used to prune here).
Everything else this repo actually has as generated/runtime noise
(`software/registry-database/data/runs/`, `control/*/data/*.jsonl`,
`local-runtime/`, `audit/`) is walked and classified as `GENERATED` or
`RUNTIME_DATA` by content-based path rules, never excluded from the scan
— that's how the discovery proves the separation is real instead of just
declaring it.

Input: a real, absolute `repoRoot`.
Output: `runDiscovery` -> `DiscoveryInventory` (`records`, `totals_by_kind`,
`duplicate_content_hash_groups`, `duplicate_file_name_groups`).
Dependency ที่อนุญาต: `./scanner.ts`, `./rules.ts`, `./types.ts`.
สิ่งที่ห้ามแตะ: never write/rename/delete a file. Never call
`software/registry-database/` from here — this folder produces a read
model only, a future round decides whether/how any of it becomes a real
registration candidate.
