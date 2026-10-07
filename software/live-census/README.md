# software/live-census

**หน้าที่:** the DERIVED system census. Answers "what does DNA OS have, what
changed, and what is actually verified" by COMPUTING from the repository, git,
the test tree, the process table and the registry — never by reading a
hand-maintained map.

## Why this exists

The 2026-08-24 Census found four capability registries disagreeing with each
other and with the filesystem, 83 registry rows all carrying
`verified_at: null`, and a `current-capability-map.json` stale since 08-22 with
nothing to regenerate it. A frozen snapshot goes wrong the moment code moves.

## The one rule

A capability is `VERIFIED` **only while its current source digest still equals
the digest recorded when it was verified.** Change one implementation byte and
the status derives to `CHANGED_SINCE_VERIFICATION`, naming both digests and the
evidence that no longer applies. There is no way to *set* a status — see
`derive.ts`'s `deriveStatus`, which takes the ledger and the live digest and
cannot be told an answer. `REGISTERED` never implies `VERIFIED`.

Editing a *test* does not invalidate an implementation's verification; that is
tracked separately as `TEST_CHANGED`.

## Use

    npm run census          # summary: derived status / registration / runtime + drift
    npm run census:drift    # only what changed since the last run
    npm run census:graph    # derived edges, each with its own state
    npm run census:json     # full records
    npm run test:census     # the state-machine proof (29 checks)

    # record real evidence, pinned to the source it was proven against
    npx tsx software/live-census/cli.ts --record <path> <VERIFIED|PARTIAL|FAILED|BLOCKED> <evidence_ref> <by>

## What is authoritative, and what is not

- `data/verification-ledger.jsonl` — **append-only** evidence. Lineage; never rewritten.
- `data/last-census.json` — a **drift baseline only, never authority**. Delete it
  and the next run still produces a complete census; it just reports no drift.

## Honest limits

- Single repository. Sibling DNA OS repos are not yet observed.
- `input_contract` / `output_contract` / `downstream` / `resource_id` are declared
  in the record shape but not yet derived — they read empty rather than guessed.
- Runtime attribution is by process-command substring, so it detects a live
  capability but does not prove *which* code path is serving.
- `BLOCKED` outcomes (e.g. `FILE_READ_DEFAULT_DENY`) stay BLOCKED by design and
  are never upgraded by a matching digest.
