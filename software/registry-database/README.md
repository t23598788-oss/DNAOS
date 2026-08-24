# software/registry-database/

หน้าที่: the persistent `software_registry` database for the DNA OS
software factory's capability graph — `resources`, `capabilities`,
`resource_capabilities`, `relationships`, `versions`, `evidence`,
`registration_events`. A single canonical **Registry Writer**
(`registerCandidate()`) is the only write path; a single **Lookup API**
(`findCapability()`) is the only read path. Neither touches business data
(companies/customers/jobs/documents/payments) — see
`ARCHITECTURE_DECISIONS.md` for why this is in-scope under G-VAL-003.

Input: a `RegistrationDecision` + `RegistrationCandidate` (from
`../../control/event-pipeline/contract.ts`) for writes; a
`CapabilityLookupQuery` for reads. Both go through a `RegistryStore`
instance the caller provides — see `store-port.ts`.

Output: `RegisterCandidateResult` (writes), `CapabilityLookupResult | null`
(reads) — see `contract.ts`, the only file another capability folder may
import from.

Dependency ที่อนุญาต: `../../control/event-pipeline/contract.ts` (the
duplicate-detection decision this folder consumes but never
re-implements).

สิ่งที่ห้ามแตะ:
- **No direct database access from outside this folder.** Every other
  domain/UI/AI/external caller reaches `software_registry` only through
  `registerCandidate()`/`findCapability()` — never a raw query, never a
  service-role credential handed to an external provider. (G-DEP-002: the
  owner of a database accesses it directly; everyone else goes through
  API/Event/Contract.)
- **`registerCandidate()` never writes a resource/capability row unless
  the input decision is `APPROVED_FOR_REGISTRATION`.** `DUPLICATE_EXACT`,
  `DUPLICATE_CANDIDATE`, and `REJECTED_EVIDENCE` are recorded in
  `registration_events` only.
- **No schema/table creation outside `migrations/`.** No AI login to
  Supabase, no dashboard table creation, no arbitrary SQL, no ALTER
  outside a reviewed migration file. `migrations/MIGRATION_PLAN.md` states
  the pre-flight checklist that must pass before any migration here is
  ever executed against a live database — none has been, this round.
- **`adapters/postgres-store.ts` is real, typed source, not invoked.**
  Nothing in this repo constructs a `pg.Pool` or holds a real credential
  this round.
- **`adapters/local-file-store.ts` is test-only** — never import it from
  `contract.ts` or from any file outside `tests/`.

**สถานะ:** schema/migration/writer/lookup source built and proven at the
local/schema layer (`tests/registry-writer.test.ts`, against
`local-file-store.ts`) this round. No production migration executed — see
`../../reports/SOFTWARE_REGISTRY_DATABASE_REPORT.md`.

## Registration Ingress Contract — result semantics (locked)

`registerCandidate()` returns two result fields that answer two different
questions — every caller, internal or external (see
`transport/owner-command-http/server.ts`'s `POST /registry/candidates`,
`connections/dna-os-mcp/tool-registry.ts`'s `submit_registration_candidate`),
must read the right one:

- **`status`** (`RegisterCandidateResult.status`, surfaced over HTTP as
  `ingress_status`) — the one **authoritative, final** result:
  `REGISTERED | DUPLICATE | REJECTED | UNRESOLVED`. This is the only field
  a caller decides what-to-do-next from.
  - `REGISTERED` — a new resource/capability row was actually written.
  - `DUPLICATE` — collapsed into an already-existing row (`duplicate_of`
    names it) — either the Registration Gate's own duplicate-detection
    (`DUPLICATE_EXACT`/`DUPLICATE_CANDIDATE`) or the Writer's own
    content_hash/semantic_fingerprint uniqueness check catching a
    duplicate the Gate's `existing` snapshot didn't know about.
  - `REJECTED` — a deliberate policy decision (business data, invalid
    ingress metadata, an invalid relationship, insufficient evidence) —
    `reason_code` says which.
  - `UNRESOLVED` — the pipeline genuinely could not classify/complete this
    candidate (e.g. an unknown `resource_type`, a `domain`/`resource_type`
    mismatch, an unexpected internal error) — never mislabeled as
    `REJECTED`, since that would tell a caller "this is disallowed"
    instead of "the schema doesn't recognize this yet".
- **`decision`** (surfaced over HTTP as `registration_status`) — the
  Registration Gate's own **pre-write** decision label (e.g.
  `"APPROVED_FOR_REGISTRATION"`, `"DUPLICATE_EXACT"`, `"DOMAIN_REJECTED"`).
  Informational/evidence only — kept for audit trails and debugging, never
  the field to branch on. It can legitimately disagree with `status`: the
  Gate approving a candidate that the Writer's own uniqueness check then
  collapses into an existing row is exactly the `DUPLICATE` case above —
  `decision` still reads `"APPROVED_FOR_REGISTRATION"` while `status`
  correctly reads `"DUPLICATE"`. That disagreement is expected, not a bug.

No other field pair in this contract carries this split — `reason_code`
and `duplicate_of` are only ever populated from real signals `status`
itself was computed from, never guessed after the fact.
