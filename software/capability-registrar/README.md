# software/capability-registrar/

**Status: TYPES_DEFINED (Step 1 of N, Owner-approved 2026-08-17). Types/contracts only — no discovery logic, no File Intelligence wiring, no circuit.json edits, no capability-registry.ts edits, no automatic registration, no parent inference.**

The registrar is the persistent system-memory mechanism that will later discover completed capabilities and attach them to DNA OS Circuit using verified source evidence, not AI chat memory.

## Why this exists

Every capability registered into `dna-os-circuit/` or `control/command-router/capability-registry.ts` so far — `github`, `research-engine`, `digitalocean`, and the ~30-entry snapshot in `control/command-router/current-capability-map.json` — was discovered, classified, and attached **by hand, once, by an AI reading files in a single conversation**. Nothing re-runs that work. `current-capability-map.json` is already stale: it predates `providers/digitalocean/`, `credentials/provider-accounts/digitalocean/`, and `connections/digitalocean/` entirely, because nothing regenerates it.

`software/capability-registrar/` is where that discovery/attachment work is meant to eventually live as real, repeatable code — reading real source evidence (File Intelligence scan reports, real `capability-registry.ts` entries, real test-run logs) each time, rather than depending on a conversation's memory of what got built. This step defines only the record shape that work will produce.

## What's here

| File | Contents |
|---|---|
| `types.ts` | `CapabilityStatus` (9-value evidence-based progression) and `CapabilityMetadata` (the 14-field canonical record) |

No `tests/` folder this round: there is no runtime logic yet to assert against — `types.ts` is pure type definitions, same as `contracts/identity/envelope-identity.ts` and `contracts/connector/connection.ts`, neither of which has a test file either. `tsc --noEmit` is this round's actual validation (see below).

## The two types

- **`CapabilityStatus`** — `NOT_BUILT | BUILT | REGISTERED | CONNECTED | RUNNING | VERIFIED | FAILED | BLOCKED | UNASSIGNED`. Three distinct non-success states (`FAILED`/`BLOCKED`/`UNASSIGNED`) are kept separate on purpose — a genuine error, a policy stop, and "no proven parent" each demand a different next action.
- **`CapabilityMetadata`** — the 14 fields Owner specified: `SOFTWARE_ID`, `OWNER_FOLDER`, `CAPABILITY_ID`, `PARENT_CAPABILITY`, `INGRESS`, `EGRESS`, `CONTRACT`, `RUNTIME_ENTRY`, `DATA_CLASS`, `REQUIRED_PERMISSION`, `REQUIRED_CREDENTIAL`, `DESTINATION`, `EVIDENCE_SOURCE`, `STATUS`.

## Hard rules this shape enforces

- `PARENT_CAPABILITY: string | null` — `null` is a first-class, valid value, meant to pair with `STATUS: "UNASSIGNED"`. A future implementation must never fill this with a guessed or "architecturally plausible" node id instead of a proven one — see `EVIDENCE_SOURCE`'s own doc comment, which cites the discovery round's own self-correction (the DigitalOcean branch was placed under `EXECUTION` by architectural judgment, not proof; the stricter, provable answer was `COMMAND_ROUTER`, via its real `capability-registry.ts` entry).
- `EVIDENCE_SOURCE: readonly string[]` — every other field must trace back to something in this list. This is what makes "never mark VERIFIED from source existence alone" mechanically checkable rather than a matter of discipline.
- `REQUIRED_CREDENTIAL` is a reference (e.g. a folder path), never a credential value — same discipline as `credentials/provider-accounts/digitalocean/credential-reference.ts`'s `VaultReference`.

## Explicitly NOT in this folder (yet)

- No discovery/scanning function
- No File Intelligence contract/wiring
- No circuit.json writer
- No capability-registry.ts writer
- No parent-inference implementation
- No persistence — nothing here stores a `CapabilityMetadata` record anywhere
