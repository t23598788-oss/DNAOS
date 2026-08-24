# control/registration-update/

หน้าที่: the canonical **Existing Registration Update** path — distinct
owner from `control/registration-pipeline/` (CREATE/REGISTER):

```
LOOKUP EXISTING REGISTRATION -> UPDATE REQUEST -> VALIDATE MUTATION
  -> APPLY RELATIONSHIP/VERSION/EVIDENCE UPDATE -> PERSIST -> READ BACK
```

| Path | Owner | Job |
|---|---|---|
| Create/Register | `control/registration-pipeline/` | classify + duplicate-resolve + write a **new** resource/capability row |
| Update Existing | `control/registration-update/` (here) | mutate a row that **already exists** — never classifies, never runs Duplicate Resolution |

## Why this exists

`control/registration-pipeline/`'s Duplicate Resolution stage correctly
refuses to write a semantically-identical resubmission of an
already-registered capability — that's its entire job (see
`control/registration-pipeline/duplicate-resolution.ts`). But that means
the CREATE path can never be used to add a relationship/evidence/version
to a capability that already exists (the exact real case this folder was
built to close: binding `registration-ingress` ->
`registration-pipeline` couldn't go through `POST /registry/candidates`,
because resubmitting `registration-ingress` with the same identity
fields — required, to represent the same real capability — is
indistinguishable from a duplicate at the Classification/Duplicate
Resolution layer). Duplicate Resolution's rules were not changed to
accommodate this — a completely separate path was built instead.

## Resource-only rows

`capability_id: ""` is the resource-only sentinel — a real resource
registered with `kind: "resource"` and no associated capability row at
all (e.g. a `SOURCE_REFERENCE` artifact from
`control/work-result-ingress/`, matching every `SOURCE_REFERENCE` this
repo has ever produced). Lookup falls back to `findResourceById`,
version-checking uses the resource's own `version` field, and
`ADD_RELATIONSHIP`/`REMOVE_RELATIONSHIP` are naturally refused
(`validateCandidateRelationships` already requires a real capability_id)
— only `ADD_EVIDENCE`/`ADD_VERSION` are meaningful for a resource-only row.

## Mutations supported

`ADD_RELATIONSHIP`, `REMOVE_RELATIONSHIP`, `ADD_EVIDENCE`, `ADD_VERSION`
— see `./types.ts`. Relationship validation reuses the exact same closed
vocabulary the CREATE path uses
(`software/registry-database/contract.ts`'s `validateCandidateRelationships`)
— one owner for what a valid relationship is, regardless of which path
binds it.

## Never touches identity

`canonical_name`, `resource_type`, `domain`, source identity
(`source_location`/`owner`), and semantic identity
(`semantic_fingerprint`/`content_hash`) can never appear in a
`mutation_payload` — `./validation.ts`'s `FORBIDDEN_PAYLOAD_KEYS` guard
rejects any of them with `IDENTITY_MUTATION_FORBIDDEN` before anything
else runs, regardless of `mutation_type`.

## Fail-closed reasons

`UNKNOWN_CAPABILITY` (no real row at that capability_id), `STALE_VERSION`
(the caller's `expected_current_version` isn't among the capability's
real current version(s)), `INVALID_RELATIONSHIP` (unknown kind/entity
type — same closed vocabulary as CREATE), `TARGET_NOT_REGISTERED` (a
control-plane-chain-style relationship whose target isn't a real,
already-registered capability), `IDENTITY_MUTATION_FORBIDDEN` (unknown
mutation_type, or an identity-looking key in the payload),
`INVALID_MUTATION_PAYLOAD` (the payload doesn't match its mutation_type's
own shape).

## Store contract

`software/registry-database/store-port.ts`'s `RegistryStore` gained four
narrow methods this folder is the only real caller of: `addRelationship`,
`removeRelationship`, `addEvidence`, `addVersion` — each technical
-idempotency only (same edit applied twice is a safe no-op), never a
semantic decision. `persistent-file-store.ts`'s `removeRelationship`
writes an append-only `relationships_removed.jsonl` tombstone log
(`relationships.jsonl` itself is never rewritten, matching this store's
append-only-disk discipline everywhere else) and replays it on every
rehydration, so a removed relationship stays removed across a restart.

Input: `UpdateRequest` (`resource_id`, `capability_id`,
`expected_current_version`, `mutation_type`, `mutation_payload`,
`evidence_refs`, `correlation_id`), a real `RegistryStore`.
Output: `applyMutation` -> `UpdateResult`.
Dependency ที่อนุญาต: `./validation.ts`, `./types.ts`,
`../../software/registry-database/contract.ts`.
สิ่งที่ห้ามแตะ: never call `classifyCandidate`/`fingerprintCandidate`/
`resolveDuplicate`/`commitRegisteredCandidate` — this is never a CREATE
path. Never write a new resource/capability row. Never modify
`control/registration-pipeline/duplicate-resolution.ts` to make it more
lenient — that stage's rules stay exactly as strict as before.
