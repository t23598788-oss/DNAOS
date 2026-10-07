# control/system-reference-resolution/

**หน้าที่:** `resolveSystemReference()` — the single deterministic lookup
that turns an Owner intent like `{ request: "OPEN", target: "DNA_LAB" }`
into EXISTING registered ids (`capability_id`, `resource_id`,
`repository_id`, `ui_ref`, `action_ref`, `evidence_refs`, ...) — never a
guess, never a new record, never a search of source code. Closes the one
real gap found in the 2026-08-21 System Addressability round: every
individual registry (`control/command-router/`'s `CAPABILITY_REGISTRY`,
`software/registry-database/`, `software/repository-registry/`,
`connections/os-ui/`'s target allowlist) can answer "what do you know
about id X," but nothing composed them into "what do you know about the
plain name X" — that composition is this folder's only job.

**Input:** `SystemReferenceRequest` (`request`, `target` — both plain
strings) + `SystemReferenceContext` (an already-constructed
`RegistryStore` — never resolved by this folder itself, same "context
consumed, never looked up" discipline as
`permissions/write-gate/types.ts`'s `WriteGateContext`).
`listCapabilities()`/`listRepositories()` are not threaded through
context — both already own their own real, process-wide default store.

**Output:** `SystemReferenceResolution` — `status: "RESOLVED" |
"AMBIGUOUS" | "UNRESOLVED"`, plus (only on `RESOLVED`) one
`SystemReferenceMatch` naming which existing registry answered and which
existing ids it returned. See `./types.ts`.

**Dependency ที่อนุญาต:**
`../command-router/contract.ts` (`listCapabilities`),
`../../software/registry-database/contract.ts` (`findCapability`),
`../../software/repository-registry/contract.ts` (`listRepositories`),
`../../connections/os-ui/adapter-contract.ts` (`OsUiTarget`,
`resolveOsUiTargetLocator`) — every one of these is the real,
authoritative source for the concept it resolves; none is duplicated
here, and this folder holds no storage of its own.

**สิ่งที่ห้ามแตะ:**
- Never invent a match — zero real matches is `UNRESOLVED`, more than one
  distinct real match is `AMBIGUOUS`, neither is ever auto-picked or
  guessed.
- Never call `fs.readFileSync`/`grep`/any source-scanning primitive from
  `resolver.ts` — every answer must come from an already-loaded registry
  read. See `tests/direct-action-proof.test.ts`'s live
  `fs.readFileSync` call-counter proof.
- Never call `openOsUi`/execute anything from this folder — resolution
  only. Execution stays the caller's job (see
  `tests/direct-action-proof.test.ts` for the full proof chain, which
  calls `openOsUi` itself, outside this folder's own code).
- Never widen `SystemReferenceContext` to carry a resolver
  function — only real, already-fetched store instances.

**Files:**
- `types.ts` — `SystemReferenceRequest`, `SystemReferenceContext`,
  `SystemReferenceMatch`, `SystemReferenceResolution`.
- `resolver.ts` — `resolveSystemReference()`. Private implementation.
- `contract.ts` — **the only file a caller outside this folder may
  import.**
- `tests/resolve-system-reference.test.ts` — proves `RESOLVED` for a real
  registered capability (`github`) and a real `os-ui` target (`dna-os`),
  and proves the DNA_LAB real case is honestly `UNRESOLVED` (see
  `../../reports/SYSTEM_ADDRESSABILITY_REPORT.md` §PHASE_2 for why).
- `tests/direct-action-proof.test.ts` — the Phase 4/5 proof: `OPEN
  dna-os` end to end, reusing `connections/os-ui/adapter-contract.ts`'s
  real `openOsUi` (no new browser automation this round), with measured
  `source_files_read`/`registry_queries`/durations.

**NOT_YET_BUILT:** no runtime transport (CLI/HTTP command handler) calls
`resolveSystemReference()` yet — wiring it into `owner-command`/
`command-router` as a real Owner-intent front door is out of scope this
round (STOP per Phase 4's own "no new agent/UI/dashboard" boundary).
`api_ref`/`runtime_ref`/`host_ref`/`port` stay `null` on every match
today — no authoritative registry exists yet for any of the four (see
`../../reports/SYSTEM_ADDRESSABILITY_REPORT.md` §PHASE_1); this folder
reports that honestly rather than fabricating a value.
